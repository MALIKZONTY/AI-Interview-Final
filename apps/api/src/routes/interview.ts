import type { FastifyPluginAsync } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import axios from "axios";
import { prisma } from "../lib/prisma.js";
import { storagePut, storageFetch } from "../lib/storage.js";
import {
  aiGenerateQuestions,
  aiSpeechToText,
  aiGenerateFollowUp,
  aiEvaluateAnswer,
  aiGenerateSummaryFeedback,
} from "../lib/aiClient.js";

const startSchema = z.object({
  jdText: z.string().min(10, "Job description is too short"),
  numQuestions: z.number().int().min(1).max(20),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).optional().default("Medium"),
});

/**
 * Interview lifecycle: start (generate 20 Qs), submit answer audio, process (AI), results & history.
 */
const interviewRoutes: FastifyPluginAsync = async (app) => {
  app.post("/start", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = startSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const { jdText, numQuestions, difficulty } = parsed.data;

    const resume = await prisma.resume.findUnique({ where: { userId: request.userId } });
    const resumeSummary = (resume as any)?.contentText || "";

    let generated;
    try {
      generated = await aiGenerateQuestions({
        resumeSummary: resumeSummary || "No resume text found; generate based on JD only.",
        jdText,
        count: numQuestions,
        difficulty,
      });

    } catch (e) {
      console.error("AI generate failed", e);
      return reply.status(502).send({ error: "AI service unavailable. Is the Python service running?" });
    }

    if (!generated?.length) {
      return reply.status(502).send({ error: "AI returned no questions" });
    }

    /**
     * The model does not always return the count it was asked for. Record what we
     * actually got, otherwise the "every question answered" check below can never
     * be satisfied and scoring never starts on its own.
     */
    const actualCount = Math.min(numQuestions, generated.length);
    if (actualCount < numQuestions) {
      console.warn(`[start] Asked for ${numQuestions} questions, generated ${generated.length}.`);
    }

    const interview = await prisma.interview.create({
      data: {
        userId: request.userId,
        jdText,
        numQuestions: actualCount,
        difficulty,
        status: "active",
        questions: {
          create: generated.map((q, i) => ({
            orderIndex: i,
            text: q.text,
            expectedAnswer: q.expected_answer,
            acceptableVariants: q.acceptable_variants || [],
            keywords: q.keywords || [],
            evaluationRubric: q.evaluation_rubric ? (q.evaluation_rubric as Prisma.InputJsonValue) : {},
          })),
        },
      } as any,
      include: { questions: { orderBy: { orderIndex: "asc" } } },
    });

    const selected = interview.questions.slice(0, actualCount);
    return reply.send({
      interviewId: interview.id,
      questions: selected.map((q) => ({
        id: q.id,
        orderIndex: q.orderIndex,
        text: q.text,
      })),
    });
  });

  /**
   * Answer upload — one audio clip per question, multipart with the file in `audio`.
   * Transcription and scoring run later in processInterview; this just persists the clip.
   */
  app.post("/submit", { preHandler: [app.authenticate] }, async (request, reply) => {
    let interviewId = "";
    let questionId = "";
    let audio: Buffer | null = null;
    let mimeType = "audio/webm";

    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          if (part.fieldname === "audio") {
            audio = Buffer.concat(chunks);
            if (part.mimetype) mimeType = part.mimetype;
          }
        } else if (part.fieldname === "interviewId") {
          interviewId = String(part.value ?? "");
        } else if (part.fieldname === "questionId") {
          questionId = String(part.value ?? "");
        }
      }
    } catch (e) {
      request.log.error({ err: e }, "[submit] failed to read multipart body");
      return reply.status(400).send({ error: "Malformed upload" });
    }

    if (!interviewId || !questionId) {
      return reply.status(400).send({ error: "interviewId and questionId required" });
    }
    if (!audio || audio.length < 2000) {
      return reply
        .status(400)
        .send({ error: "No audio captured for this question. Check your microphone and try again." });
    }

    const interview = await prisma.interview.findFirst({
      where: { id: interviewId, userId: request.userId },
      include: { questions: true },
    });
    if (!interview) {
      return reply.status(404).send({ error: "Interview not found" });
    }
    const q = interview.questions.find((x) => x.id === questionId);
    if (!q || q.orderIndex >= interview.numQuestions) {
      return reply.status(400).send({ error: "Invalid question for this interview" });
    }

    const ext = mimeType.includes("mp4") ? "m4a" : "webm";
    const objectPath = `answers/${interviewId}/${questionId}_${Date.now()}.${ext}`;

    let storageUrl: string;
    try {
      const stored = await storagePut("interview", objectPath, audio, mimeType);
      storageUrl = stored.url;
    } catch (e) {
      request.log.error({ err: e }, "[submit] failed to persist answer audio");
      return reply.status(500).send({ error: "Could not save your answer. Please try again." });
    }

    console.log(`[submit] Stored ${audio.length} bytes of audio for ${questionId} at ${storageUrl}`);

    /**
     * Transcribe now rather than at scoring time: the follow-up question is written
     * from what the candidate just said. processInterview reuses this transcript and
     * these metrics, so nothing is transcribed twice.
     */
    let transcript = "";
    let voiceMeta: Record<string, unknown> = {};
    try {
      const stt = await aiSpeechToText(audio, mimeType);
      transcript = stt.text;
      voiceMeta = stt.voice_meta;
    } catch (e) {
      request.log.error({ err: e }, "[submit] transcription failed; processInterview will retry");
    }

    const answerMeta = { mime_type: mimeType, voice_meta: voiceMeta };
    await (prisma.response as any).upsert({
      where: { questionId: q.id },
      create: {
        questionId: q.id,
        storageUrl,
        transcript: transcript || null,
        analysisMeta: answerMeta,
      } as any,
      update: {
        storageUrl,
        transcript: transcript || null,
        analysisMeta: answerMeta,
        correctnessScore: null,
        confidenceScore: null,
        aiFeedback: null,
      } as any,
    });

    /**
     * Adaptive follow-up: when the answer opens a thread worth pulling, the next
     * planned question is rewritten in place to probe it. Rewriting rather than
     * inserting keeps numQuestions, ordering and the results maths untouched.
     */
    const nextIndex = q.orderIndex + 1;
    let nextQuestion: { id: string; orderIndex: number; text: string; isFollowUp: boolean } | null =
      null;

    if (nextIndex < interview.numQuestions) {
      const planned = interview.questions.find((x) => x.orderIndex === nextIndex);
      if (planned) {
        let text = planned.text;
        let isFollowUp = false;

        if (transcript.trim()) {
          const decision = await aiGenerateFollowUp({
            jdText: interview.jdText ?? "",
            question: q.text,
            candidateAnswer: transcript,
            plannedNext: planned.text,
            difficulty: interview.difficulty ?? "Medium",
          });

          if (decision.should_follow_up && decision.question) {
            const fu = decision.question;
            await prisma.question.update({
              where: { id: planned.id },
              data: {
                text: fu.text,
                expectedAnswer: fu.expected_answer,
                acceptableVariants: (fu.acceptable_variants || []) as Prisma.InputJsonValue,
                keywords: (fu.keywords || []) as Prisma.InputJsonValue,
                evaluationRubric: (fu.evaluation_rubric || {}) as Prisma.InputJsonValue,
              },
            });
            text = fu.text;
            isFollowUp = true;
            console.log(`[submit] Follow-up queued at #${nextIndex}: ${decision.reason ?? ""}`);
          }
        }

        nextQuestion = { id: planned.id, orderIndex: nextIndex, text, isFollowUp };
      }
    }

    /**
     * When every question in this run has an answer, start scoring immediately.
     * Avoids relying on a second POST /process call (which can fail silently from the client).
     */
    const progress = await prisma.interview.findFirst({
      where: { id: interviewId, userId: request.userId },
      include: {
        questions: {
          where: { orderIndex: { lt: interview.numQuestions } },
          include: { responses: true },
        },
      },
    });
    if (progress?.status === "active") {
      const allAnswered = progress.questions.every((qu) => (qu.responses as any)?.storageUrl);
      if (allAnswered && progress.questions.length === interview.numQuestions) {
        await prisma.interview.update({
          where: { id: interviewId },
          data: { status: "processing" },
        });
        void processInterview(interviewId).catch((err) => console.error("processInterview", err));
      }
    }

    return reply.send({ ok: true, nextQuestion, done: nextQuestion === null });
  });

  app.post("/:id/process", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const inv = await prisma.interview.findFirst({
      where: { id, userId: request.userId },
    });

    if (!inv) {
      return reply.status(404).send({ error: "Not found" });
    }
    if (inv.status === "completed") {
      return reply.send({ ok: true, message: "Already completed" });
    }
    if (inv.status === "processing") {
      return reply.send({ ok: true, message: "Already processing" });
    }

    await prisma.interview.update({
      where: { id },
      data: { status: "processing" },
    });

    void processInterview(id).catch((err) => console.error("processInterview", err));

    return reply.send({ ok: true, message: "Processing started" });
  });

  /**
   * Streams a stored answer recording back to its owner. The stored locator may be a
   * `local://` path, which the browser cannot fetch, so the file is always served
   * through here rather than linked directly.
   */
  app.get("/answer-audio/:questionId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { questionId } = request.params as { questionId: string };

    const question = await prisma.question.findFirst({
      where: { id: questionId, interview: { userId: request.userId } },
      include: { responses: true },
    });

    const storageUrl = (question?.responses as any)?.storageUrl as string | undefined;
    if (!question || !storageUrl) {
      return reply.status(404).send({ error: "No recording stored for this answer" });
    }

    let buffer: Buffer;
    try {
      buffer = await storageFetch(storageUrl);
    } catch (e) {
      request.log.error({ err: e }, `[answer-audio] could not read ${storageUrl}`);
      return reply.status(410).send({ error: "Recording is no longer available" });
    }

    const meta = ((question.responses as any)?.analysisMeta as Record<string, any>) || {};
    return reply
      .header("Content-Type", meta.mime_type || "audio/webm")
      .header("Content-Length", String(buffer.length))
      .header("Cache-Control", "private, max-age=3600")
      .send(buffer);
  });

  app.get("/results/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const interview = await prisma.interview.findFirst({
      where: { id, userId: request.userId },
      include: {
        result: true,
        questions: {
          orderBy: { orderIndex: "asc" },
          include: { responses: true },
        },
      },
    });
    if (!interview) {
      return reply.status(404).send({ error: "Not found" });
    }
    const visible = interview.questions.filter((q) => q.orderIndex < interview.numQuestions);
    return reply.send({
      interview: {
        id: interview.id,
        status: interview.status,
        overallScore: interview.overallScore,
        createdAt: interview.createdAt,
      },
      result: interview.result ? {
        ...interview.result,
        summaryFeedback: (interview as any).aiFeedback
      } : null,
      questions: visible.map((q) => {
        const r = q.responses as any;
        return {
          id: q.id,
          orderIndex: q.orderIndex,
          text: q.text,
          transcript: r?.transcript,
          hasRecording: Boolean((r as any)?.storageUrl),
          correctnessScore: r?.correctnessScore,
          confidenceScore: r?.confidenceScore,
          aiFeedback: (r as any)?.aiFeedback,
        };
      }),
    });
  });

  app.get("/history", { preHandler: [app.authenticate] }, async (request, reply) => {
    const list = await prisma.interview.findMany({
      where: {
        userId: request.userId,
        status: { in: ["completed", "failed"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        overallScore: true,
        numQuestions: true,
        difficulty: true,
        status: true,
        jdText: true,
        result: {
          select: { avgCorrectness: true, avgConfidence: true },
        },
      } as any,
    });
    return reply.send({ interviews: list });
  });

  app.get("/history/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const interview = await prisma.interview.findFirst({
      where: { id, userId: request.userId },
      include: {
        result: true,
        questions: {
          orderBy: { orderIndex: "asc" },
          include: { responses: true },
        },
      },
    });
    if (!interview) {
      return reply.status(404).send({ error: "Not found" });
    }
    const n = interview.numQuestions;
    const qs = interview.questions.filter((q) => q.orderIndex < n);
    return reply.send({
      interview: {
        id: interview.id,
        createdAt: interview.createdAt,
        overallScore: interview.overallScore,
        status: interview.status,
      },
      result: interview.result ? {
        ...interview.result,
        summaryFeedback: (interview as any).aiFeedback
      } : null,
      questions: qs.map((q) => {
        const r = q.responses as any;
        return {
          id: q.id,
          orderIndex: q.orderIndex,
          text: q.text,
          transcript: r?.transcript,
          hasRecording: Boolean((r as any)?.storageUrl),
          correctnessScore: r?.correctnessScore,
          confidenceScore: r?.confidenceScore,
          aiFeedback: (r as any)?.aiFeedback,
        };
      }),
    });
  });
};

