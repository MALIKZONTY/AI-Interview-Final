import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, ShieldAlert, ArrowRight, X, Loader2, Camera, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useInterviewStore } from "@/store/interviewStore";

const BAR_COUNT = 40;
/** RMS above this counts as the candidate actually being picked up. */
const AUDIBLE_THRESHOLD = 0.06;

/**
 * Equipment check before the timed interview: live camera preview for framing, plus
 * a level meter that confirms the candidate is actually audible.
 */
export function PreInterviewPage() {
  const navigate = useNavigate();
  const interviewId = useInterviewStore((s) => s.interviewId);
  const questions = useInterviewStore((s) => s.questions);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0));
  const [heardVoice, setHeardVoice] = useState(false);

  useEffect(() => {
    if (!interviewId || questions.length === 0) {
      navigate("/", { replace: true });
      return;
    }

    let cancelled = false;
    let raf = 0;

    async function setup() {
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
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

        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.7;
        ctx.createMediaStreamSource(stream).connect(analyser);
        audioCtxRef.current = ctx;

        const bins = new Uint8Array(analyser.frequencyBinCount);
        const time = new Uint8Array(analyser.fftSize);

        const tick = () => {
          analyser.getByteFrequencyData(bins);
          analyser.getByteTimeDomainData(time);

          const usable = Math.floor(bins.length * 0.6);
          const per = Math.max(1, Math.floor(usable / BAR_COUNT));
          const next = new Array(BAR_COUNT);
          for (let i = 0; i < BAR_COUNT; i += 1) {
            let sum = 0;
            for (let j = 0; j < per; j += 1) sum += bins[i * per + j] ?? 0;
            next[i] = Math.min(1, sum / per / 190);
          }
          setLevels(next);

          let acc = 0;
          for (let i = 0; i < time.length; i += 1) {
            const v = (time[i] - 128) / 128;
            acc += v * v;
          }
          if (Math.sqrt(acc / time.length) > AUDIBLE_THRESHOLD) {
            setHeardVoice(true);
          }

          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        setReady(true);
      } catch {
        setError(
          "Access Denied: Camera and microphone permissions are required to start the session. Please enable them in your browser settings."
        );
      }
    }

    void setup();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      void audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [interviewId, questions.length, navigate]);

  function goInterview() {
    navigate("/interview/session");
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-12 animate-slide-up pb-20 mt-10 px-8">
      {/* Header section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div className="space-y-3">
          <Badge variant="outline" className="px-3 py-1 rounded-full border-primary/20 bg-primary/5 text-primary text-[10px] font-bold uppercase tracking-widest">
            Interview Readiness
          </Badge>
          <h1 className="font-display text-4xl font-bold tracking-tight text-foreground">
            Check Your Setup
          </h1>
          <p className="text-muted-foreground font-medium text-lg max-w-xl">
            Frame yourself in the shot and say a few words to test your microphone. You are about to start a {questions.length}-question session.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="rounded-full hover:bg-destructive/10 hover:text-destructive">
          <X className="h-6 w-6" />
        </Button>
      </div>

      <div className="grid lg:grid-cols-12 gap-8 items-start">
        {/* Requirement Cards */}
        <div className="lg:col-span-4 space-y-6">
          <Card className="border-border bg-card shadow-sm rounded-3xl overflow-hidden">
            <CardHeader className="pb-6">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                <Mic className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-xl font-bold tracking-tight">Audio Feed</CardTitle>
              <CardDescription className="text-xs font-medium">
                Say a few words and watch the meter respond. Clear audio is what your answers are scored from.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-border bg-card shadow-sm rounded-3xl overflow-hidden">
            <CardHeader className="pb-6">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                <Camera className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-xl font-bold tracking-tight">Camera Feed</CardTitle>
              <CardDescription className="text-xs font-medium">
                Centre your face and look at the lens. Alongside accuracy and vocal delivery, we
                measure eye contact.
              </CardDescription>
            </CardHeader>
          </Card>

          <div className="p-6 rounded-3xl bg-muted/30 border border-border">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground leading-relaxed">
              A quiet, well-lit room and a headset microphone give the most accurate feedback.
            </p>
          </div>
        </div>

        {/* Live level meter */}
        <div className="lg:col-span-8 space-y-8">
          <Card className="overflow-hidden border-border bg-black shadow-lg rounded-[2.5rem] relative aspect-video group">
            <div className="absolute inset-0 z-0 bg-gradient-to-br from-primary/10 to-transparent opacity-30"></div>

            <video
              ref={videoRef}
              className="absolute inset-0 z-10 h-full w-full object-cover -scale-x-100 transition-opacity duration-1000"
              playsInline
              muted
              autoPlay
              style={{ opacity: ready ? 1 : 0 }}
            />

            <div className="absolute inset-x-0 bottom-8 z-20 flex flex-col items-center gap-3 pointer-events-none">
              <div className="flex h-16 items-end gap-1.5" aria-hidden>
                {levels.map((v, i) => (
                  <div
                    key={i}
                    className={`w-1.5 rounded-full transition-[height] duration-75 ${ready ? "bg-primary" : "bg-white/10"}`}
                    style={{ height: `${Math.max(3, v * 62)}px` }}
                  />
                ))}
              </div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/60 text-center drop-shadow-lg">
                {heardVoice ? "Microphone is picking you up" : "Say something to test your microphone"}
              </p>
            </div>

            {!ready && !error && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur-md">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Initialising Equipment...</p>
              </div>
            )}

            {ready && (
              <div className="absolute top-6 left-6 z-20">
                <Badge
                  className={`border-none py-1.5 px-4 rounded-full text-[10px] font-bold tracking-widest flex items-center gap-2 shadow-lg text-white ${
                    heardVoice ? "bg-emerald-600 shadow-emerald-500/20" : "bg-white/20"
                  }`}
                >
                  {heardVoice ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></div>
                  )}
                  {heardVoice ? "AUDIO CONFIRMED" : "LISTENING"}
                </Badge>
              </div>
            )}
          </Card>

          {error && (
            <div className="p-6 rounded-3xl border border-destructive/20 bg-destructive/5 text-destructive animate-shake shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <ShieldAlert className="h-5 w-5" />
                <span className="text-[11px] font-bold uppercase tracking-widest">Hardware Alert</span>
              </div>
              <p className="text-xs font-medium leading-relaxed">{error}</p>
            </div>
          )}

          <div className="flex items-center gap-6 justify-end pt-4">
            {ready && !heardVoice && (
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                No sound detected yet
              </span>
            )}
            <Button
              className="h-14 rounded-2xl px-12 text-sm font-bold shadow-lg shadow-primary/20 group transition-all active:scale-95 bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={goInterview}
              disabled={!ready}
            >
              <span className="tracking-widest uppercase">Proceed to Session</span>
              <ArrowRight className="h-5 w-5 ml-4 transition-transform group-hover:translate-x-1.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
