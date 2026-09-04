import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import jwtAuthPlugin from "./plugins/jwtAuth.js";
import authRoutes from "./routes/auth.js";
import uploadRoutes from "./routes/upload.js";
import interviewRoutes from "./routes/interview.js";

const port = Number(process.env.PORT ?? 4000);
const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

const app = Fastify({ logger: true });

// Support Ngrok, Vercel, and Local development origins dynamically
await app.register(cors, {
  origin: (origin, cb) => {
    // Allow local development, Ngrok, and Vercel subdomains
    if (
      !origin || 
      origin.includes("localhost") || 
      origin.includes("127.0.0.1") || 
      origin === frontendUrl ||
      origin.endsWith(".vercel.app") || // Allow all Vercel deployments
      origin.includes("ngrok-free.app") ||
      origin.includes("ngrok.io")
    ) {
      cb(null, true);
      return;
    }
    app.log.warn(`Origin ${origin} blocked by CORS`);
    cb(new Error("Not allowed by CORS"), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

/** Large bodies for resume PDF + answer audio */
await app.register(multipart, {
  limits: { fileSize: 80 * 1024 * 1024 },
});

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
