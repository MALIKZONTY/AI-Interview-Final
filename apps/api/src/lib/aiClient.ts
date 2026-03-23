import axios from "axios";

const base = () => process.env.AI_SERVICE_URL ?? "http://localhost:8000";

export type GeneratedQuestion = {
  text: string;
  expected_answer: string;
};

export async function aiGenerateQuestions(params: {
  resumeSummary: string;
  jdText: string;
  count?: number;
}): Promise<GeneratedQuestion[]> {
  const { data } = await axios.post<{ questions: GeneratedQuestion[] }>(
    `${base()}/generate-questions`,
    {
      resume_summary: params.resumeSummary,
      jd_text: params.jdText,
      count: params.count ?? 20,
    },
    { timeout: 120_000 }
  );
  return data.questions;
}

export async function aiSpeechToText(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("file", audioBuffer, { filename: "clip.webm", contentType: mimeType });
  const { data } = await axios.post<{ text: string }>(`${base()}/speech-to-text`, form, {
    headers: form.getHeaders(),
    timeout: 300_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  return data.text ?? "";
}

export async function aiEvaluateAnswer(body: {
  question: string;
  expected_answer: string;
  candidate_answer: string;
  speech_meta?: Record<string, unknown>;
  video_meta?: Record<string, unknown>;
}): Promise<{
  correctness_score: number;
  confidence_score: number;
}> {
  const { data } = await axios.post<{
    correctness_score: number;
    confidence_score: number;
  }>(`${base()}/evaluate-answer`, body, { timeout: 60_000 });
  return data;
}

export async function aiAnalyzeVideo(videoBuffer: Buffer, mimeType: string): Promise<
  Record<string, unknown> & {
    face_detected_ratio: number;
    eye_contact_proxy: number;
    head_stability: number;
    gaze_center_score?: number;
    face_area_ratio_avg?: number;
    gaze_mediapipe_used?: boolean;
    face_position_variance?: number;
    head_motion_mean?: number;
  }
> {
  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("file", videoBuffer, { filename: "answer.webm", contentType: mimeType });
  const { data } = await axios.post(`${base()}/analyze-video`, form, {
    headers: form.getHeaders(),
    timeout: 120_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  return data as Record<string, unknown> & {
    face_detected_ratio: number;
    eye_contact_proxy: number;
    head_stability: number;
    gaze_center_score?: number;
    face_area_ratio_avg?: number;
    gaze_mediapipe_used?: boolean;
    face_position_variance?: number;
    head_motion_mean?: number;
  };
}
