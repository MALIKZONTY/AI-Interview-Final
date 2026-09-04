import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { 
  InterviewResultsView, 
  type ResultRow, 
  type ResultSummary 
} from "@/components/InterviewResultsView";

export function HistoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("completed");
  const [questions, setQuestions] = useState<ResultRow[]>([]);
  const [result, setResult] = useState<ResultSummary>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get<{
        interview: { status: string };
        result: ResultSummary;
        questions: ResultRow[];
      }>(`/interview/history/${id}`);
      setStatus(data.interview.status);
      setResult(data.result);
      setQuestions(data.questions);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading…
      </div>
    );
  }

  if (!id) return null;

  return (
    <InterviewResultsView
      interviewId={id}
      status={status}
      result={result}
      rows={questions}
      title="Interview History"
      dashboardHref="/"
    />
  );
}
