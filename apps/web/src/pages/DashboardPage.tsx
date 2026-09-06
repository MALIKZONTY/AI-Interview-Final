import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, BrainCircuit, Calendar, CheckCircle2, ChevronRight, FileText, History, LayoutDashboard, Loader2, Play, ShieldAlert, ShieldCheck, Sparkles, Target, TrendingUp, Upload, UserCircle, Zap } from "lucide-react";
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
  difficulty?: string;
  jdText?: string;
  result: { avgCorrectness: number; avgConfidence: number } | null;
};

function getJDTitle(text?: string) {
  if (!text) return "General Session";
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length > 40) return firstLine.substring(0, 40) + "...";
  return firstLine || "General Session";
}

export function DashboardPage() {
  const navigate = useNavigate();
  const setSession = useInterviewStore((s) => s.setSession);

  const [resume, setResume] = useState<ResumeRow | null | undefined>(undefined);
  const [resumeLoading, setResumeLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  /** An interview is built from one source, never both. */
  const [source, setSource] = useState<"jd" | "resume">("jd");
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

  /**
   * The stored resume sits behind an authenticated endpoint, so it cannot be a plain
   * link: fetch it as a blob and hand the browser an object URL instead.
   */
  async function openResume() {
    try {
      const { data } = await api.get<Blob>("/upload/resume/file", { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank", "noreferrer");
      // Give the new tab time to claim the blob before releasing it.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError("Could not open the stored resume.");
    }
  }

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
      setError("Document upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  }

  async function startInterview() {
    setError(null);

    if (source === "jd" && jdText.trim().length < 10) {
      setError("Please provide a Job Description (at least 10 characters).");
      return;
    }
    if (source === "resume" && !resume) {
      setError("Upload a resume first, or switch to a job description.");
      return;
    }

    setStarting(true);
    try {
      if (source === "jd") {
        await api.post("/upload/jd", { text: jdText });
      }
      const { data } = await api.post<{
        interviewId: string;
        questions: { id: string; orderIndex: number; text: string }[];
      }>("/interview/start", {
        source,
        jdText: source === "jd" ? jdText : undefined,
        numQuestions,
        difficulty,
      });
      setSession({
        interviewId: data.interviewId,
        questions: data.questions,
        jdText: source === "jd" ? jdText : "",
        numQuestions,
      });
      navigate("/interview/prep");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Failed to prepare session";
      setError(msg);
    } finally {
      setStarting(false);
    }
  }

  const topAccuracy = history.length > 0
    ? Math.max(...history.map(h => typeof h.result?.avgCorrectness === 'number' ? h.result.avgCorrectness : (h.overallScore || 0)))
    : 0;
  const topConfidence = history.length > 0
    ? Math.max(...history.map(h => h.result?.avgConfidence || 0))
    : 0;

  return (
    <div className="w-full animate-slide-up pb-20 mt-4 px-0">
      {/* Professional Dashboard Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
        <div className="space-y-1">
          <h1 className="font-display text-4xl font-bold tracking-tight text-foreground">
            Interview Dashboard
          </h1>
          <p className="text-muted-foreground font-medium text-base">
            Configure your session and review past performance metrics.
          </p>
        </div>

        <div className="flex items-center gap-8 p-4 rounded-2xl bg-card border border-border shadow-sm">
          <div className="flex flex-col items-start px-2 border-r border-border pr-8">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Total Sessions</span>
            <span className="text-2xl font-bold tracking-tight text-foreground">{history.length}</span>
          </div>
          <div className="flex flex-col items-start px-2 border-r border-border pr-8">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Highest Score</span>
            <span className="text-2xl font-bold tracking-tight text-primary">{Math.round(topAccuracy)}%</span>
          </div>
          <div className="flex flex-col items-start px-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Top Confidence</span>
            <span className="text-2xl font-bold tracking-tight text-foreground">{Math.round(topConfidence)}%</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-8 rounded-2xl border border-destructive/20 bg-destructive/5 px-6 py-4 flex items-center gap-4 text-destructive animate-shake shadow-sm font-semibold text-sm">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <Tabs defaultValue="setup" className="w-full space-y-8">
        <TabsList className="bg-muted/50 p-1 rounded-xl w-fit flex h-12 border border-border">
          <TabsTrigger
            value="setup"
            className="rounded-lg px-8 text-xs font-bold uppercase tracking-wider transition-all flex items-center data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
          >
            Interview Setup
          </TabsTrigger>
          <TabsTrigger
            value="past"
            className="rounded-lg px-8 text-xs font-bold uppercase tracking-wider transition-all flex items-center data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
          >
            Past Sessions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="space-y-8 animate-slide-up outline-none">
          <div className="grid lg:grid-cols-12 gap-8">
            {/* Left Segment: Identity & Resume */}
            <Card className="lg:col-span-4 border-border bg-card shadow-sm rounded-3xl overflow-hidden flex flex-col">
              <CardHeader className="p-8 pb-4">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                    <UserCircle className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold tracking-tight text-foreground">Identity & Resume</h3>
                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mt-1">Profile Data Center</p>
                  </div>
                </div>
                <p className="text-sm font-medium text-muted-foreground leading-relaxed">
                  Update your resume to ensure the AI generates high-relevance behavioral questions.
                </p>
              </CardHeader>

              <CardContent className="p-8 pt-4 space-y-8 flex-1 flex flex-col justify-between">
                <div className="p-5 rounded-2xl bg-muted/30 border border-border shadow-inner relative overflow-hidden group">
                  {resumeLoading ? (
                    <div className="flex flex-col items-center gap-4 py-4">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Reading Document...</p>
                    </div>
                  ) : resume ? (
                    <div className="space-y-5">
                      <div className="flex items-start gap-4">
                        <FileText className="h-6 w-6 text-primary shrink-0" />
                        <div className="overflow-hidden">
                          <p className="font-bold text-xs truncate uppercase tracking-tight text-foreground">{resume.fileName || "Uploaded Resume"}</p>
                          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mt-1">
                            Indexed {new Date(resume.updatedAt).toLocaleString(undefined, {
                              month: 'short', day: '2-digit', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                              hour12: true
                            })}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full rounded-xl h-9 text-[10px] font-bold tracking-widest uppercase border-border hover:bg-muted transition-colors"
                        onClick={() => void openResume()}
                      >
                        Review Source PDF
                      </Button>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">No resume detected</p>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <Label htmlFor="resume-file" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Upload New Document</Label>
                  <Input
                    id="resume-file"
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => void onResumeFile(e)}
                    disabled={uploading}
                    className="h-11 rounded-xl bg-muted/30 border-border file:bg-primary file:text-primary-foreground file:border-none file:h-full file:px-4 file:mr-4 file:font-bold file:text-[10px] file:uppercase file:cursor-pointer transition-all hover:border-primary/40 text-xs"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Right Segment: Job Details */}
            <Card className="lg:col-span-8 border-border bg-card shadow-sm rounded-3xl overflow-hidden flex flex-col">
              <CardHeader className="p-10 pb-6 border-b border-border bg-muted/10">
                <div className="space-y-8">
                  <div className="space-y-1">
                    <h3 className="text-2xl font-bold tracking-tight text-foreground">Interview Source</h3>
                    <p className="text-[10px] font-bold text-primary uppercase tracking-widest">
                      Choose one — questions come from this alone
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setSource("jd")}
                      className={`rounded-2xl border-2 p-5 text-left transition-all ${
                        source === "jd"
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border bg-muted/10 hover:border-primary/30"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase tracking-widest text-foreground">
                          Job Description
                        </span>
                        {source === "jd" && <CheckCircle2 className="h-4 w-4 text-primary" />}
                      </div>
                      <p className="text-[11px] font-medium text-muted-foreground leading-relaxed">
                        Questions about a role you are targeting.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSource("resume")}
                      className={`rounded-2xl border-2 p-5 text-left transition-all ${
                        source === "resume"
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border bg-muted/10 hover:border-primary/30"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase tracking-widest text-foreground">
                          My Resume
                        </span>
                        {source === "resume" && <CheckCircle2 className="h-4 w-4 text-primary" />}
                      </div>
                      <p className="text-[11px] font-medium text-muted-foreground leading-relaxed">
                        Questions about your own projects and experience.
                      </p>
                    </button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-10 space-y-10 flex-1">
                {source === "jd" ? (
                  <textarea
                    className="flex min-h-[180px] w-full rounded-2xl border border-border bg-muted/20 px-8 py-6 text-base font-medium placeholder:text-muted-foreground/30 focus:bg-background focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all resize-none shadow-sm"
                    placeholder="Paste the target job description here..."
                    value={jdText}
                    onChange={(e) => setJdText(e.target.value)}
                  />
                ) : (
                  <div className="min-h-[180px] rounded-2xl border border-border bg-muted/20 px-8 py-6 flex flex-col justify-center gap-3 shadow-sm">
                    {resume ? (
                      <>
                        <div className="flex items-center gap-3 text-primary">
                          <CheckCircle2 className="h-5 w-5" />
                          <span className="text-xs font-bold uppercase tracking-widest">
                            {resume.fileName || "Resume ready"}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-muted-foreground leading-relaxed">
                          Questions will come from the projects, skills and experience in this
                          document. No job description is used.
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-3 text-destructive">
                          <ShieldAlert className="h-5 w-5" />
                          <span className="text-xs font-bold uppercase tracking-widest">
                            No resume uploaded
                          </span>
                        </div>
                        <p className="text-sm font-medium text-muted-foreground leading-relaxed">
                          Upload one in the panel on the left, or switch to a job description.
                        </p>
                      </>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  <div className="space-y-4">
                    <div className="flex justify-between items-end px-1">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total Questions</Label>
                      <span className="text-2xl font-bold tracking-tighter text-primary leading-none">{numQuestions}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={15}
                      value={numQuestions}
                      onChange={(e) => setNumQuestions(Number(e.target.value))}
                      className="w-full h-2 bg-muted rounded-full appearance-none accent-primary cursor-pointer transition-all"
                    />
                  </div>

                  <div className="space-y-3">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Difficulty Level</Label>
                    <select
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value)}
                      className="w-full h-12 rounded-xl border border-border bg-muted/20 px-6 text-xs font-bold uppercase tracking-wider focus:outline-none focus:ring-4 focus:ring-primary/5 transition-all cursor-pointer shadow-sm"
                    >
                      <option value="Easy">Easy</option>
                      <option value="Medium">Medium</option>
                      <option value="Hard">Hard</option>
                    </select>
                  </div>
                </div>

                <Button
                  className="w-full h-16 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground text-base font-bold gap-3 shadow-lg shadow-primary/20 transition-all active:scale-[0.98] mt-2 group"
                  onClick={() => void startInterview()}
                  disabled={starting || (source === "resume" && !resume)}
                >
                  {starting ? (
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="tracking-widest uppercase">Preparing Session...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="tracking-wider uppercase">Proceed to Preparation</span>
                      <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1.5" />
                    </div>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="past" className="mt-0 animate-slide-up outline-none">
          <div className="space-y-10">
            <div className="flex items-end justify-between px-2">
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tight text-foreground">Past Sessions</h2>
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Historical performance and feedback logs</p>
              </div>
              <Badge variant="outline" className="border-border text-muted-foreground font-bold tracking-widest px-6 py-2 rounded-full text-[10px] bg-card">SESSIONS: {history.length}</Badge>
            </div>

            {historyLoading ? (
              <div className="flex flex-col items-center justify-center gap-6 py-24 bg-card rounded-3xl border border-border shadow-sm">
                <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Loading records...</p>
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-8 py-24 bg-card rounded-3xl border border-border border-dashed text-center">
                <History className="h-16 w-16 text-muted-foreground/20" />
                <div className="space-y-2">
                  <p className="text-lg font-bold text-muted-foreground">No recent activity</p>
                  <p className="text-xs font-medium text-muted-foreground/60 max-w-xs">Complete your first interview session to see your performance history here.</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {history.map((h) => (
                  <Card
                    key={h.id}
                    className="group relative overflow-hidden border-border bg-card shadow-sm rounded-[2.5rem] hover:shadow-[0_32px_80px_-16px_rgba(14,165,233,0.4)] hover:-translate-y-2.5 transition-all duration-500 cursor-pointer flex flex-col border hover:border-sky-400/50 hover:bg-gradient-to-b hover:from-card hover:to-sky-500/[0.03]"
                    onClick={() => navigate(`/history/${h.id}`)}
                  >
                    <CardHeader className="p-8 pb-4">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <Badge className={`text-[9px] font-bold tracking-widest uppercase border-none px-3 py-0.5 rounded-full ${h.difficulty === "Hard" ? "bg-red-500/10 text-red-600" :
                              h.difficulty === "Medium" ? "bg-amber-500/10 text-amber-600" :
                                "bg-emerald-500/10 text-emerald-600"
                            }`}>
                            {h.difficulty || "Medium"}
                          </Badge>
                          <div className="flex items-center gap-3 text-muted-foreground/60 bg-muted/30 px-3 py-1 rounded-lg">
                            <Calendar className="h-3.5 w-3.5" />
                            <span className="text-[11px] font-black uppercase tracking-tight">
                              {new Date(h.createdAt).toLocaleString(undefined, {
                                month: 'short', day: '2-digit', year: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                                hour12: true
                              })}
                            </span>
                          </div>
                        </div>
                        <CardTitle className="text-xl font-bold tracking-tight leading-tight text-foreground line-clamp-2 pr-6">
                          {getJDTitle(h.jdText)}
                        </CardTitle>
                      </div>
                    </CardHeader>

                    <CardContent className="p-8 pt-4 space-y-8 flex-1 flex flex-col justify-between relative">
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Accuracy</span>
                          </div>
                          <p className="text-2xl font-bold tracking-tight text-foreground group-hover:scale-110 transition-transform origin-left duration-500">{Math.round(h.result?.avgCorrectness || h.overallScore || 0)}%</p>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Confidence</span>
                          </div>
                          <p className="text-2xl font-bold tracking-tight text-foreground group-hover:scale-110 transition-transform origin-left duration-500">{Math.round(h.result?.avgConfidence || 0)}%</p>
                        </div>
                      </div>

                      <div className="pt-6 border-t border-border flex justify-between items-center group-hover:border-primary/20 transition-colors">
                        <div className="flex items-center gap-2 text-muted-foreground/60">
                          <History className="h-4 w-4" />
                          <span className="text-[10px] font-bold uppercase tracking-widest">{h.numQuestions} Questions</span>
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground/40 group-hover:text-primary transition-all duration-500 group-hover:translate-x-2" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
