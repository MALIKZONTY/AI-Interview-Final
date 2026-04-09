import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { storageUpload } from "../lib/supabase.js";
import { prisma } from "../lib/prisma.js";
import { Readable } from "node:stream";
import pdf from "pdf-parse/lib/pdf-parse.js";

const jdSchema = z.object({
  text: z.string().min(10),
});

/**
 * Authenticated uploads: resume (PDF), JD validation (no DB persistence).
 * One resume per user — new upload replaces the previous record.
 */
const uploadRoutes: FastifyPluginAsync = async (app) => {
  /** Returns the latest resume for the logged-in user (dashboard hydration). */
  app.get("/resume", { preHandler: [app.authenticate] }, async (request, reply) => {
    const resume = await prisma.resume.findUnique({ where: { userId: request.userId } });
    return reply.send({ resume });
  });

  /** Validates JD length; frontend keeps text in state until interview starts. */
  app.post("/jd", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = jdSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid job description", details: parsed.error.flatten() });
    }
    return reply.send({ ok: true, length: parsed.data.text.length });
  });

  app.post("/resume", { preHandler: [app.authenticate] }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ error: "No file uploaded" });
    }
    const mime = file.mimetype ?? "";
    if (!mime.includes("pdf")) {
      return reply.status(400).send({ error: "Only PDF resumes are supported" });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    try {
      // 1. Extract text from PDF buffer
      let contentText: string | null = null;
      try {
        const data = await pdf(buffer);
        contentText = data.text;
      } catch (err) {
        console.error("PDF parsing failed", err);
      }

      let uploaded;
      try {
        const path = `resumes/${request.userId}_${Date.now()}.pdf`;
        uploaded = await storageUpload("interview", path, buffer, "application/pdf");
      } catch (e) {
        console.error("[upload] Supabase upload failed:", e);
        throw e;
      }

      const resume = await (prisma.resume as any).upsert({
        where: { userId: request.userId },
        create: {
          userId: request.userId,
          storagePath: uploaded.path,
          url: uploaded.url,
          fileName: file.filename ?? "resume.pdf",
          contentText,
        } as any,
        update: {
          storagePath: uploaded.path,
          url: uploaded.url,
          fileName: file.filename ?? "resume.pdf",
          contentText,
        } as any,
      });

      return reply.send({ resume });
    } catch (e) {
      console.error(e);
      return reply.status(500).send({ error: "Supabase upload failed. Check SUPABASE_* env." });
    }
  });
};

export default uploadRoutes;
