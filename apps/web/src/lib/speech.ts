/**
 * Interviewer voice, via the browser's built-in SpeechSynthesis.
 *
 * No API key, no network call, no audio files to host. Every failure mode here is
 * non-fatal: the question is always on screen, so a browser that refuses to speak
 * (no voices installed, autoplay blocked, unsupported) just runs the interview silently.
 */

const MAX_UTTERANCE_MS = 45_000;

/** Voices that sound closest to a person, in preference order. */
const PREFERRED_VOICES = [
  "Google UK English Male",
  "Google US English",
  "Microsoft Guy Online",
  "Microsoft Aria Online",
  "Samantha",
  "Daniel",
  "Karen",
];

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Voices load asynchronously in Chrome and are empty on first call. Resolves as soon
 * as the list is populated, or after a short wait if it never is.
 */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.onvoiceschanged = null;
      resolve(window.speechSynthesis.getVoices());
    };

    window.speechSynthesis.onvoiceschanged = done;
    window.setTimeout(done, 1200);
  });
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;

  for (const name of PREFERRED_VOICES) {
    const match = voices.find((v) => v.name === name);
    if (match) return match;
  }

  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  // Local voices are lower latency and keep working offline.
  return english.find((v) => v.localService) ?? english[0] ?? voices[0];
}

/**
 * Speaks the given text, resolving when it finishes, is cancelled, or errors.
 * Always resolves — callers use it to gate the next phase, so it must never hang.
 */
export async function speak(text: string): Promise<void> {
  if (!isSpeechSupported() || !text.trim()) return;

  const synth = window.speechSynthesis;
  synth.cancel(); // drop anything still queued from a previous question

  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = await loadVoices();
  } catch {
    return;
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(guard);
      resolve();
    };

    // Chrome silently drops long utterances; never let a phase wait forever on one.
    const guard = window.setTimeout(() => {
      synth.cancel();
      finish();
    }, MAX_UTTERANCE_MS);

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoice(voices);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
      // Slightly slower than default reads as measured rather than hurried.
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      utterance.onend = finish;
      utterance.onerror = finish;

      synth.speak(utterance);
    } catch {
      finish();
    }
  });
}

export function cancelSpeech(): void {
  if (!isSpeechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Nothing to do — cancellation is best effort.
  }
}
