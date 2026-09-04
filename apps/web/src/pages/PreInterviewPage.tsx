import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, Mic, ShieldAlert, ArrowRight, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useInterviewStore } from "@/store/interviewStore";

/**
 * Requests camera + microphone, shows a live preview, then hands off to the timed interview.
 */
export function PreInterviewPage() {
  const navigate = useNavigate();
  const interviewId = useInterviewStore((s) => s.interviewId);
  const questions = useInterviewStore((s) => s.questions);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!interviewId || questions.length === 0) {
      navigate("/", { replace: true });
      return;
    }

    let cancelled = false;

    async function setup() {
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
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
        setReady(true);
      } catch {
        setError(
          "Access Denied: Camera and Microphone permissions are required to start the session. Please enable them in your browser settings."
        );
      }
    }

    void setup();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
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
                Prepare Your Environment
            </h1>
            <p className="text-muted-foreground font-medium text-lg max-w-xl">
                Please ensure your equipment is functioning correctly. You are about to start a {questions.length}-question interview session.
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
                        <Camera className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-xl font-bold tracking-tight">Camera Feed</CardTitle>
                    <CardDescription className="text-xs font-medium">Verify your framing and lighting for optimal video clarity during the session.</CardDescription>
                </CardHeader>
            </Card>

            <Card className="border-border bg-card shadow-sm rounded-3xl overflow-hidden">
                <CardHeader className="pb-6">
                    <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                        <Mic className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-xl font-bold tracking-tight">Audio Feed</CardTitle>
                    <CardDescription className="text-xs font-medium">Ensure your microphone is capturing clear audio for accurate analysis.</CardDescription>
                </CardHeader>
            </Card>

            <div className="p-6 rounded-3xl bg-muted/30 border border-border">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground leading-relaxed">
                    A quiet, well-lit environment is recommended to ensure the highest quality feedback.
                </p>
            </div>
        </div>

        {/* Preview Area */}
        <div className="lg:col-span-8 space-y-8">
            <Card className="overflow-hidden border-border bg-black shadow-lg rounded-[2.5rem] relative aspect-video group">
                <div className="absolute inset-0 z-0 bg-gradient-to-br from-primary/10 to-transparent opacity-30"></div>
                <video
                  ref={videoRef}
                  className="relative z-10 h-full w-full object-cover transition-opacity duration-1000"
                  playsInline
                  muted
                  autoPlay
                  style={{ opacity: ready ? 1 : 0 }}
                />
                
                {!ready && !error && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur-md">
                     <Loader2 className="h-8 w-8 animate-spin text-primary" />
                     <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Initialising Equipment...</p>
                  </div>
                )}

                {ready && (
                    <div className="absolute top-6 left-6 z-20">
                        <Badge className="bg-emerald-600 text-white border-none py-1.5 px-4 rounded-full text-[10px] font-bold tracking-widest flex items-center gap-2 shadow-lg shadow-emerald-500/20">
                            <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></div>
                            EQUIPMENT ACTIVE
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

            <div className="flex gap-4 justify-end pt-4">
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
