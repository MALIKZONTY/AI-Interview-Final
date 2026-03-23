import { Video } from "lucide-react";

export function RecordingBlock({ url }: { url: string | null | undefined }) {
  const u = url?.trim();
  if (!u) {
    return (
      <p className="text-sm text-muted-foreground rounded-md border border-dashed border-border/80 bg-muted/30 px-3 py-6 text-center">
        No recording stored for this answer.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs flex items-center gap-1.5">
        <Video className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Recording
      </p>
      <div className="rounded-lg border border-border/80 overflow-hidden bg-black shadow-inner">
        <video
          src={u}
          controls
          playsInline
          preload="metadata"
          className="w-full max-h-[min(50vh,320px)] object-contain mx-auto"
        />
      </div>
    </div>
  );
}
