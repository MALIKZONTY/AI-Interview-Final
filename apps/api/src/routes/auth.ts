import type { FastifyPluginAsync } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

/**
 * Usernames rather than email addresses: nothing here sends mail, so an address
 * was a field to mistype rather than a way to reach anyone. Accounts created
 * before this keep working — their address became their username.
 */
const USERNAME = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(32, "Username must be 32 characters or fewer");

const registerSchema = z.object({
  username: USERNAME,
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
});

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

/**
 * Public auth routes: register and login.
 * Passwords are hashed with bcrypt; JWT is issued on success.
 */
const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const { username, password, confirmPassword } = parsed.data;
    if (password !== confirmPassword) {
      return reply.status(400).send({ error: "Passwords do not match" });
    }
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return reply.status(409).send({ error: "That username is taken" });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      // `password` keeps the plaintext beside the hash at the project owner's
      // request. Login still verifies against the hash; nothing reads this column.
      // The select below deliberately omits it so it never leaves the server.
      // `name` is no longer collected — sign-up asks for a username and nothing
      // else. The column is NOT NULL and older accounts have real names in it, so
      // rather than change the schema, new accounts mirror their username here.
      data: { name: username, username, passwordHash, password },
      select: { id: true, name: true, username: true },
    });
    const token = app.jwt.sign({ sub: user.id });
    return reply.send({ user, token });
  });

  app.post("/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid credentials" });
    }
    const { username, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return reply.status(401).send({ error: "Incorrect username or password" });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return reply.status(401).send({ error: "Incorrect username or password" });
    }
    const token = app.jwt.sign({ sub: user.id });
    return reply.send({
      user: { id: user.id, name: user.name, username: user.username },
      token,
    });
  });
};

export default authRoutes;
