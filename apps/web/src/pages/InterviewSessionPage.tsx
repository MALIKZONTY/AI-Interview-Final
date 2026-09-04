import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, BrainCircuit, ShieldCheck, Clock, Zap, ClipboardList, Scan, Activity, Video, Volume2, UserRound, CornerDownRight } from "lucide-react";
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
import { speak, cancelSpeech } from "@/lib/speech";

// three.js roughly doubles the bundle, so the avatar is only fetched once an
// interview actually reaches the session screen.
const InterviewerAvatar = lazy(() =>
  import("@/components/InterviewerAvatar").then((m) => ({ default: m.InterviewerAvatar }))
);

const ANSWER_SECONDS = 30;
const THINK_SECONDS = 10;

function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "video/webm";
}

/**
 * Timed interview. The interviewer reads each question aloud, the candidate answers
 * on camera, and the server may replace the next planned question with a follow-up
 * probing what was just said.
 *
 * Per question: ask (TTS) -> think -> record 30s -> upload. One clip carries both
 * tracks: the audio drives the transcript and vocal delivery, the video drives eye
 * contact only.
 */
export function InterviewSessionPage() {
  const navigate = useNavigate();
  const interviewId = useInterviewStore((s) => s.interviewId);
  const questions = useInterviewStore((s) => s.questions);
  const clearSession = useInterviewStore((s) => s.clearSession);
  const replaceQuestion = useInterviewStore((s) => s.replaceQuestion);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [levels, setLevels] = useState<number[]>(() => new Array(28).fill(0));
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [index, setIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(ANSWER_SECONDS);
  const [phase, setPhase] = useState<
    "arm" | "asking" | "reading" | "recording" | "uploading" | "generating" | "results"
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
    analyserRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setStreamReady(false);
  }, []);


  /**
   * Runs a visible countdown and fires `onDone` once when it reaches zero.
   *
   * The callback must not live inside a setState updater: React StrictMode invokes
   * updaters twice to surface impure ones, which previously started two
   * MediaRecorders on the same stream. Both wrote into the same chunk array and
   * corrupted the WebM header, so the answer could not be decoded or transcribed.
   */
  const runCountdown = useCallback((seconds: number, onDone: () => void) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setSecondsLeft(seconds);

    const deadline = Date.now() + seconds * 1000;
    let fired = false;

    timerRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left > 0 || fired) return;

      fired = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      onDone();
    }, 250);
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
          // Modest resolution: eye contact needs a readable face, not a sharp one,
          // and every extra megabit lands in storage and upload time.
          video: {
            facingMode: "user",
            width: { ideal: 640, max: 640 },
            height: { ideal: 480, max: 480 },
            frameRate: { ideal: 20, max: 24 },
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false, // keep true loudness — projection feeds the confidence score
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        // Analyser drives the on-screen level meter only; no audio is sent anywhere from here.
        try {
          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new Ctx();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.75;
          ctx.createMediaStreamSource(stream).connect(analyser);
          audioCtxRef.current = ctx;
          analyserRef.current = analyser;
        } catch {
          // Meter is decorative; a missing AudioContext must not block the interview.
        }

        setStreamReady(true);
      } catch {
        setMediaError("Camera and microphone access are required for the session. Please allow them and reload.");
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
    setResultsStatus("Listening back and preparing the next question...");

    // Wait for the recorder to flush its final chunk before assembling the blob.
    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
      };
      rec.stop();
    });

    if (blob.size < 2000) {
      setError("Nothing was captured. Check your camera and microphone, then try again.");
      setPhase("arm");
      return;
    }

    try {
      const form = new FormData();
      form.append("interviewId", interviewId ?? "");
      form.append("questionId", q?.id ?? "");
      form.append("recording", blob, blob.type.includes("mp4") ? "answer.mp4" : "answer.webm");
      const { data } = await api.post<{
        ok: boolean;
        done: boolean;
        nextQuestion: { id: string; orderIndex: number; text: string; isFollowUp: boolean } | null;
      }>("/interview/submit", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      // The server may have rewritten the next question into a follow-up on this answer.
      if (data?.nextQuestion) {
        replaceQuestion(data.nextQuestion);
      }
    } catch (err) {
      console.error("Answer upload failed:", err);
      setError("Your answer could not be uploaded. Connection interrupted.");
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
  }, [cleanupStream, interviewId, isLast, q?.id, replaceQuestion]);

  const startQuestionRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !q || !interviewId) return;
    // Guard against any double-invocation starting a second recorder on this stream.
    if (recorderRef.current && recorderRef.current.state !== "inactive") return;

    setError(null);

    try {
      const rec = new MediaRecorder(stream, {
        mimeType: pickMimeType(),
        videoBitsPerSecond: 1_000_000,
        audioBitsPerSecond: 128_000,
      });
      recorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      rec.start(1000);
      setPhase("recording");
      runCountdown(ANSWER_SECONDS, () => {
        void stopRecordingAndUpload();
      });
    } catch (e) {
      console.error("MediaRecorder failed to start:", e);
      setError("Could not start recording. Your browser may not support audio capture.");
    }
  }, [q, stopRecordingAndUpload, interviewId, runCountdown]);

  const startReadingPhase = useCallback(() => {
    if (!q) return;
    setPhase("reading");
    runCountdown(THINK_SECONDS, startQuestionRecording);
  }, [q, startQuestionRecording, runCountdown]);

  // Kept in a ref so the ask sequence below can start the timer without taking a
  // dependency on it — re-running that effect mid-question would cut the voice off.
  const startReadingRef = useRef(startReadingPhase);
  useEffect(() => {
    startReadingRef.current = startReadingPhase;
  });

  /**
   * Per question: read it aloud, then hand over to the thinking timer. Keyed on the
   * question rather than the phase, so setPhase inside does not restart it.
   */
  useEffect(() => {
    if (!streamReady || mediaError || !q) return;

    let cancelled = false;

    const ask = async () => {
      setPhase("asking");
      // Small beat so the question is on screen before the voice starts.
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      if (cancelled) return;
      await speak(q.id, q.text);
      if (cancelled) return;
      startReadingRef.current();
    };

    void ask();

    return () => {
      cancelled = true;
      cancelSpeech();
    };
  }, [index, streamReady, mediaError, q?.id]);

  /** Cuts the interviewer off and moves straight to thinking time. */
  const skipQuestionAudio = useCallback(() => {
    cancelSpeech();
    startReadingRef.current();
  }, []);

  useEffect(() => {
    const analyser = analyserRef.current;
    if (!analyser || (phase !== "recording" && phase !== "reading")) {
      setLevels((prev) => (prev.some((v) => v > 0) ? new Array(28).fill(0) : prev));
      return;
    }

    const bins = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;

    const tick = () => {
      analyser.getByteFrequencyData(bins);
      // Fold the spectrum into 28 bars, weighted toward speech frequencies.
      const usable = Math.floor(bins.length * 0.6);
      const per = Math.max(1, Math.floor(usable / 28));
      const next = new Array(28);
      for (let i = 0; i < 28; i += 1) {
        let sum = 0;
        for (let j = 0; j < per; j += 1) sum += bins[i * per + j] ?? 0;
        next[i] = Math.min(1, sum / per / 190);
      }
      setLevels(next);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

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

  if (mediaError) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 text-center">
        <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-[1.75rem] border border-destructive/20 bg-destructive/5">
          <Video className="h-9 w-9 text-destructive" />
        </div>
        <h2 className="font-display text-3xl font-bold tracking-tight mb-4">Camera or Microphone Unavailable</h2>
        <p className="text-base text-muted-foreground leading-relaxed mb-10">{mediaError}</p>
        <Button
          className="h-14 w-full rounded-2xl font-bold uppercase tracking-widest"
          onClick={() => window.location.reload()}
        >
          Retry
        </Button>
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
        {/* Voice capture feed */}
        <div className="lg:col-span-8 space-y-10">
          <div className="relative group">
            {/* Visual glow backdrop */}
            <div className="absolute -inset-1 bg-primary/10 rounded-[3rem] blur-2xl opacity-20 transition-opacity group-hover:opacity-30"></div>
            
            <Card className="relative overflow-hidden border-border bg-black rounded-[3rem] shadow-2xl aspect-video border-[4px] border-black transition-all">
                {/* Self view: framing feedback for the candidate, and the source of the eye-contact score */}
                <video
                  ref={videoRef}
                  className="absolute inset-0 h-full w-full object-cover -scale-x-100 transition-all duration-700"
                  playsInline
                  muted
                  autoPlay
                  style={{
                    opacity: phase === "uploading" ? 0.25 : phase === "asking" ? 0.35 : 1,
                    filter: phase === "uploading" ? "blur(4px)" : "none",
                  }}
                />

                {/* While the interviewer speaks, they take the foreground */}
                {phase === "asking" && (
                  <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-8 bg-black/45 backdrop-blur-sm animate-in fade-in duration-500">
                    <div className="relative flex items-center justify-center">
                      <div className="absolute h-56 w-56 rounded-full border border-primary/20 animate-ping [animation-duration:2.4s]" />

                      {/* 3D head; the static circle underneath shows through if it cannot render */}
                      <div className="relative z-10 h-52 w-52 overflow-hidden rounded-full border border-primary/40 bg-primary/10 backdrop-blur-md">
                        <div className="absolute inset-0 flex items-center justify-center">
                          <UserRound className="h-16 w-16 text-primary/50" />
                        </div>
                        <Suspense fallback={null}>
                          <InterviewerAvatar speaking={phase === "asking"} className="absolute inset-0 h-full w-full" />
                        </Suspense>
                      </div>

                      <div className="absolute bottom-2 right-2 z-20 flex h-9 w-9 items-center justify-center rounded-full border-2 border-black bg-primary">
                        <Volume2 className="h-4 w-4 text-white" />
                      </div>
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/60">
                      Your interviewer is speaking
                    </p>
                  </div>
                )}

                {/* Mic level, so a dead microphone is obvious before the answer is spent */}
                {(phase === "recording" || phase === "reading") && (
                  <div className="absolute inset-x-0 bottom-8 z-30 flex flex-col items-center gap-3 pointer-events-none">
                    <div className="flex h-12 items-end gap-1" aria-hidden>
                      {levels.map((v, i) => (
                        <div
                          key={i}
                          className={`w-1.5 rounded-full transition-[height] duration-75 ${
                            phase === "recording" ? "bg-primary" : "bg-white/25"
                          }`}
                          style={{ height: `${Math.max(3, v * 48)}px` }}
                        />
                      ))}
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">
                      {phase === "recording" ? "Listening to your answer" : "Take a moment to think"}
                    </p>
                  </div>
                )}

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
                  {phase === "asking" && (
                    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-primary shadow-lg animate-in slide-in-from-left-6 duration-700">
                      <Volume2 className="h-4 w-4 text-white" />
                      <span className="text-[10px] font-black text-white uppercase tracking-[0.2em] leading-none">ASKING</span>
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
                          {q.isFollowUp ? (
                            <>
                              <CornerDownRight className="h-4 w-4" />
                              <span className="text-[10px] font-black uppercase tracking-[0.2em]">Follow-up on your last answer</span>
                            </>
                          ) : (
                            <>
                              <ClipboardList className="h-4 w-4" />
                              <span className="text-[10px] font-black uppercase tracking-[0.2em]">Context Query</span>
                            </>
                          )}
                      </div>
                      <CardTitle className="text-[1.75rem] font-bold tracking-tight text-foreground leading-[1.3] pr-2">
                        {q.text}
                      </CardTitle>
                   </div>

                   {/* Timer Feed (High-end) */}
                   <div className={`flex flex-col items-center justify-center w-20 h-20 rounded-[1.5rem] border-2 transition-all duration-500 shadow-lg shrink-0 ${phase === "reading" ? "border-primary/30 bg-primary/5 text-primary scale-90" : "border-primary/50 bg-primary/10 text-primary scale-100 shadow-primary/20"} relative overflow-hidden`}>
                      {phase === "asking" ? (
                        <Volume2 className="relative z-10 h-8 w-8 animate-pulse" />
                      ) : (
                        <>
                          <span className="relative z-10 text-3xl font-display font-black tabular-nums leading-none tracking-tighter">
                             {secondsLeft}s
                          </span>
                          <div className="absolute bottom-0 left-0 h-1.5 bg-primary/40 transition-all duration-1000" style={{ width: `${(secondsLeft / (phase === "reading" ? THINK_SECONDS : ANSWER_SECONDS)) * 100}%` }}></div>
                        </>
                      )}
                   </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex-1 p-10 space-y-10 bg-white dark:bg-card">
              <div className="space-y-10">
                {phase === "asking" ? (
                  <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-700">
                    <p className="text-lg text-muted-foreground font-medium leading-relaxed">
                      Your interviewer is reading the question aloud. Listen, or skip ahead when
                      you are ready.
                    </p>
                    <Button
                      variant="outline"
                      className="w-full h-16 rounded-2xl text-[11px] font-black gap-4 uppercase tracking-[0.2em]"
                      onClick={skipQuestionAudio}
                    >
                      <Zap className="h-5 w-5" />
                      Skip to thinking time
                    </Button>
                  </div>
                ) : phase === "reading" ? (
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
                       <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest ml-1 opacity-70">Camera and Microphone Active</span>
                       <div className="flex gap-2">
                           <div className="w-2 h-2 rounded-full bg-primary/30 animate-pulse"></div>
                           <div className="w-2 h-2 rounded-full bg-primary/50 animate-pulse [animation-delay:0.3s]"></div>
                           <div className="w-2 h-2 rounded-full bg-primary animate-pulse [animation-delay:0.6s]"></div>
                       </div>
                    </div>
                    
                    <div className="space-y-6">
                        <div className="flex items-center gap-3 text-emerald-600/60">
                            <ShieldCheck className="h-5 w-5" />
                            <span className="text-[11px] font-black uppercase tracking-[0.2em]">Delivery Analysis</span>
                        </div>
                        <p className="text-base font-medium text-muted-foreground leading-relaxed">
                            Speak clearly and look at the camera. Your pace, pauses, tone and eye contact are being measured.
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
