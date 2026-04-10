import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Polls interview status until processing completes, then routes to results.
 * If the interview is still "active" (e.g. /process never ran), triggers processing once.
 */
export function ProcessingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [message, setMessage] = useState("Analyzing your performance…");
  const [failed, setFailed] = useState(false);
  const kickoffSent = useRef(false);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const { data } = await api.get<{ interview: { status: string } }>(`/interview/results/${id}`);
        if (cancelled) return;

        if (data.interview.status === "completed") {
          navigate(`/interview/results/${id}`, { replace: true });
          return;
        }
        if (data.interview.status === "failed") {
          setFailed(true);
          setMessage("We couldn’t finish scoring this interview.");
          return;
        }
        if (data.interview.status === "processing") {
          setFailed(false);
          setMessage("Analyzing your performance…");
          return;
        }
        // Still "active" — server may not have started processing yet; kick off once.
        if (data.interview.status === "active" && !kickoffSent.current) {
          kickoffSent.current = true;
          setMessage("Starting analysis…");
          try {
            await api.post(`/interview/${id}/process`);
          } catch {
            setMessage("Waiting for analysis to start…");
          }
        }
      } catch {
        setMessage("Still working… retrying.");
      }
    };

    void tick();
    const interval = setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id, navigate]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center animate-slide-up">
      <Card className="w-full max-w-md border-border/80 text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="h-7 w-7 animate-pulseSoft" />
          </div>
          <CardTitle className="font-display text-xl">Please wait</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 pb-8">
          {!failed && <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden />}
          {failed && (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                onClick={() => {
                  setFailed(false);
                  kickoffSent.current = false;
                  void api.post(`/interview/${id}/process`).then(() => {
                    setMessage("Retrying analysis…");
                  });
                }}
              >
                Retry analysis
              </Button>
              <Button variant="outline" asChild>
                <Link to="/">Back to dashboard</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
