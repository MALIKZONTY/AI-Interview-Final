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
