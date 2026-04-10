import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Circle, Loader2, Sparkles, BrainCircuit, Play, ArrowRight, ShieldCheck, Clock, Zap, ClipboardList, Scan, Activity } from "lucide-react";
import { api } from "@/lib/api";
import {
  InterviewResultsView,
  type ResultRow,
  type ResultSummary,
} from "@/components/InterviewResultsView";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const armTokenRef = useRef(0);

  const [index, setIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(ANSWER_SECONDS);
  const [phase, setPhase] = useState<
    "arm" | "reading" | "recording" | "uploading" | "generating" | "results"
  >("arm");
  const [streamReady, setStreamReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [genMessage, setGenMessage] = useState("Generating evaluation...");
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
        setMediaError("Connection Denied: Camera and Microphone permissions are required for the session.");
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
    setResultsStatus("Syncing Session Data...");

    await new Promise<void>((resolve) => {
      rec.onstop = () => {
        setTimeout(() => resolve(), 8000); // Buffer for cloud sync
      };
      if (rec.state !== "inactive") {
        rec.stop();
      } else {
        setTimeout(() => resolve(), 8000);
      }
    });

    try {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      await api.post("/interview/submit", { 
        interviewId, 
        questionId: q?.id 
      });
      
    } catch (err) {
      console.error("Session sync error:", err);
      setError("Recording failed to sync. Connection interrupted.");
      setPhase("arm");
      return;
    }

    if (isLast) {
      cleanupStream();
      setGenFailed(false);
      kickoffSent.current = false;
      setGenMessage("Calculating performance metrics and scoring responses...");
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

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let wsUrl = "";
    const apiUrl = import.meta.env.VITE_API_URL || "";

    if (apiUrl.startsWith("http")) {
      wsUrl = apiUrl.replace(/^http/, protocol) + `/interview/stream?interviewId=${interviewId}&questionId=${q.id}`;
    } else {
      const host = window.location.host;
      wsUrl = `${protocol}//${host}${apiUrl}/interview/stream?interviewId=${interviewId}&questionId=${q.id}`;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        console.log("[session] Live feed connected");
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

      rec.start(100);
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
    } catch (e) {
      setError("Connection Error: Could not establish live interview feed.");
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
          setGenMessage("Analysis Unsuccessful. Please try refreshing.");
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
          setGenMessage("Evaluating responses and grading technical accuracy...");
        }
      } catch {
        if (!cancelled) setGenMessage("Network delay: Re-fetching metrics...");
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
      <div className="mx-auto flex min-h-[80vh] max-w-2xl flex-col items-center justify-center px-4 animate-slide-up">
        <div className="relative mb-12 h-40 w-40 flex items-center justify-center">
           <div className="absolute inset-x-0 top-0 h-1 bg-primary/40 rounded-full animate-scan z-20"></div>
           <div className="absolute inset-0 rounded-full bg-primary/20 blur-3xl animate-pulse"></div>
           <div className="relative z-10 flex h-full w-full items-center justify-center rounded-[2.5rem] border-2 border-primary/20 bg-card shadow-2xl overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent"></div>
              <ClipboardList className="h-16 w-16 text-primary animate-float" />
           </div>
           
           {/* High-tech orbits */}
           <div className="absolute inset-[-20px] border border-primary/10 rounded-full animate-spin-slow"></div>
           <div className="absolute inset-[-40px] border border-primary/5 rounded-full animate-reverse-spin-slow"></div>
        </div>

        <Card className="w-full border-border text-center overflow-hidden bg-white dark:bg-card shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] rounded-[3rem]">
          <div className="h-2 w-full overflow-hidden bg-muted" aria-hidden>
            <div className="h-full w-full bg-primary animate-generating-bar shadow-[0_0_12px_rgba(var(--primary),0.5)]" />
          </div>
          <CardHeader className="space-y-4 py-12 px-10">
            <CardTitle className="font-display text-3xl font-bold tracking-tight text-foreground uppercase tracking-widest">Performance Analysis</CardTitle>
            <p className="text-base text-muted-foreground font-medium px-8 leading-relaxed max-w-md mx-auto">{genMessage}</p>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-8 pb-14">
            {!genFailed && (
              <div className="flex items-center gap-3 px-6 py-2.5 rounded-full bg-primary/5 border border-primary/10">
                 <div className="flex gap-1">
                    <div className="w-1 h-1 rounded-full bg-primary animate-bounce"></div>
                    <div className="w-1 h-1 rounded-full bg-primary animate-bounce [animation-delay:0.2s]"></div>
                    <div className="w-1 h-1 rounded-full bg-primary animate-bounce [animation-delay:0.4s]"></div>
                 </div>
                 <span className="text-[10px] font-bold text-primary uppercase tracking-[0.2em]">Engaging Mentor Insight</span>
              </div>
            )}
            {genFailed && (
              <div className="flex flex-col gap-4 w-full max-w-sm">
                <Button className="rounded-2xl h-14 font-bold uppercase tracking-widest shadow-lg shadow-primary/20" onClick={() => {
                    setGenFailed(false);
                    kickoffSent.current = false;
                    setGenMessage("Retrying Evaluation Phase...");
                    void api.post(`/interview/${interviewId}/process`).catch(() => {});
                }}>
                  Retry Assessment
                </Button>
                <Button variant="ghost" className="rounded-2xl h-14 font-bold uppercase tracking-widest text-muted-foreground" onClick={() => navigate("/")}>
                  Back to Dashboard
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
      <div className="mx-auto w-full max-w-[1700px]">
        <InterviewResultsView
          interviewId={interviewId}
          status={resultsStatus || "completed"}
          result={resultSummary}
          rows={resultRows}
          title="Performance Feedback Report"
          onBeforeDashboard={() => {
            clearSession();
          }}
        />
      </div>
    );
  }

  if (!q) return null;

  const progressPct = ((index + (phase === "uploading" ? 0.5 : 0)) / questions.length) * 100;

  return (
    <div className="w-full animate-slide-up pb-10 px-0 mt-4 px-8">
      {/* Professional Interview Header */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-12">
        <div className="space-y-4 text-center md:text-left">
          <Badge variant="outline" className="px-4 py-1 rounded-full border-primary/20 bg-primary/5 text-primary text-[10px] font-bold uppercase tracking-[0.2em] shadow-sm">
             Session Live & Synchronized
          </Badge>
          <h1 className="font-display text-5xl font-bold tracking-tighter text-foreground">
            Question {index + 1} <span className="text-muted-foreground/20 font-light mx-2">/</span> {questions.length}
          </h1>
        </div>
        
        <div className="flex items-center gap-8 bg-card border border-border px-8 py-5 rounded-[2rem] shadow-sm relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] to-transparent"></div>
            <div className="flex flex-col items-start pr-10 border-r border-border relative z-10">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 opacity-60">Status</span>
                <span className="flex items-center gap-2.5 text-[10px] font-bold text-emerald-600 uppercase tracking-[0.1em]">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></div>
                    Optimized Feed
                </span>
            </div>
            <div className="flex flex-col items-start relative z-10">
               <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 opacity-60">Session ID</span>
               <span className="text-[10px] font-bold text-foreground uppercase tracking-widest font-mono opacity-80">
                  {interviewId?.substring(0, 8) || "SESSION"}
               </span>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        {/* Widescreen Video Intelligence Feed */}
        <div className="lg:col-span-8 space-y-10">
          <div className="relative group">
            {/* Visual glow backdrop */}
            <div className="absolute -inset-1 bg-primary/10 rounded-[3rem] blur-2xl opacity-20 transition-opacity group-hover:opacity-30"></div>
            
            <Card className="relative overflow-hidden border-border bg-black rounded-[3rem] shadow-2xl aspect-video border-[4px] border-black transition-all">
                <video 
                  ref={videoRef} 
                  className="h-full w-full object-cover -scale-x-100 transition-all duration-1000" 
                  playsInline 
                  muted 
                  autoPlay 
                  style={{ opacity: phase === "uploading" ? 0.4 : 1, filter: phase === "uploading" ? "blur(4px)" : "none" }}
                />

                {/* Corner Accents (The 'Wow' Factor) */}
                <div className="absolute top-8 left-8 w-12 h-12 border-l-2 border-t-2 border-white/20 rounded-tl-xl pointer-events-none"></div>
                <div className="absolute top-8 right-8 w-12 h-12 border-r-2 border-t-2 border-white/20 rounded-tr-xl pointer-events-none"></div>
                <div className="absolute bottom-8 left-8 w-12 h-12 border-l-2 border-b-2 border-white/20 rounded-bl-xl pointer-events-none"></div>
                <div className="absolute bottom-8 right-8 w-12 h-12 border-r-2 border-b-2 border-white/20 rounded-br-xl pointer-events-none"></div>
                
                {/* HUD Overlays */}
                <div className="absolute top-8 left-8 z-40 flex flex-col gap-3">
                  {phase === "recording" && (
                    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-red-600 shadow-[0_8px_24px_-4px_rgba(220,38,38,0.4)] animate-in slide-in-from-left-6 duration-700">
                      <div className="w-2 h-2 rounded-full bg-white animate-pulse"></div>
                      <span className="text-[10px] font-black text-white uppercase tracking-[0.2em] leading-none">REC. LIVE</span>
                    </div>
                  )}
                  {phase === "reading" && (
                    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-primary shadow-lg animate-in slide-in-from-left-6 duration-700">
                      <Clock className="h-4 w-4 text-white" />
                      <span className="text-[10px] font-black text-white uppercase tracking-[0.2em] leading-none">EVALUATING CONTEXT</span>
                    </div>
                  )}
                  {phase === "uploading" && (
                    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/10 backdrop-blur-md border border-white/20">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                      <span className="text-[10px] font-black text-white uppercase tracking-[0.2em] leading-none">SYNCING</span>
                    </div>
                  )}
                </div>

                {/* Processing Overlay (The 'Perfect' Opacity) */}
                {phase === "uploading" && (
                  <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-700">
                    <div className="relative mb-6">
                        <div className="absolute inset-0 bg-primary/40 blur-2xl animate-pulse"></div>
                        <Loader2 className="relative z-10 h-14 w-14 animate-spin text-white opacity-80" />
                    </div>
                    <h3 className="text-white font-display text-3xl font-bold tracking-tight mb-3 drop-shadow-lg">Syncing Statistics</h3>
                    <p className="text-white/60 text-[10px] font-bold uppercase tracking-[0.3em] text-center px-12 max-w-sm leading-relaxed">
                        Anchoring your response to the career blue-print for analytical scoring.
                    </p>
                  </div>
                )}

                {/* Scanner Line Effect during Recording */}
                {phase === "recording" && (
                     <div className="absolute inset-x-0 h-[2px] bg-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.5)] z-20 top-0 animate-scan pointer-events-none opacity-40"></div>
                )}
            </Card>
          </div>
          
          {/* Continuity Progress */}
          <div className="px-6 space-y-4">
            <div className="flex justify-between items-end text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground/40">
              <span className="flex items-center gap-2">
                <Activity className="h-3 w-3" />
                Session Progress
              </span>
              <span className="text-primary font-black tracking-tighter">{Math.round(progressPct)}%</span>
            </div>
            <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden p-0.5 border border-border shadow-inner">
              <div 
                className="h-full bg-primary rounded-full transition-all duration-1000 ease-in-out shadow-[0_0_10px_rgba(var(--primary),0.3)]" 
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Right Side: Analytical Context Card */}
        <div className="lg:col-span-4 h-full">
          <Card className="border-border bg-card shadow-2xl rounded-[3rem] overflow-hidden flex flex-col h-full border-[1.5px] transition-all hover:shadow-primary/5">
            <CardHeader className="p-10 pb-8 border-b border-border bg-muted/20 relative">
              <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                 <BrainCircuit className="w-24 h-24" />
              </div>
              <div className="space-y-8 flex flex-col relative z-10">
                <div className="flex justify-between items-start gap-4">
                   <div className="space-y-4">
                      <div className="flex items-center gap-3 text-primary/60">
                          <ClipboardList className="h-4 w-4" />
                          <span className="text-[10px] font-black uppercase tracking-[0.2em]">Context Query</span>
                      </div>
                      <CardTitle className="text-[1.75rem] font-bold tracking-tight text-foreground leading-[1.3] pr-2">
                        {q.text}
                      </CardTitle>
                   </div>

                   {/* Timer Feed (High-end) */}
                   <div className={`flex flex-col items-center justify-center w-20 h-20 rounded-[1.5rem] border-2 transition-all duration-500 shadow-lg shrink-0 ${phase === "reading" ? "border-primary/30 bg-primary/5 text-primary scale-90" : "border-primary/50 bg-primary/10 text-primary scale-100 shadow-primary/20"} relative overflow-hidden`}>
                      <span className="relative z-10 text-3xl font-display font-black tabular-nums leading-none tracking-tighter">
                         {secondsLeft}s
                      </span>
                      <div className="absolute bottom-0 left-0 h-1.5 bg-primary/40 transition-all duration-1000" style={{ width: `${(secondsLeft / (phase === "reading" ? THINK_SECONDS : ANSWER_SECONDS)) * 100}%` }}></div>
                   </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex-1 p-10 space-y-10 bg-white dark:bg-card">
              <div className="space-y-10">
                {phase === "reading" ? (
                  <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-700">
                    <p className="text-lg text-muted-foreground font-medium leading-relaxed">
                      Analyze the question carefully. Focus on articulating your technical depth and leadership experience.
                    </p>
                    <Button 
                      className="w-full h-16 rounded-2xl text-[11px] font-black gap-4 shadow-xl shadow-primary/20 group transition-all bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.2em]" 
                      onClick={startQuestionRecording}
                    >
                      <Zap className="h-5 w-5 fill-current" />
                      Skip reading question
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-10 animate-in fade-in duration-1000">
                    <div className="p-6 rounded-2xl bg-muted/40 border border-border flex items-center justify-between shadow-inner">
                       <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest ml-1 opacity-70">Capture Feed Active</span>
                       <div className="flex gap-2">
                           <div className="w-2 h-2 rounded-full bg-primary/30 animate-pulse"></div>
                           <div className="w-2 h-2 rounded-full bg-primary/50 animate-pulse [animation-delay:0.3s]"></div>
                           <div className="w-2 h-2 rounded-full bg-primary animate-pulse [animation-delay:0.6s]"></div>
                       </div>
                    </div>
                    
                    <div className="space-y-6">
                        <div className="flex items-center gap-3 text-emerald-600/60">
                            <ShieldCheck className="h-5 w-5" />
                            <span className="text-[11px] font-black uppercase tracking-[0.2em]">Quality Assurance Sync</span>
                        </div>
                        <p className="text-base font-medium text-muted-foreground leading-relaxed">
                            Maintain consistent volume and professional posture. Your behavioral signals are being indexed.
                        </p>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="p-5 rounded-2xl border border-destructive/30 bg-destructive/5 text-center animate-shake">
                    <p className="text-[10px] font-bold text-destructive uppercase tracking-widest leading-relaxed">{error}</p>
                  </div>
                )}
              </div>
            </CardContent>
            
            <div className="p-8 bg-muted/10 border-t border-border flex items-center justify-between">
                <div className="flex items-center gap-3 text-muted-foreground/20">
                    <Scan className="h-4 w-4" />
                    <span className="text-[10px] font-black uppercase tracking-[0.3em]">EVOLVE PLATFORM v5.0</span>
                </div>
                <div className="w-2 h-2 rounded-full bg-primary animate-ping"></div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
