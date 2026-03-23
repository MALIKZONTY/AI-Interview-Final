/**
 * Shows the answer transcript or explains how to enable local speech-to-text.
 */
export function TranscriptBlock({ transcript }: { transcript: string | null | undefined }) {
  const trimmed = transcript?.trim() ?? "";
  const isLegacyPlaceholder = trimmed.includes("Transcription placeholder");

  if (!trimmed || isLegacyPlaceholder) {
    return (
      <p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground leading-relaxed">
        No transcript stored. The AI service uses local{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">faster-whisper</code> (no cloud APIs).
        In <code className="rounded bg-muted px-1 py-0.5 text-xs">services/ai-service</code>, run{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">pip install -r requirements.txt</code>, ensure{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">ffmpeg</code> is on your PATH, set{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">WHISPER_MODEL_SIZE=tiny</code> or{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">base</code> in{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">.env</code>, then restart Uvicorn. First
        transcription downloads model weights (one-time).
      </p>
    );
  }

  return <p className="rounded-md bg-muted/50 p-3 text-sm whitespace-pre-wrap">{trimmed}</p>;
}
