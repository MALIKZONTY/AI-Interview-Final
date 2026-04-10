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
const THINK_SECONDS = 10;

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
    "arm" | "reading" | "recording" | "uploading" | "generating" | "results"
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
          video: { 
            facingMode: "user",
            width: { min: 320, ideal: 640, max: 640 },
            height: { min: 240, ideal: 480, max: 480 },
            frameRate: { ideal: 20, max: 24 }
          },
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

  const wsRef = useRef<WebSocket | null>(null);

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
    setResultsStatus("Finalizing live stream (10s buffer)...");

    // Stop recorder and wait for final data
    await new Promise<void>((resolve) => {
      rec.onstop = () => {
        setTimeout(() => resolve(), 10000);
      };
      if (rec.state !== "inactive") {
        rec.stop();
      } else {
        setTimeout(() => resolve(), 10000);
      }
    });

    setResultsStatus("Closing stream and saving...");
    try {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      // Wait for backend to finalize the file and update the DB
      setResultsStatus("Verifying and saving answer...");
      await api.post("/interview/submit", { 
        interviewId, 
        questionId: q?.id 
      });
      
      setResultsStatus("Answer saved.");
    } catch (err) {
      console.error("Stream finalization error:", err);
      setError("Recording failed to sync. Please check your connection.");
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
    setSecondsLeft(THINK_SECONDS);
    setPhase("arm");
    setResultsStatus("");
  }, [cleanupStream, interviewId, isLast, q?.id]);

  const startQuestionRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !q || !interviewId) return;

    setError(null);
    const mimeType = pickMimeType();

    // Setup Live Streaming WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let wsUrl = "";
    const apiUrl = import.meta.env.VITE_API_URL || "";

    if (apiUrl.startsWith("http")) {
      wsUrl = apiUrl.replace(/^http/, protocol) + `/interview/stream?interviewId=${interviewId}&questionId=${q.id}`;
    } else {
      // Relative path (like /api), use current host
      const host = window.location.host;
      wsUrl = `${protocol}//${host}${apiUrl}/interview/stream?interviewId=${interviewId}&questionId=${q.id}`;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        console.log("[stream] WebSocket connected");
      };
      ws.onerror = (e) => {
        console.error("[stream] WebSocket error", e);
        setError("Connection lost. Streaming failed.");
      };

      const rec = new MediaRecorder(stream, { 
        mimeType,
        videoBitsPerSecond: 1_000_000, 
        audioBitsPerSecond: 96_000
      });
      recorderRef.current = rec;

      rec.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(e.data);
        }
      };

      // Start recording with tiny 100ms chunks for real-time streaming
      rec.start(100);
      setPhase("recording");
      setResultsStatus("Streaming live...");
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
    } catch (e) {
      console.error("Failed to start stream", e);
      setError("Could not establish live stream. Check your connection.");
    }
  }, [q, stopRecordingAndUpload, interviewId]);

  const startReadingPhase = useCallback(() => {
    if (!q) return;
    setPhase("reading");
    setSecondsLeft(THINK_SECONDS);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          startQuestionRecording();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, [q, startQuestionRecording]);

  useEffect(() => {
    if (!streamReady || mediaError || !q || phase !== "arm") return;
    const token = ++armTokenRef.current;
    const t = window.setTimeout(() => {
      if (token !== armTokenRef.current) return;
      startReadingPhase();
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
    <div className="max-w-[1400px] mx-auto animate-slide-up pb-10 px-4 mt-6">
      {/* Mini Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Badge variant="outline" className="uppercase tracking-[0.2em] text-[10px] bg-muted/30 border-muted-foreground/20 py-1 px-4">
            Interview in Progress
          </Badge>
          <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground/60 uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
            Connection Healthy
          </div>
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Question <span className="text-primary">{index + 1}</span> <span className="text-muted-foreground/40 font-light">/</span> {questions.length}
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Side: Video (65% width on large screens) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 rounded-[2.1rem] blur-xl opacity-30"></div>
            <Card className="relative overflow-hidden border-border/40 bg-black rounded-[2rem] shadow-2xl ring-1 ring-white/10 aspect-[4/3] lg:aspect-video">
              <div className="h-full w-full relative bg-slate-900 border border-white/5 rounded-[2rem] overflow-hidden">
                <video 
                  ref={videoRef} 
                  className="h-full w-full object-cover -scale-x-100 transition-opacity duration-700" 
                  playsInline 
                  muted 
                  autoPlay 
                  onLoadedMetadata={(e) => {
                    void e.currentTarget.play().catch(err => console.log("Autoplay blocked:", err));
                  }}
                />
                
                {/* Status Overlays */}
                <div className="absolute top-6 left-6 z-30 flex flex-col gap-3">
                  {phase === "recording" && (
                    <div className="flex items-center gap-2 bg-red-600/90 backdrop-blur-md text-white px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest border border-red-400/50 shadow-lg animate-pulse-red">
                      <div className="h-2 w-2 bg-white rounded-full animate-pulseSoft" />
                      LIVE STREAMING
                    </div>
                  )}
                  {phase === "reading" && (
                    <div className="flex items-center gap-2 bg-blue-600/90 backdrop-blur-md text-white px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest border border-blue-400/50 shadow-lg">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      READING PHASE
                    </div>
                  )}
                </div>

                {/* Shimmer for Uploading */}
                {phase === "uploading" && (
                  <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-md overflow-hidden">
                    <div className="absolute inset-0 animate-shimmer opacity-30"></div>
                    <div className="text-center relative z-50 px-6">
                      <Loader2 className="h-16 w-16 animate-spin text-primary mx-auto mb-6 drop-shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
                      <h3 className="text-white font-display text-2xl font-bold mb-2 tracking-tight">Finalizing Stream</h3>
                      <p className="text-white/60 text-[10px] font-bold uppercase tracking-[0.3em] animate-pulseSoft">
                        {resultsStatus || "Securing your answer..."}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
          
          {/* Progress Bar under video */}
          <div className="px-4">
            <div className="flex justify-between items-end mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              <span>Overall Progress</span>
              <span className="text-primary">{Math.round(progressPct)}% Complete</span>
            </div>
            <div className="w-full h-1 bg-muted/20 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-primary via-accent to-primary transition-all duration-700 ease-in-out" 
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Right Side: Context & Controls (35% width on large screens) */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="border-border/40 bg-card/40 backdrop-blur-xl shadow-xl overflow-hidden border-t-white/5 h-full flex flex-col">
            <CardHeader className="pb-6 pt-8 bg-muted/20 border-b border-border/20">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/10 pointer-events-none uppercase text-[9px] tracking-wider">
                    Current Question
                  </Badge>
                  
                  {/* Timer Dial (Sidebar size) */}
                  <div className={`flex flex-col items-center justify-center w-16 h-16 rounded-2xl border-2 transition-all duration-500 shadow-inner ${phase === "reading" ? "border-blue-500/30 bg-blue-500/5 shadow-[0_0_15px_rgba(59,130,246,0.15)]" : "border-primary/30 bg-primary/5 shadow-[0_0_15px_rgba(99,102,241,0.15)]"}`}>
                    <span className={`text-2xl font-black tabular-nums tracking-tighter ${phase === "reading" ? "text-blue-500" : "text-primary"}`}>
                       {secondsLeft}s
                    </span>
                  </div>
                </div>
                <CardTitle className="text-xl md:text-2xl font-display leading-[1.4] tracking-tight">
                  {q.text}
                </CardTitle>
              </div>
            </CardHeader>

            <CardContent className="flex-1 py-10 space-y-10">
              <div className="flex flex-col gap-6">
                {phase === "reading" ? (
                  <div className="space-y-4">
                    <p className="text-[11px] text-center text-muted-foreground italic leading-relaxed">
                      Taking your time to understand the requirements is key. 
                      Recording starts in {secondsLeft} seconds.
                    </p>
                    <Button 
                      variant="default" 
                      className="w-full h-14 text-sm font-bold gap-3 shadow-lg shadow-primary/20 group relative overflow-hidden transition-all duration-300 active:scale-95" 
                      onClick={startQuestionRecording}
                    >
                      <Sparkles className="h-4 w-4 text-accent-foreground" />
                      Start Recording Now
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-center justify-center gap-4 p-5 rounded-2xl bg-muted/30 border border-border/20">
                      <div className="flex gap-1 items-center h-4">
                        {[1, 2, 3].map((i) => (
                          <div 
                            key={i} 
                            className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" 
                            style={{ animationDelay: `${i * 0.1}s` }}
                          ></div>
                        ))}
                      </div>
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
                        Live AI Analysis
                      </p>
                    </div>
                    
                    <p className="text-xs text-center text-muted-foreground leading-relaxed px-4">
                      Keep your eyes focused on the camera for better confidence scoring.
                    </p>
                  </div>
                )}

                {error && (
                  <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/20 text-center animate-shake">
                    <p className="text-[11px] font-bold text-red-500" role="alert">
                      {error}
                    </p>
                  </div>
                )}

                {mediaError && (
                  <div className="p-6 rounded-2xl bg-destructive/5 border border-destructive/20 text-center space-y-4">
                    <p className="text-xs font-medium text-destructive">{mediaError}</p>
                    <Button variant="outline" size="sm" onClick={() => navigate("/")} className="w-full">
                      Return to Home
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
            
            <div className="p-6 bg-muted/10 border-t border-border/20 text-center">
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-bold">
                Secured End-to-End Transcription
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
