import axios from "axios";

const base = () => process.env.AI_SERVICE_URL ?? "http://localhost:8000";

export type GeneratedQuestion = {
  text: string;
  expected_answer: string;
  acceptable_variants: string[];
  keywords: string[];
  evaluation_rubric: Record<string, unknown>;
};

export async function aiGenerateQuestions(params: {
  resumeSummary: string;
  jdText: string;
  count?: number;
  difficulty?: string;
}): Promise<GeneratedQuestion[]> {
  const { data } = await axios.post<{ questions: GeneratedQuestion[] }>(
    `${base()}/generate-questions`,
    {
      resume_summary: params.resumeSummary,
      jd_text: params.jdText,
      count: params.count ?? 20,
      difficulty: params.difficulty ?? "Medium",
    },
    { timeout: 300_000 }
  );
  return data.questions;
}

export type VoiceMeta = Record<string, unknown> & {
  word_count?: number;
  wpm?: number | null;
  filler_rate?: number;
  pause_count?: number;
  speaking_ratio?: number | null;
  energy_mean?: number | null;
  energy_cv?: number | null;
};

export type TranscriptionResult = {
  text: string;
  segments: { start: number; end: number; text: string }[];
  voice_meta: VoiceMeta;
};

/**
 * Transcribes answer audio and returns the vocal delivery metrics alongside it —
 * both come from one pass so the wav is only decoded once.
 */
export async function aiSpeechToText(
  audioBuffer: Buffer,
  mimeType: string
): Promise<TranscriptionResult> {
  const FormData = (await import("form-data")).default;
  const form = new FormData();
  const ext = mimeType.includes("mp4") ? "mp4" : "webm";
  form.append("file", audioBuffer, { filename: `answer.${ext}`, contentType: mimeType });
  const { data } = await axios.post<Partial<TranscriptionResult>>(
    `${base()}/speech-to-text`,
    form,
    {
      headers: form.getHeaders(),
      timeout: 300_000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );
  return {
    text: data.text ?? "",
    segments: data.segments ?? [],
    voice_meta: data.voice_meta ?? {},
  };
}

export async function aiEvaluateAnswer(body: {
  question: string;
  expected_answer: string;
  acceptable_variants: string[];
  keywords: string[];
  evaluation_rubric: Record<string, unknown>;
  candidate_answer: string;
  speech_meta?: Record<string, unknown>;
  voice_meta?: Record<string, unknown>;
}): Promise<{
  correctness_score: number;
  confidence_score: number;
  debug?: Record<string, any>;
}> {
  const { data } = await axios.post<{
    correctness_score: number;
    confidence_score: number;
    debug?: Record<string, any>;
  }>(`${base()}/evaluate-answer`, body, { timeout: 300_000 });
  return data;
}

export async function aiGenerateSummaryFeedback(body: {
  avg_correctness: number;
  avg_confidence: number;
  interview_history: { question: string; answer: string }[];
}): Promise<string> {
  const { data } = await axios.post<{ summary: string }>(
    `${base()}/generate-summary-feedback`,
    body,
    { timeout: 60_000 }
  );
  return data.summary;
}

export type FollowUpDecision = {
  should_follow_up: boolean;
  reason?: string;
  question: GeneratedQuestion | null;
};

/**
 * Asks whether to probe the answer just given instead of moving to the planned
 * question. Never throws — the planned question is always a valid fallback.
 */
export async function aiGenerateFollowUp(body: {
  jdText: string;
  question: string;
  candidateAnswer: string;
  plannedNext: string;
  difficulty?: string;
}): Promise<FollowUpDecision> {
  try {
    const { data } = await axios.post<FollowUpDecision>(
      `${base()}/generate-followup`,
      {
        jd_text: body.jdText,
        question: body.question,
        candidate_answer: body.candidateAnswer,
        planned_next: body.plannedNext,
        difficulty: body.difficulty ?? "Medium",
      },
      { timeout: 45_000 }
    );
    return data;
  } catch (e) {
    console.error("[ai] follow-up generation failed:", (e as Error).message);
    return { should_follow_up: false, question: null };
  }
}

export type VideoMeta = {
  face_detected_ratio: number;
  eye_contact_score: number | null;
  presence_score: number | null;
  face_area_ratio_avg?: number;
  frames_sampled?: number;
  note?: string;
};

/**
 * Eye contact and on-camera presence for one answer clip. Never throws — a missing
 * visual signal leaves those metrics null rather than failing the whole answer.
 */
export async function aiAnalyzeVideo(videoBuffer: Buffer, mimeType: string): Promise<VideoMeta | null> {
  try {
    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("file", videoBuffer, { filename: "answer.webm", contentType: mimeType });
    const { data } = await axios.post<VideoMeta>(`${base()}/analyze-video`, form, {
      headers: form.getHeaders(),
      timeout: 300_000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    return data;
  } catch (e) {
    console.error("[ai] video analysis failed:", (e as Error).message);
    return null;
  }
}

/**
 * Renders question text to speech. Returns null when the service has no voice
 * available, so the caller can fall back to the browser's own synthesiser.
 */
export async function aiSpeak(text: string): Promise<Buffer | null> {
  try {
    const res = await axios.post(`${base()}/speak`, { text }, {
      responseType: "arraybuffer",
      timeout: 60_000,
      validateStatus: (s) => s === 200 || s === 204,
    });
    if (res.status === 204) return null;
    const buf = Buffer.from(res.data as ArrayBuffer);
    return buf.length > 0 ? buf : null;
  } catch (e) {
    console.error("[ai] speech synthesis failed:", (e as Error).message);
    return null;
  }
}
