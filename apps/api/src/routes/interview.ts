import type { FastifyPluginAsync } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import axios from "axios";
import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/prisma.js";
import { supabase, storageUpload, createSignedUploadUrl, listPath, downloadFile, storageDelete } from "../lib/supabase.js";
import {
  aiGenerateQuestions,
  aiSpeechToText,
  aiAnalyzeVideo,
  aiEvaluateAnswer,
  aiGenerateSummaryFeedback,
} from "../lib/aiClient.js";

const startSchema = z.object({
  jdText: z.string().min(10, "Job description is too short"),
  numQuestions: z.number().int().min(1).max(20),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).optional().default("Medium"),
});

/**
 * Interview lifecycle: start (generate 20 Qs), submit clips, process (AI), results & history.
 */
const interviewRoutes: FastifyPluginAsync = async (app) => {
  /**
   * LIVE STREAMING WEBSOCKET (Option A)
   * Streams video bits directly to backend disk, then pushes to cloud on close.
   */
  app.get("/stream", { websocket: true }, (connection: any, request: any) => {
    const { interviewId, questionId } = request.query as { interviewId: string; questionId: string };
    
    // Robust check for connection.socket
    const socket = connection.socket || connection;
    
    if (!interviewId || !questionId) {
      if (socket.send) socket.send(JSON.stringify({ error: "Missing interviewId/questionId" }));
      socket.close?.();
      return;
    }

    const tempDir = join(process.cwd(), "temp", "streams");
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

    const localPath = join(tempDir, `${interviewId}_${questionId}.webm`);
    const fileStream = createWriteStream(localPath);

    socket.on("message", (message: any, isBinary: any) => {
      if (isBinary) {
        fileStream.write(message);
      }
    });

    socket.on("close", () => {
      fileStream.end();
      console.log(`[stream] Client closed connection for ${questionId}`);
    });
  });

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

    const interview = await prisma.interview.create({
      data: {
        userId: request.userId,
        jdText,
        numQuestions,
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

  app.post("/upload-chunk-url", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { interviewId, questionId, chunkIndex } = request.body as {
      interviewId: string;
      questionId: string;
      chunkIndex: number
    };
    if (!interviewId || !questionId || chunkIndex === undefined) {
      return reply.status(400).send({ error: "interviewId, questionId and chunkIndex are required" });
    }

    // Temporary folder for chunks
    const path = `temp/${interviewId}/${questionId}/chunk_${chunkIndex.toString().padStart(4, "0")}.webm`;
    try {
      const { signedUrl, path: storagePath } = await createSignedUploadUrl("interview", path);
      return reply.send({ signedUrl, storagePath });
    } catch (e) {
      console.error("[interview] Failed to create chunk upload URL:", e);
      return reply.status(500).send({ error: "Failed to generate chunk upload URL" });
    }
  });

  app.post("/finalize-chunks", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { interviewId, questionId } = request.body as { interviewId: string; questionId: string };
    if (!interviewId || !questionId) {
      return reply.status(400).send({ error: "interviewId and questionId are required" });
    }

    try {
      const tempFolder = `temp/${interviewId}/${questionId}`;
      const chunks = await listPath("interview", tempFolder);
      if (!chunks?.length) {
        return reply.status(400).send({ error: "No fragments found to merge" });
      }

      // Sort chunks by name (padding ensures 0001 < 0010)
      chunks.sort((a, b) => a.name.localeCompare(b.name));

      const buffers: Buffer[] = [];
      for (const chunk of chunks) {
        const buf = await downloadFile("interview", `${tempFolder}/${chunk.name}`);
        buffers.push(buf);
      }

      const finalBuffer = Buffer.concat(buffers);
      const finalPath = `answers/${interviewId}/${questionId}_merged_${Date.now()}.webm`;

      const { url: storageUrl } = await storageUpload("interview", finalPath, finalBuffer, "video/webm");

      // Cleanup chunks
      for (const chunk of chunks) {
        await storageDelete("interview", `${tempFolder}/${chunk.name}`).catch(() => { });
      }

      return reply.send({ ok: true, storageUrl });
    } catch (e) {
      console.error("[interview] Finalization failed:", e);
      return reply.status(500).send({ error: "Failed to merge video fragments" });
    }
  });

  app.post("/submit", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { interviewId, questionId } = request.body as { 
      interviewId: string; 
      questionId: string; 
    };

    if (!interviewId || !questionId) {
      return reply.status(400).send({ error: "interviewId and questionId required" });
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

    // Handshake: Finalize the live stream file
    let storageUrl = "";
    const tempDir = join(process.cwd(), "temp", "streams");
    const localPath = join(tempDir, `${interviewId}_${questionId}.webm`);

    try {
      if (existsSync(localPath)) {
        const buffer = readFileSync(localPath);
        if (buffer.length > 100) {
          const storagePath = `answers/${interviewId}/${questionId}_final_${Date.now()}.webm`;
          const uploaded = await storageUpload("interview", storagePath, buffer, "video/webm");
          storageUrl = uploaded.url;
          console.log(`[submit] Finalized stream for ${questionId}: ${storageUrl}`);
        }
        unlinkSync(localPath);
      }
    } catch (e) {
      console.error("[submit] Failed to finalize stream file:", e);
    }

    if (!storageUrl) {
      return reply.status(400).send({ error: "No video data found for this question. Streaming might have failed." });
    }

    const savedResponse = await (prisma.response as any).upsert({
      where: { questionId: q.id },
      create: { questionId: q.id, storageUrl } as any,
      update: { storageUrl } as any,
    });

    console.log(`[submit] Saved to DB: Response for ${q.id} with storageUrl: ${savedResponse.storageUrl}`);

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
      const allAnswered = progress.questions.every((qu) => (qu.responses as any)?.storageUrl);
      if (allAnswered && progress.questions.length === interview.numQuestions) {
        await prisma.interview.update({
          where: { id: interviewId },
          data: { status: "processing" },
        });
        void processInterview(interviewId).catch((err) => console.error("processInterview", err));
      }
    }

    return reply.send({ ok: true, storageUrl });
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
          recordingUrl: (r as any)?.storageUrl ?? null,
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
          recordingUrl: (r as any)?.storageUrl ?? null,
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

      let videoBuf: Buffer;
      try {
        const res = await axios.get<ArrayBuffer>((resp as any).storageUrl, {
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
      let transcript = resp.transcript || "";
      let videoMeta: Record<string, unknown> = {};

      // Only perform Speech-to-Text if transcript is missing
      if (!transcript) {
        try {
          transcript = await aiSpeechToText(videoBuf, mime);
        } catch (e) {
          console.error("speech-to-text", e);
        }
      } else {
        console.log(`Reusing existing transcript for question ${q.id}`);
      }
      try {
        const v = await aiAnalyzeVideo(videoBuf, mime);
        videoMeta = v as unknown as Record<string, unknown>;
      } catch (e) {
        console.error("analyze-video", e);
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
          video_meta: videoMeta,
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
          analysisMeta: videoMeta as any,
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
