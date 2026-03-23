import { Link } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { TranscriptBlock } from "@/components/TranscriptBlock";
import { RecordingBlock } from "@/components/RecordingBlock";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export type ResultRow = {
  id: string;
  orderIndex: number;
  text: string;
  transcript: string | null;
  recordingUrl: string | null;
  correctnessScore: number | null;
  confidenceScore: number | null;
};

export type ResultSummary = {
  avgCorrectness: number;
  avgConfidence: number;
} | null;

type Props = {
  interviewId: string;
  status: string;
  result: ResultSummary;
  rows: ResultRow[];
  polling?: boolean;
  dashboardHref?: string;
  title?: string;
  /** e.g. clear client session before leaving the live interview flow */
  onBeforeDashboard?: () => void;
};

export function InterviewResultsView({
  interviewId,
  status,
  result,
  rows,
  polling = false,
  dashboardHref = "/",
  title = "Your results",
  onBeforeDashboard,
}: Props) {
  const correctnessPct = result != null ? Math.round(result.avgCorrectness) : null;
  const confidencePct = result != null ? Math.round(result.avgConfidence) : null;

  return (
    <div className="space-y-8 animate-slide-up">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link
            to={dashboardHref}
            className="gap-2"
            onClick={() => {
              onBeforeDashboard?.();
            }}
          >
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
        </Button>
        {polling && (
          <span className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Updating scores…
          </span>
        )}
      </div>

      <Card className="border-border/80 overflow-hidden">
        <CardHeader className="bg-gradient-to-br from-primary/10 via-background to-accent/5">
          <CardTitle className="font-display text-2xl">{title}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Answer quality vs expected themes, weighted by how well each answer matched the question.
            Confidence reflects camera engagement, head stability, and delivery (fillers / pauses).
          </p>
        </CardHeader>
        <CardContent className="pt-8 pb-10">
          {status === "processing" && result == null ? (
            <p className="text-muted-foreground">
              Still processing — scores will appear automatically in a few seconds.
            </p>
          ) : status === "failed" ? (
            <p className="text-destructive">
              Scoring failed. Use{" "}
              <Link to={`/interview/processing/${interviewId}`} className="underline font-medium">
                retry processing
              </Link>{" "}
              or start a new interview from the dashboard.
            </p>
          ) : result != null ? (
            <div className="grid gap-8 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Overall correctness</p>
                <p className="font-display text-5xl font-bold tracking-tight text-primary">
                  {correctnessPct}%
                </p>
                <Progress value={correctnessPct ?? 0} className="h-2" />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Overall confidence</p>
                <p className="font-display text-5xl font-bold tracking-tight text-accent">
                  {confidencePct}%
                </p>
                <Progress value={confidencePct ?? 0} className="h-2" />
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No aggregate scores for this interview yet.</p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="font-display text-lg font-semibold">Per question</h2>
        <div className="grid gap-4">
          {rows.map((r, i) => (
            <Card key={r.id} className="border-border/80">
              <CardHeader className="pb-2">
                <p className="text-xs font-medium text-muted-foreground">Q{i + 1}</p>
                <CardTitle className="text-base font-medium leading-snug">{r.text}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="grid gap-4 md:grid-cols-2 md:gap-6 md:items-start">
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Transcript</p>
                    <TranscriptBlock transcript={r.transcript} />
                  </div>
                  <RecordingBlock url={r.recordingUrl} />
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span>
                    Correctness:{" "}
                    <strong>
                      {r.correctnessScore != null ? `${Math.round(r.correctnessScore)}%` : "—"}
                    </strong>
                  </span>
                  <span>
                    Confidence:{" "}
                    <strong>
                      {r.confidenceScore != null ? `${Math.round(r.confidenceScore)}%` : "—"}
                    </strong>
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
