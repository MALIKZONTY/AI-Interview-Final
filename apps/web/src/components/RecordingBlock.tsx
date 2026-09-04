import { useEffect, useRef, useState } from "react";
import { AudioLines, Loader2, Play } from "lucide-react";
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
}: {
  questionId: string;
  hasRecording?: boolean;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Object URLs leak until revoked, and results pages hold several of these.
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

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
      const url = URL.createObjectURL(data);
      setObjectUrl(url);
      // Autoplay once loaded — the click that got us here is the user gesture.
      window.setTimeout(() => void audioRef.current?.play().catch(() => {}), 0);
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
        <AudioLines className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Your answer
      </p>

      {objectUrl ? (
        <audio ref={audioRef} src={objectUrl} controls preload="metadata" className="w-full" />
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
              Listen back
            </>
          )}
        </Button>
      )}
    </div>
  );
}