async function processInterview(interviewId: string): Promise<void> {
  try {
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        questions: {
          orderBy: { orderIndex: "asc" },
          include: { responses: true },
        },
      },
    });
    if (!interview) return;
    if (interview.status === "completed") return;

    const questions = interview.questions.filter((q) => q.orderIndex < interview.numQuestions);
    const scores: { c: number; f: number }[] = [];

    for (const q of questions) {
      const resp = q.responses as any;
      if (!(resp as any)?.storageUrl) continue;

      let audioBuf: Buffer;
      try {
        audioBuf = await storageFetch((resp as any).storageUrl);
      } catch (e) {
        console.error(`Failed to read answer audio for ${q.id}`, e);
        continue;
      }

      const storedMeta = ((resp as any).analysisMeta as Record<string, any>) || {};
      const mime = storedMeta.mime_type || "audio/webm";
      let transcript = resp.transcript || "";
      let voiceMeta: Record<string, unknown> = storedMeta.voice_meta || {};

      // One pass gives us both the transcript and the delivery metrics.
      if (!transcript || Object.keys(voiceMeta).length === 0) {
        try {
          const stt = await aiSpeechToText(audioBuf, mime);
          transcript = transcript || stt.text;
          voiceMeta = stt.voice_meta;
        } catch (e) {
          console.error("speech-to-text", e);
        }
      } else {
        console.log(`Reusing existing transcript for question ${q.id}`);
      }

      let correctness = 0;
      let confidence = 0;
      let evalData: any = {};
      try {
        const ev = await aiEvaluateAnswer({
          question: q.text,
          expected_answer: q.expectedAnswer,
          acceptable_variants: (q.acceptableVariants as string[]) || [],
          keywords: (q.keywords as string[]) || [],
          evaluation_rubric: (q.evaluationRubric as Record<string, unknown>) || {},
          candidate_answer: transcript,
          voice_meta: voiceMeta,
        });
        correctness = ev.correctness_score;
        confidence = ev.confidence_score;
        evalData = ev.debug || {};
      } catch (e) {
        console.error("evaluate", e);
      }

      await (prisma.response as any).update({
        where: { questionId: q.id },
        data: {
          transcript,
          correctnessScore: correctness,
          confidenceScore: confidence,
          aiFeedback: evalData.feedback || null,
          analysisMeta: { mime_type: mime, voice_meta: voiceMeta } as any,
        } as any,
      });
      scores.push({ c: correctness, f: confidence });
    }

    const avgC =
      scores.length > 0 ? scores.reduce((a, s) => a + s.c, 0) / scores.length : 0;
    const avgF =
      scores.length > 0 ? scores.reduce((a, s) => a + s.f, 0) / scores.length : 0;
    const overall = avgC * 0.7 + avgF * 0.3;

    // Generate Holistic Summary Feedback
    let summaryFeedback = null;
    try {
      const qs = await prisma.question.findMany({
        where: { interviewId },
        include: { responses: true },
        orderBy: { orderIndex: "asc" },
      });
      const history = qs.map((q) => ({
        question: q.text,
        answer: (q.responses as any)?.transcript || "No answer provided.",
      }));
      summaryFeedback = await aiGenerateSummaryFeedback({
        avg_correctness: avgC,
        avg_confidence: avgF,
        interview_history: history,
      });
    } catch (e) {
      console.error("Summary feedback generation failed", e);
    }

    await (prisma.result as any).upsert({
      where: { interviewId },
      create: {
        interviewId,
        avgCorrectness: avgC,
        avgConfidence: avgF,
        details: { perQuestion: scores },
      } as any,
      update: {
        avgCorrectness: avgC,
        avgConfidence: avgF,
        details: { perQuestion: scores },
      } as any,
    });

    await (prisma.interview as any).update({
      where: { id: interviewId },
      data: {
        status: "completed",
        overallScore: overall,
        aiFeedback: summaryFeedback,
      } as any,
    });
  } catch (err) {
    console.error("processInterview fatal", err);
    await prisma.interview
      .updateMany({
        where: { id: interviewId, status: { not: "completed" } },
        data: { status: "failed" },
      })
      .catch(() => { });
  }
}

export default interviewRoutes;
