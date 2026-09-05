import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { storagePut, storageFetch } from "../lib/storage.js";
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

  /**
   * Streams the stored resume back to its owner. The stored locator is a private
   * `supabase://` or `local://` path, so it is never linkable directly.
   */
  app.get("/resume/file", { preHandler: [app.authenticate] }, async (request, reply) => {
    const resume = await prisma.resume.findUnique({ where: { userId: request.userId } });
    if (!resume?.url) {
      return reply.status(404).send({ error: "No resume stored" });
    }
    try {
      const buffer = await storageFetch(resume.url);
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Length", String(buffer.length))
        .header("Content-Disposition", `inline; filename="${(resume.fileName || "resume.pdf").replace(/"/g, "")}"`)
        .send(buffer);
    } catch (e) {
      request.log.error({ err: e }, "[upload] could not read stored resume");
      return reply.status(410).send({ error: "Resume is no longer available" });
    }
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
        uploaded = await storagePut("interview", path, buffer, "application/pdf");
      } catch (e) {
        console.error("[upload] Failed to persist resume:", e);
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
      return reply.status(500).send({ error: "Could not save the resume. Please try again." });
    }
  });
};

export default uploadRoutes;
