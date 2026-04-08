import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, History, Loader2, Play, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useInterviewStore } from "@/store/interviewStore";

type ResumeRow = {
  id: string;
  url: string;
  fileName: string | null;
  updatedAt: string;
};

type HistoryItem = {
  id: string;
  createdAt: string;
  overallScore: number | null;
  numQuestions: number;
  status?: string;
  result: { avgCorrectness: number; avgConfidence: number } | null;
};

export function DashboardPage() {
  const navigate = useNavigate();
  const setSession = useInterviewStore((s) => s.setSession);

  const [resume, setResume] = useState<ResumeRow | null | undefined>(undefined);
  const [resumeLoading, setResumeLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [jdText, setJdText] = useState("");
  const [numQuestions, setNumQuestions] = useState(5);
  const [difficulty, setDifficulty] = useState("Medium");
  const [starting, setStarting] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadResume = useCallback(async () => {
    setResumeLoading(true);
    try {
      const { data } = await api.get<{ resume: ResumeRow | null }>("/upload/resume");
      setResume(data.resume);
    } catch {
      setResume(null);
    } finally {
      setResumeLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data } = await api.get<{ interviews: HistoryItem[] }>("/interview/history");
      setHistory(data.interviews);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadResume();
    void loadHistory();
  }, [loadResume, loadHistory]);

  async function onResumeFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post("/upload/resume", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await loadResume();
    } catch {
      setError("Resume upload failed. Check PDF format and Cloudinary configuration.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function startInterview() {
    setError(null);
    if (jdText.trim().length < 10) {
      setError("Please paste a job description (at least a few sentences).");
      return;
    }
    setStarting(true);
    try {
      await api.post("/upload/jd", { text: jdText });
      const { data } = await api.post<{
        interviewId: string;
        questions: { id: string; orderIndex: number; text: string }[];
      }>("/interview/start", { jdText, numQuestions, difficulty });
      setSession({
        interviewId: data.interviewId,
        questions: data.questions,
        jdText,
        numQuestions,
      });
      navigate("/interview/prep");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Could not start interview";
      setError(msg);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-8 animate-slide-up">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Upload your resume once, add a job description, and run a timed mock interview.
        </p>
      </div>

      {error && (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      <Tabs defaultValue="setup" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="setup">Interview setup</TabsTrigger>
          <TabsTrigger value="past">Past interviews</TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="space-y-6 mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Upload className="h-5 w-5 text-primary" />
                  Resume
                </CardTitle>
                <CardDescription>
                  PDF only. Stored in Cloudinary and linked to your account for future sessions.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {resumeLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading resume…
                  </div>
                ) : resume ? (
                  <div className="flex items-start justify-between gap-2 rounded-lg border border-border/80 bg-muted/30 p-3">
                    <div className="flex gap-2">
                      <FileText className="h-5 w-5 shrink-0 text-primary mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">{resume.fileName ?? "Resume"}</p>
                        <a
                          href={resume.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          View file
                        </a>
                      </div>
                    </div>
                    <Badge variant="secondary">Saved</Badge>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No resume yet — upload a PDF.</p>
                )}
                <div>
                  <Label htmlFor="resume-file" className="sr-only">
                    Upload PDF
                  </Label>
                  <Input
                    id="resume-file"
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => void onResumeFile(e)}
                    disabled={uploading}
                  />
                  {uploading && (
                    <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Uploading…
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5 text-accent" />
                  Job description
                </CardTitle>
                <CardDescription>
                  Paste the JD for this session. It is not stored permanently unless you start an
                  interview.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <textarea
                  className="flex min-h-[140px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Paste the role description, responsibilities, and requirements…"
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                />
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <Label htmlFor="nq">Number of questions</Label>
                    <span className="text-muted-foreground font-medium">{numQuestions}</span>
                  </div>
                  <input
                    id="nq"
                    type="range"
                    min={1}
                    max={20}
                    value={numQuestions}
                    onChange={(e) => setNumQuestions(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    The system will generate {numQuestions} questions for your interview session.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="difficulty">Difficulty Level</Label>
                  <select
                    id="difficulty"
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="Easy">Easy</option>
                    <option value="Medium">Medium</option>
                    <option value="Hard">Hard</option>
                  </select>
                </div>
                <Button
                  className="w-full gap-2"
                  size="lg"
                  onClick={() => void startInterview()}
                  disabled={starting}
                >
                  {starting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Preparing…
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" /> Start interview
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="past" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <History className="h-5 w-5" />
                Past interviews
              </CardTitle>
              <CardDescription>Completed sessions with overall scores.</CardDescription>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No completed interviews yet.
                </p>
              ) : (
                <ul className="divide-y divide-border/80 rounded-lg border border-border/80">
                  {history.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                        onClick={() => navigate(`/history/${h.id}`)}
                      >
                        <span className="text-sm">
                          {new Date(h.createdAt).toLocaleString("en-IN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                            hour12: true,
                          })}
                        </span>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {h.status === "failed" && (
                            <Badge variant="outline" className="text-amber-700 border-amber-300">
                              Failed
                            </Badge>
                          )}
                          {h.result ? (
                            <>
                              <Badge variant="secondary" className="tabular-nums">
                                C {Math.round(h.result.avgCorrectness)}%
                              </Badge>
                              <Badge variant="secondary" className="tabular-nums">
                                Co {Math.round(h.result.avgConfidence)}%
                              </Badge>
                            </>
                          ) : h.overallScore != null ? (
                            <Badge className="tabular-nums">{Math.round(h.overallScore)}%</Badge>
                          ) : (
                            <Badge>—</Badge>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
