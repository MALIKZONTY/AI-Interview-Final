import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Circle, Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import {
  InterviewResultsView,
  type ResultRow,
  type ResultSummary,
} from "@/components/InterviewResultsView";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useInterviewStore } from "@/store/interviewStore";

const ANSWER_SECONDS = 30;

function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "video/webm";
}

/**
 * Timed interview: one MediaRecorder clip per question, auto-stops at 30s, uploads to API.
 */
export function InterviewSessionPage() {
  const navigate = useNavigate();
  const interviewId = useInterviewStore((s) => s.interviewId);
  const questions = useInterviewStore((s) => s.questions);
  const clearSession = useInterviewStore((s) => s.clearSession);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Bumps on effect cleanup so React Strict Mode double-mount does not double-start recording. */
  const armTokenRef = useRef(0);

  const [index, setIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(ANSWER_SECONDS);
  const [phase, setPhase] = useState<
    "arm" | "recording" | "uploading" | "generating" | "results"
  >("arm");
  const [streamReady, setStreamReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [genMessage, setGenMessage] = useState("Generating your results…");
  const [genFailed, setGenFailed] = useState(false);
  const [resultSummary, setResultSummary] = useState<ResultSummary>(null);
  const [resultRows, setResultRows] = useState<ResultRow[]>([]);
  const [resultsStatus, setResultsStatus] = useState("");
  const kickoffSent = useRef(false);

  const q = questions[index];
  const isLast = index === questions.length - 1;

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreamReady(false);
  }, []);

  useEffect(() => {
    if (!interviewId || questions.length === 0) {
      navigate("/", { replace: true });
      return;
    }

    let cancelled = false;

    async function media() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStreamReady(true);
      } catch {
        setMediaError("Camera/microphone required to continue the interview.");
      }
    }

    void media();

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current?.stop();
      cleanupStream();
    };
  }, [interviewId, questions.length, navigate, cleanupStream]);

  const stopRecordingAndUpload = useCallback(async () => {
    const rec = recorderRef.current;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!rec || rec.state === "inactive") {
      return;
    }

    setPhase("uploading");

    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });

    const blob = new Blob(chunksRef.current, { type: rec.mimeType });
    chunksRef.current = [];

    const fd = new FormData();
    fd.append("interviewId", interviewId!);
    fd.append("questionId", q.id);
    fd.append("video", blob, "answer.webm");

    try {
      await api.post("/interview/submit", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
    } catch {
      setError("Upload failed. Check your connection and try again from the dashboard.");
      setPhase("arm");
      return;
    }

    if (isLast) {
      cleanupStream();
      setGenFailed(false);
      kickoffSent.current = false;
      setGenMessage("Generating your results — transcripts, scores, and video signals…");
      setPhase("generating");
      return;
    }

    setIndex((i) => i + 1);
    setSecondsLeft(ANSWER_SECONDS);
    setPhase("arm");
  }, [cleanupStream, interviewId, isLast, q?.id]);

  const startQuestionRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !q) return;

    setError(null);
    chunksRef.current = [];
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(stream, { mimeType });
    recorderRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.start(250);
    setPhase("recording");
    setSecondsLeft(ANSWER_SECONDS);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          void stopRecordingAndUpload();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, [q, stopRecordingAndUpload]);

  useEffect(() => {
    if (!streamReady || mediaError || !q || phase !== "arm") return;
    const token = ++armTokenRef.current;
    const t = window.setTimeout(() => {
      if (token !== armTokenRef.current) return;
      startQuestionRecording();
    }, 500);
    return () => {
      armTokenRef.current += 1;
      clearTimeout(t);
    };
  }, [streamReady, mediaError, index, phase, q, startQuestionRecording]);

  useEffect(() => {
    if (phase !== "generating" || !interviewId) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const { data } = await api.get<{
          interview: { status: string };
          result: ResultSummary;
          questions: ResultRow[];
        }>(`/interview/results/${interviewId}`);
        if (cancelled) return;
        const st = data.interview.status;
        setResultsStatus(st);
        if (st === "completed") {
          setResultSummary(data.result);
          setResultRows(data.questions);
          setPhase("results");
          return;
        }
        if (st === "failed") {
          setGenFailed(true);
          setGenMessage("We couldn’t finish scoring this interview.");
          return;
        }
        if (st === "active" && !kickoffSent.current) {
          kickoffSent.current = true;
          try {
            await api.post(`/interview/${interviewId}/process`);
          } catch {
            kickoffSent.current = false;
          }
        }
        if (st === "processing") {
          setGenMessage("Analyzing your answers and video — almost there…");
        }
      } catch {
        if (!cancelled) setGenMessage("Still working — retrying…");
      }
    };

    void tick();
    const interval = setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase, interviewId]);

  if (phase === "generating") {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 animate-slide-up">
        <div className="relative mb-10 h-36 w-36">
          <div
            className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary/40 via-accent/30 to-primary/20 blur-xl animate-pulseSoft"
            aria-hidden
          />
          <div
            className="absolute left-2 top-3 h-14 w-14 rounded-full bg-primary/50 blur-md animate-orb-drift"
            aria-hidden
          />
          <div
            className="absolute bottom-4 right-0 h-12 w-12 rounded-full bg-accent/45 blur-md animate-orb-drift [animation-delay:-2s]"
            aria-hidden
          />
          <div className="relative flex h-full w-full items-center justify-center rounded-full border border-primary/20 bg-card/80 shadow-lg backdrop-blur-sm">
            <Sparkles className="h-14 w-14 text-primary animate-pulseSoft" />
          </div>
        </div>
        <Card className="w-full border-border/80 text-center overflow-hidden">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-primary/40 via-primary to-primary/40 animate-generating-bar" />
          </div>
          <CardHeader className="space-y-2">
            <CardTitle className="font-display text-xl">Please wait</CardTitle>
            <p className="text-sm text-muted-foreground leading-relaxed">{genMessage}</p>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-6 pb-10">
            {!genFailed && (
              <Loader2 className="h-11 w-11 animate-spin text-primary" aria-hidden />
            )}
            {genFailed && (
              <div className="flex flex-col gap-2 w-full max-w-xs">
                <Button
                  type="button"
                  onClick={() => {
                    setGenFailed(false);
                    kickoffSent.current = false;
                    setGenMessage("Retrying analysis…");
                    void api.post(`/interview/${interviewId}/process`).catch(() => {});
                  }}
                >
                  Retry analysis
                </Button>
                <Button variant="outline" type="button" onClick={() => navigate("/")}>
                  Back to dashboard
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase === "results" && interviewId) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <InterviewResultsView
          interviewId={interviewId}
          status={resultsStatus || "completed"}
          result={resultSummary}
          rows={resultRows}
          title="Interview complete"
          onBeforeDashboard={() => {
            clearSession();
          }}
        />
      </div>
    );
  }

  if (!q) {
    return null;
  }

  const progressPct = ((index + (phase === "uploading" ? 0.5 : 0)) / questions.length) * 100;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-slide-up">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">
            Question {index + 1} of {questions.length}
          </p>
          <h1 className="font-display text-xl font-semibold">Live interview</h1>
        </div>
        {phase === "recording" && (
          <Badge variant="outline" className="gap-1.5 border-red-300 text-red-700 dark:text-red-300">
            <Circle className="h-2 w-2 fill-red-500 text-red-500 animate-pulseSoft" />
            Recording
          </Badge>
        )}
        {phase === "uploading" && (
          <Badge className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Uploading…
          </Badge>
        )}
      </div>

      <Progress value={progressPct} />

      <div className="grid gap-6 md:grid-cols-5">
        <Card className="md:col-span-2 overflow-hidden border-border/80">
          <div className="aspect-video bg-black overflow-hidden flex items-center justify-center">
            <video 
              ref={videoRef} 
              className="h-full w-full object-cover -scale-x-100" 
              playsInline 
              muted 
              autoPlay 
            />
          </div>
        </Card>
        <Card className="md:col-span-3 border-border/80">
          <CardHeader>
            <CardTitle className="text-lg leading-snug">{q.text}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Time remaining</p>
                <p className="font-display text-5xl font-bold tabular-nums tracking-tight">
                  {secondsLeft}
                  <span className="text-2xl text-muted-foreground font-medium ml-1">s</span>
                </p>
              </div>
              <div className="h-16 w-16 rounded-full border-4 border-primary/30 flex items-center justify-center">
                <span className="text-sm font-medium text-primary">
                  {Math.round(((ANSWER_SECONDS - secondsLeft) / ANSWER_SECONDS) * 100)}%
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Recording starts automatically once your camera is ready. At 0s the clip uploads and
              the next question appears.
            </p>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}
            {mediaError && (
              <div className="space-y-2">
                <p className="text-sm text-red-600 dark:text-red-400">{mediaError}</p>
                <Button variant="outline" onClick={() => navigate("/")}>
                  Back to dashboard
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
