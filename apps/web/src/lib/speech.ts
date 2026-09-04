import { api } from "@/lib/api";

/**
 * Interviewer voice.
 *
 * Preferred path is the server's neural voice (Piper), fetched as a WAV and played
 * through Web Audio so the avatar can read its amplitude and move its mouth in time.
 * If that is unavailable the browser's own SpeechSynthesis reads the question, and
 * if that fails too the interview simply runs silently — the question is always on
 * screen, so nothing here is allowed to block the session.
 */

const MAX_UTTERANCE_MS = 60_000;

/** Voices that sound closest to a person, in preference order. */
const PREFERRED_VOICES = [
  "Google UK English Male",
  "Google US English",
  "Microsoft Guy Online",
  "Microsoft Aria Online",
  "Samantha",
  "Daniel",
];

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let currentSource: AudioBufferSourceNode | null = null;

/** Live amplitude of the interviewer's voice (0-1), for lip-sync. 0 when silent. */
export function getSpeechAnalyser(): AnalyserNode | null {
  return analyser;
}

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function getContext(): AudioContext | null {
  if (audioCtx) return audioCtx;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctx();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.55;
    analyser.connect(audioCtx.destination);
    return audioCtx;
  } catch {
    return null;
  }
}

/** Plays a WAV through the analyser. Resolves when playback ends or is cancelled. */
function playBuffer(data: ArrayBuffer): Promise<boolean> {
  const ctx = getContext();
  if (!ctx || !analyser) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    ctx.decodeAudioData(
      data,
      (decoded) => {
        // Autoplay policy suspends fresh contexts until a gesture; the click that
        // started the interview counts, so resuming here is normally enough.
        void ctx.resume().catch(() => {});

        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(analyser!);
        currentSource = source;

        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(guard);
          if (currentSource === source) currentSource = null;
          resolve(ok);
        };

        const guard = window.setTimeout(() => {
          try {
            source.stop();
          } catch {
            // already stopped
          }
          finish(true);
        }, MAX_UTTERANCE_MS);

        source.onended = () => finish(true);
        try {
          source.start();
        } catch {
          finish(false);
        }
      },
      () => resolve(false)
    );
  });
}

/** Server-rendered neural voice. Returns false when unavailable. */
async function speakWithServerVoice(questionId: string): Promise<boolean> {
  try {
    const res = await api.post(
      "/interview/speak",
      { questionId },
      { responseType: "arraybuffer", validateStatus: (s) => s === 200 || s === 204 }
    );
    if (res.status === 204) return false;
    const data = res.data as ArrayBuffer;
    if (!data || data.byteLength === 0) return false;
    return await playBuffer(data);
  } catch {
    return false;
  }
}

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
  return english.find((v) => v.localService) ?? english[0] ?? voices[0];
}

/** Browser fallback. Always resolves, so a phase never waits on it forever. */
async function speakWithBrowser(text: string): Promise<void> {
  if (!isSpeechSupported() || !text.trim()) return;

  const synth = window.speechSynthesis;
  synth.cancel();

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
      utterance.rate = 0.95;
      utterance.onend = finish;
      utterance.onerror = finish;
      synth.speak(utterance);
    } catch {
      finish();
    }
  });
}

/**
 * Speaks a question, preferring the server voice and falling back to the browser.
 * Resolves when the audio finishes; never rejects.
 */
export async function speak(questionId: string, text: string): Promise<void> {
  cancelSpeech();
  if (await speakWithServerVoice(questionId)) return;
  await speakWithBrowser(text);
}

export function cancelSpeech(): void {
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {
      // already finished
    }
    currentSource = null;
  }
  if (isSpeechSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // best effort
    }
  }
}
