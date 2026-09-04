import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import {
  InterviewResultsView,
  type ResultRow,
  type ResultSummary,
} from "@/components/InterviewResultsView";

export function ResultsPage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [result, setResult] = useState<ResultSummary>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [status, setStatus] = useState<string>("");

  const load = useCallback(async () => {
    if (!id) return null;
    const { data } = await api.get<{
      interview: { status: string };
      result: ResultSummary;
      questions: ResultRow[];
    }>(`/interview/results/${id}`);
    setStatus(data.interview.status);
    setResult(data.result);
    setRows(data.questions);
    return data.interview.status;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    (async () => {
      setLoading(true);
      try {
        const st = await load();
        if (cancelled) return;
        if (st === "processing") {
          setPolling(true);
          interval = setInterval(async () => {
            try {
              const next = await load();
              if (next !== "processing" && interval) {
                clearInterval(interval);
                interval = undefined;
                setPolling(false);
              }
            } catch {
              /* keep polling */
            }
          }, 2500);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [id, load]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1600px] flex justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading results…
      </div>
    );
  }

  if (!id) return null;

  return (
    <InterviewResultsView
      interviewId={id}
      status={status}
      result={result}
      rows={rows}
      polling={polling}
    />
  );
}
