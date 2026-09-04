import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Loader2, Play, Video } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

/**
 * Plays back a stored answer recording.
 *
 * The audio lives behind an authenticated endpoint and may be held on local disk,
 * so it cannot be dropped straight into an `<audio src>`. It is fetched as a blob
 * on demand — lazily, so opening a results page with several answers does not pull
 * every recording at once — and played from an object URL.
 */
export function RecordingBlock({
  questionId,
  hasRecording,
  kind = "audio",
}: {
  questionId: string;
  hasRecording?: boolean;
  kind?: "audio" | "video";
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRef = useRef<HTMLMediaElement>(null);
  const durationProbed = useRef(false);

  // Object URLs leak until revoked, and results pages hold several of these.
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  /**
   * MediaRecorder writes a *live* WebM: the header carries no duration, so browsers
   * report Infinity and render a scrubber that cannot be dragged. Seeking far past
   * the end forces the browser to scan for the real duration; we then return to the
   * start, and the progress bar behaves normally from there.
   */
  const recoverDuration = useCallback(() => {
    const el = mediaRef.current;
    if (!el || durationProbed.current) return;
    if (Number.isFinite(el.duration) && el.duration > 0) return;

    durationProbed.current = true;
    const onProgress = () => {
      el.removeEventListener("timeupdate", onProgress);
      el.currentTime = 0;
    };
    el.addEventListener("timeupdate", onProgress, { once: true });
    try {
      el.currentTime = 1e101;
    } catch {
      el.removeEventListener("timeupdate", onProgress);
    }
  }, []);

  if (!hasRecording) {
    return (
      <p className="text-sm text-muted-foreground rounded-md border border-dashed border-border/80 bg-muted/30 px-3 py-6 text-center">
        No recording stored for this answer.
      </p>
    );
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<Blob>(`/interview/answer-audio/${questionId}`, {
        responseType: "blob",
      });
      setObjectUrl(URL.createObjectURL(data));
    } catch {
      setError("Recording could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  if (error) {
    return (
      <p className="text-sm text-muted-foreground rounded-md border border-dashed border-border/80 bg-muted/30 px-3 py-6 text-center">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-2 p-3">
      <p className="text-muted-foreground text-xs flex items-center gap-1.5">
        {kind === "video" ? (
          <Video className="h-3.5 w-3.5 shrink-0" aria-hidden />
        ) : (
          <AudioLines className="h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
        Your answer
      </p>

      {objectUrl ? (
        kind === "video" ? (
          <video
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            src={objectUrl}
            controls
            playsInline
            preload="auto"
            className="w-full rounded-lg bg-black max-h-[min(50vh,320px)]"
            onLoadedMetadata={recoverDuration}
            onDurationChange={recoverDuration}
          />
        ) : (
          <audio
            ref={mediaRef as React.RefObject<HTMLAudioElement>}
            src={objectUrl}
            controls
            preload="auto"
            className="w-full"
            onLoadedMetadata={recoverDuration}
            onDurationChange={recoverDuration}
          />
        )
      ) : (
        <Button
          variant="outline"
          className="w-full h-11 rounded-xl gap-2 text-xs font-bold uppercase tracking-widest"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              {kind === "video" ? "Watch back" : "Listen back"}
            </>
          )}
        </Button>
      )}
    </div>
  );
}
