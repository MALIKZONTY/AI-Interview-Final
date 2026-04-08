import type { FastifyPluginAsync } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import axios from "axios";
import { prisma } from "../lib/prisma.js";
import { cloudinary } from "../lib/cloudinary.js";
import {
  aiGenerateQuestions,
  aiSpeechToText,
  aiAnalyzeVideo,
  aiEvaluateAnswer,
} from "../lib/aiClient.js";
import { Readable } from "node:stream";

const startSchema = z.object({
  jdText: z.string().min(10, "Job description is too short"),
  numQuestions: z.number().int().min(1).max(20),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).optional().default("Medium"),
});

/**
 * Interview lifecycle: start (generate 20 Qs), submit clips, process (AI), results & history.
 */
const interviewRoutes: FastifyPluginAsync = async (app) => {
  app.post("/start", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = startSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const { jdText, numQuestions, difficulty } = parsed.data;

    const resume = await prisma.resume.findUnique({ where: { userId: request.userId } });
    const resumeSummary = resume
      ? `Resume on file (${resume.fileName ?? "resume.pdf"}). URL: ${resume.url}`
      : "No resume uploaded; infer general professional background.";

    let generated;
    try {
      generated = await aiGenerateQuestions({
        resumeSummary,
        jdText,
        count: 20,
        difficulty,
      });
    } catch (e) {
      console.error("AI generate failed", e);
      return reply.status(502).send({ error: "AI service unavailable. Is the Python service running?" });
    }

    if (!generated?.length) {
      return reply.status(502).send({ error: "AI returned no questions" });
    }

    const interview = await prisma.interview.create({
      data: {
        userId: request.userId,
        jdText,
        numQuestions,
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
      },
      include: { questions: { orderBy: { orderIndex: "asc" } } },
    });

    const selected = interview.questions.slice(0, numQuestions);
    return reply.send({
      interviewId: interview.id,
      questions: selected.map((q) => ({
        id: q.id,
        orderIndex: q.orderIndex,
        text: q.text,
      })),
    });
  });

  app.post("/submit", { preHandler: [app.authenticate] }, async (request, reply) => {
    let interviewId = "";
    let questionId = "";
    let buffer: Buffer | null = null;

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "file" && part.fieldname === "video") {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        buffer = Buffer.concat(chunks);
      } else if (part.type === "field") {
        if (part.fieldname === "interviewId") {
          interviewId = String(part.value);
        } else if (part.fieldname === "questionId") {
          questionId = String(part.value);
        }
      }
    }

    if (!buffer?.length) {
      return reply.status(400).send({ error: "No video file (field name: video)" });
    }
    if (!interviewId || !questionId) {
      return reply.status(400).send({ error: "interviewId and questionId form fields required" });
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

    let cloudinaryUrl: string;
    try {
      const uploaded = await new Promise<{ secure_url: string }>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "interview/answers", resource_type: "video" },
          (err, result) => {
            if (err || !result) reject(err ?? new Error("Upload failed"));
            else resolve(result as { secure_url: string });
          }
        );
        Readable.from(buffer).pipe(stream);
      });
      cloudinaryUrl = uploaded.secure_url;
    } catch (e) {
      console.error(e);
      return reply.status(500).send({ error: "Video upload failed" });
    }

    await prisma.response.upsert({
      where: { questionId: q.id },
      create: { questionId: q.id, cloudinaryUrl },
      update: { cloudinaryUrl },
    });

    /**
     * When every question in this run has a video, start scoring immediately.
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
      const allAnswered = progress.questions.every((qu) => qu.responses[0]?.cloudinaryUrl);
      if (allAnswered && progress.questions.length === interview.numQuestions) {
        await prisma.interview.update({
          where: { id: interviewId },
          data: { status: "processing" },
        });
        void processInterview(interviewId).catch((err) => console.error("processInterview", err));
      }
    }

    return reply.send({ ok: true, cloudinaryUrl });
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
      result: interview.result,
      questions: visible.map((q) => {
        const r = q.responses[0];
        return {
          id: q.id,
          orderIndex: q.orderIndex,
          text: q.text,
          transcript: r?.transcript,
          recordingUrl: r?.cloudinaryUrl ?? null,
          correctnessScore: r?.correctnessScore,
          confidenceScore: r?.confidenceScore,
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
        status: true,
        result: {
          select: { avgCorrectness: true, avgConfidence: true },
        },
      },
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
      result: interview.result,
      questions: qs.map((q) => {
        const r = q.responses[0];
        return {
          id: q.id,
          orderIndex: q.orderIndex,
          text: q.text,
          transcript: r?.transcript,
          recordingUrl: r?.cloudinaryUrl ?? null,
          correctnessScore: r?.correctnessScore,
          confidenceScore: r?.confidenceScore,
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
      const resp = q.responses[0];
      if (!resp?.cloudinaryUrl) continue;

      let videoBuf: Buffer;
      try {
        const res = await axios.get<ArrayBuffer>(resp.cloudinaryUrl, {
          responseType: "arraybuffer",
          timeout: 120_000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });
        videoBuf = Buffer.from(res.data);
      } catch (e) {
        console.error("Failed to fetch video", e);
        continue;
      }

      const mime = "video/webm";
      let transcript = "";
      let videoMeta: Record<string, unknown> = {};
      try {
        transcript = await aiSpeechToText(videoBuf, mime);
      } catch (e) {
        console.error("speech-to-text", e);
      }
      try {
        const v = await aiAnalyzeVideo(videoBuf, mime);
        videoMeta = v as unknown as Record<string, unknown>;
      } catch (e) {
        console.error("analyze-video", e);
      }

      let correctness = 0;
      let confidence = 0;
      try {
        const ev = await aiEvaluateAnswer({
          question: q.text,
          expected_answer: q.expectedAnswer,
          acceptable_variants: (q.acceptableVariants as string[]) || [],
          keywords: (q.keywords as string[]) || [],
          evaluation_rubric: (q.evaluationRubric as Record<string, unknown>) || {},
          candidate_answer: transcript,
          video_meta: videoMeta,
        });
        correctness = ev.correctness_score;
        confidence = ev.confidence_score;
      } catch (e) {
        console.error("evaluate", e);
      }

      await prisma.response.updateMany({
        where: { questionId: q.id },
        data: {
          transcript,
          correctnessScore: correctness,
          confidenceScore: confidence,
          analysisMeta: videoMeta as Prisma.InputJsonValue,
        },
      });
      scores.push({ c: correctness, f: confidence });
    }

    const avgC =
      scores.length > 0 ? scores.reduce((a, s) => a + s.c, 0) / scores.length : 0;
    const avgF =
      scores.length > 0 ? scores.reduce((a, s) => a + s.f, 0) / scores.length : 0;
    const overall = (avgC * 0.7) + (avgF * 0.3);

    await prisma.result.upsert({
      where: { interviewId },
      create: {
        interviewId,
        avgCorrectness: avgC,
        avgConfidence: avgF,
        details: { perQuestion: scores },
      },
      update: {
        avgCorrectness: avgC,
        avgConfidence: avgF,
        details: { perQuestion: scores },
      },
    });

    await prisma.interview.update({
      where: { id: interviewId },
      data: {
        status: "completed",
        overallScore: overall,
      },
    });
  } catch (err) {
    console.error("processInterview fatal", err);
    await prisma.interview
      .updateMany({
        where: { id: interviewId, status: { not: "completed" } },
        data: { status: "failed" },
      })
      .catch(() => {});
  }
}

export default interviewRoutes;
