import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Sparkles, Target, TrendingUp, History, ClipboardCheck } from "lucide-react";
import { TranscriptBlock } from "@/components/TranscriptBlock";
import { RecordingBlock } from "@/components/RecordingBlock";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

export type ResultRow = {
    id: string;
    orderIndex: number;
    text: string;
    transcript: string | null;
    hasRecording?: boolean;
    hasThumbnail?: boolean;
    recordingKind?: "audio" | "video";
    eyeContactScore?: number | null;
    correctnessScore: number | null;
    confidenceScore: number | null;
    aiFeedback?: string | null;
    analysisMeta?: any;
};

export type ResultSummary = {
    avgCorrectness: number;
    avgConfidence: number;
    summaryFeedback?: string | null;
} | null;

type Props = {
    interviewId: string;
    status: string;
    result: ResultSummary;
    rows: ResultRow[];
    polling?: boolean;
    dashboardHref?: string;
    title?: string;
    onBeforeDashboard?: () => void;
};

export function InterviewResultsView({
    interviewId,
    status,
    result,
    rows,
    polling = false,
    dashboardHref = "/",
    title = "Performance Feedback Report",
    onBeforeDashboard,
}: Props) {
    const correctnessPct = result != null ? Math.round(result.avgCorrectness) : null;
    const confidencePct = result != null ? Math.round(result.avgConfidence) : null;

    return (
        <div className="space-y-10 animate-slide-up pb-20">
            {/* Navigation Header */}
            <div className="flex flex-wrap items-center justify-between gap-6">
                <Button variant="ghost" size="sm" asChild className="rounded-full px-6 hover:bg-muted text-muted-foreground transition-all">
                    <Link
                        to={dashboardHref}
                        className="gap-2 flex items-center"
                        onClick={() => {
                            onBeforeDashboard?.();
                        }}
                    >
                        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
                    </Link>
                </Button>
                {polling && (
                    <Badge variant="outline" className="px-4 py-1.5 rounded-full bg-primary/5 text-primary border-primary/20 animate-pulse font-bold uppercase tracking-widest text-[10px]">
                        <Loader2 className="h-3 w-3 mr-2 animate-spin" /> Finalizing Evaluation Metrics
                    </Badge>
                )}
            </div>

            {/* Hero Summary Card */}
            <Card className="border-border bg-card shadow-sm rounded-3xl overflow-hidden border">
                <div className="grid lg:grid-cols-12">
                    <div className="lg:col-span-8 p-10 lg:p-14 space-y-10">
                        <div className="space-y-4">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-bold uppercase tracking-widest text-primary mb-2">
                                <ClipboardCheck className="h-3 w-3" />
                                Comprehensive Assessment
                            </div>
                            <CardTitle className="font-display text-4xl font-bold tracking-tight text-foreground">{title}</CardTitle>
                            <p className="text-muted-foreground font-medium text-lg leading-relaxed max-w-2xl">
                                Your performance has been evaluated across technical accuracy, communication delivery, and overall professional alignment.
                            </p>
                        </div>

                        {status === "processing" && result == null ? (
                            <div className="py-12 flex flex-col items-center justify-center gap-4 bg-muted/20 rounded-2xl border border-dashed border-border">
                                <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Generating Professional Insight...</p>
                            </div>
                        ) : status === "failed" ? (
                            <div className="p-8 rounded-2xl bg-destructive/5 border border-destructive/20 text-center space-y-4">
                                <p className="text-sm font-bold text-destructive uppercase tracking-widest">
                                    Evaluation Scoring Interrupted.
                                </p>
                                <Button variant="outline" className="rounded-full px-8 text-[10px] font-bold uppercase tracking-widest border-destructive/20 text-destructive hover:bg-destructive/5" asChild>
                                    <Link to={`/interview/processing/${interviewId}`}>Retry Assessment</Link>
                                </Button>
                            </div>
                        ) : result != null ? (
                            <div className="grid gap-12 sm:grid-cols-2">
                                <div className="space-y-5">
                                    <div className="flex justify-between items-end">
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Answering Accuracy</p>
                                            <p className="font-display text-5xl font-bold tracking-tight text-primary leading-none">
                                                {correctnessPct}%
                                            </p>
                                        </div>
                                        <Target className="h-7 w-7 text-primary/20" />
                                    </div>
                                    <Progress value={correctnessPct ?? 0} className="h-2.5 bg-muted rounded-full" />
                                </div>
                                <div className="space-y-5">
                                    <div className="flex justify-between items-end">
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Delivery Confidence</p>
                                            <p className="font-display text-5xl font-bold tracking-tight text-foreground/80 leading-none">
                                                {confidencePct}%
                                            </p>
                                        </div>
                                        <TrendingUp className="h-7 w-7 text-muted-foreground/20" />
                                    </div>
                                    <Progress value={confidencePct ?? 0} className="h-2.5 bg-muted rounded-full" />
                                </div>
                            </div>
                        ) : (
                            <p className="text-muted-foreground text-center font-medium italic">Finalizing metrics...</p>
                        )}
                    </div>

                    {/* AI Summary Sidebar */}
                    <div className="lg:col-span-4 bg-muted/20 p-10 lg:p-14 flex flex-col justify-center border-t lg:border-t-0 lg:border-l border-border">
                        {result?.summaryFeedback ? (
                            <div className="space-y-8 animate-in fade-in duration-700">
                                <div className="flex items-center gap-3 text-primary">
                                    <Sparkles className="h-5 w-5" />
                                    <span className="text-[11px] font-bold uppercase tracking-widest">Mentor Evaluation</span>
                                </div>
                                <div className="relative">
                                    <div className="absolute -left-6 top-0 bottom-0 w-1 bg-primary/20 rounded-full"></div>
                                    <p className="text-lg leading-relaxed text-foreground font-medium pr-4">
                                        "{result.summaryFeedback}"
                                    </p>
                                </div>
                                <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary px-4 py-1.5 rounded-full text-[9px] font-bold tracking-widest uppercase">Verified Assessment</Badge>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                                <ClipboardCheck className="h-10 w-10 text-muted-foreground" />
                                <p className="text-[10px] font-bold uppercase tracking-widest">Awaiting Mentor Feedback...</p>
                            </div>
                        )}
                    </div>
                </div>
            </Card>

            {/* Per Question Breakdown */}
            <div className="space-y-8">
                <div className="flex items-end justify-between px-2">
                    <div className="space-y-1">
                        <h2 className="text-3xl font-bold tracking-tight text-foreground leading-none">Detailed Breakdown</h2>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Comprehensive analysis of individual responses</p>
                    </div>
                </div>

                <div className="grid gap-8">
                    {rows.map((r, i) => (
                        <Card key={r.id} className="border-border bg-card shadow-sm rounded-[2rem] overflow-hidden group transition-all hover:border-primary/30">
                            <div className="grid lg:grid-cols-12">
                                <div className="lg:col-span-8 p-8 lg:p-10 space-y-8">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center text-[11px] font-bold text-muted-foreground uppercase border border-border">
                                            #{i + 1}
                                        </div>
                                        <CardTitle className="text-2xl font-bold tracking-tight leading-tight text-foreground pr-10">
                                            {r.text}
                                        </CardTitle>
                                    </div>

                                    <div className="grid gap-8 md:grid-cols-2">
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Your Response</Label>
                                            <TranscriptBlock transcript={r.transcript} />
                                        </div>
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">Your Recording</Label>
                                            <div className="rounded-2xl border border-border overflow-hidden bg-muted/20">
                                                <RecordingBlock
                                                    questionId={r.id}
                                                    hasRecording={r.hasRecording}
                                                    hasThumbnail={r.hasThumbnail}
                                                    kind={r.recordingKind ?? "audio"}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="lg:col-span-4 bg-muted/10 p-8 lg:p-10 border-t lg:border-t-0 lg:border-l border-border flex flex-col justify-between gap-10">
                                    <div className="space-y-8">
                                        <div className="flex items-center gap-3 text-muted-foreground/60">
                                            <TrendingUp className="h-4 w-4" />
                                            <span className="text-[10px] font-bold uppercase tracking-widest">Evaluation Metrics</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-8">
                                            <div className="space-y-1">
                                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Accuracy</p>
                                                <p className="text-3xl font-bold tracking-tight text-primary">
                                                    {r.correctnessScore != null ? `${Math.round(r.correctnessScore)}%` : "—"}
                                                </p>
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Confidence</p>
                                                <p className="text-3xl font-bold tracking-tight text-foreground/80">
                                                    {r.confidenceScore != null ? `${Math.round(r.confidenceScore)}%` : "—"}
                                                </p>
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">Eye Contact</p>
                                                <p className="text-3xl font-bold tracking-tight text-foreground/80">
                                                    {r.eyeContactScore != null ? `${Math.round(r.eyeContactScore)}%` : "—"}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {r.aiFeedback && (
                                        <div className="p-6 rounded-2xl bg-primary/5 border border-primary/10 shadow-sm relative transition-all hover:bg-primary/[0.08]">
                                            <div className="flex items-center gap-2 mb-3 text-primary">
                                                <Sparkles className="h-4 w-4" />
                                                <span className="text-[10px] font-bold uppercase tracking-widest">Key Insight</span>
                                            </div>
                                            <p className="text-sm leading-relaxed text-foreground font-medium">
                                                "{r.aiFeedback}"
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            </div>
        </div>
    );
}
