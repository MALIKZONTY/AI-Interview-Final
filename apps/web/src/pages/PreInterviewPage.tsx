import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, Mic, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
          "Could not access camera or microphone. Allow permissions in your browser and try again."
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
    const s = streamRef.current;
    if (s) {
      // Pass stream to session via a tiny module — we stop stream on prep unmount,
      // so session page will request fresh media. User clicks Start there again for clarity.
      navigate("/interview/session");
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-slide-up">
      <div>
        <h1 className="font-display text-2xl font-bold">Before you begin</h1>
        <p className="text-muted-foreground text-sm mt-1">
          We need your camera and microphone for video answers ({questions.length} questions, 30s
          each).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-border/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Camera className="h-4 w-4" /> Camera
            </CardTitle>
            <CardDescription>Used for confidence cues (presence, stability).</CardDescription>
          </CardHeader>
        </Card>
        <Card className="border-border/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Mic className="h-4 w-4" /> Microphone
            </CardTitle>
            <CardDescription>Your answer is transcribed for scoring.</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card className="overflow-hidden border-border/80">
        <CardContent className="p-0">
          <div className="aspect-video bg-black/90 flex items-center justify-center relative">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              playsInline
              muted
              autoPlay
            />
            {!ready && !error && (
              <span className="absolute text-sm text-white/80">Requesting permissions…</span>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <div
          className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
          role="alert"
        >
          <ShieldAlert className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={() => navigate("/")}>
          Cancel
        </Button>
        <Button onClick={goInterview} disabled={!ready}>
          Start interview
        </Button>
      </div>
    </div>
  );
}
