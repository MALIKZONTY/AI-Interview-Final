import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { TranscriptBlock } from "@/components/TranscriptBlock";
import { RecordingBlock } from "@/components/RecordingBlock";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export function HistoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [createdAt, setCreatedAt] = useState<string>("");
  type Q = {
    id: string;
    orderIndex: number;
    text: string;
    transcript: string | null;
    recordingUrl: string | null;
    correctnessScore: number | null;
    confidenceScore: number | null;
  };
  const [questions, setQuestions] = useState<Q[]>([]);
  const [result, setResult] = useState<{
    avgCorrectness: number;
    avgConfidence: number;
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const { data } = await api.get<{
          interview: { createdAt: string; status: string };
          result: { avgCorrectness: number; avgConfidence: number } | null;
          questions: Q[];
        }>(`/interview/history/${id}`);
        if (cancelled) return;
        setCreatedAt(data.interview.createdAt);
        setResult(data.result);
        setQuestions(data.questions);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading…
      </div>
    );
  }

  const c = result != null ? Math.round(result.avgCorrectness) : null;
  const co = result != null ? Math.round(result.avgConfidence) : null;

  return (
    <div className="space-y-8 animate-slide-up">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/" className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </Button>

      <div>
        <h1 className="font-display text-2xl font-bold">Interview detail</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {new Date(createdAt).toLocaleString()}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="text-base">Overall correctness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="font-display text-4xl font-bold text-primary">{c != null ? `${c}%` : "—"}</p>
            {c != null && <Progress value={c} className="h-2" />}
          </CardContent>
        </Card>
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="text-base">Overall confidence</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="font-display text-4xl font-bold text-accent">{co != null ? `${co}%` : "—"}</p>
            {co != null && <Progress value={co} className="h-2" />}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {questions.map((q, i) => (
          <Card key={q.id} className="border-border/80">
            <CardHeader className="pb-2">
              <p className="text-xs text-muted-foreground">Q{i + 1}</p>
              <CardTitle className="text-base font-medium">{q.text}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-4">
              <div className="grid gap-4 md:grid-cols-2 md:gap-6 md:items-start">
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Answer (transcript)</p>
                  <TranscriptBlock transcript={q.transcript} />
                </div>
                <RecordingBlock url={q.recordingUrl} />
              </div>
              <p>
                Scores: correctness{" "}
                <strong>{q.correctnessScore != null ? Math.round(q.correctnessScore) : "—"}%</strong>
                , confidence{" "}
                <strong>{q.confidenceScore != null ? Math.round(q.confidenceScore) : "—"}%</strong>
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
