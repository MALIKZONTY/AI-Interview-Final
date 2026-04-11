import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import jwtAuthPlugin from "./plugins/jwtAuth.js";
import authRoutes from "./routes/auth.js";
import uploadRoutes from "./routes/upload.js";
import interviewRoutes from "./routes/interview.js";

const port = Number(process.env.PORT ?? 4000);
const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

const app = Fastify({ logger: true });

// Support Ngrok and Local development origins dynamically
await app.register(cors, {
  origin: (origin, cb) => {
    // Allow local development and explicit frontend URL
    if (
      !origin || 
      origin.includes("localhost") || 
      origin.includes("127.0.0.1") || 
      origin === frontendUrl ||
      origin.includes("ngrok-free.app") ||
      origin.includes("ngrok.io")
    ) {
      cb(null, true);
      return;
    }
    cb(new Error("Not allowed by CORS"), false);
  },
  credentials: true,
});

/** Large bodies for resume PDF + answer recordings */
await app.register(multipart, {
  limits: { fileSize: 80 * 1024 * 1024 },
});

await app.register(websocket);

await app.register(jwtAuthPlugin);

await app.register(authRoutes, { prefix: "/auth" });
await app.register(uploadRoutes, { prefix: "/upload" });
await app.register(interviewRoutes, { prefix: "/interview" });

app.get("/health", async () => ({ ok: true }));

try {
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`API listening on http://localhost:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
