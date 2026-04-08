import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { cloudinary } from "../lib/cloudinary.js";
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

      const uploaded = await new Promise<{
        secure_url: string;
        public_id: string;
      }>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "interview/resumes",
            resource_type: "raw",
            format: "pdf",
          },
          (err, result) => {
            if (err || !result) reject(err ?? new Error("Upload failed"));
            else resolve(result as { secure_url: string; public_id: string });
          }
        );
        Readable.from(buffer).pipe(stream);
      });

      const resume = await (prisma.resume as any).upsert({
        where: { userId: request.userId },
        create: {
          userId: request.userId,
          cloudinaryPublicId: uploaded.public_id,
          url: uploaded.secure_url,
          fileName: file.filename ?? "resume.pdf",
          contentText,
        },
        update: {
          cloudinaryPublicId: uploaded.public_id,
          url: uploaded.secure_url,
          fileName: file.filename ?? "resume.pdf",
          contentText,
        },
      });

      return reply.send({ resume });
    } catch (e) {
      console.error(e);
      return reply.status(500).send({ error: "Cloudinary upload failed. Check CLOUDINARY_* env." });
    }
  });
};

export default uploadRoutes;
