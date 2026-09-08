import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import cors from "@fastify/cors"
import fastifyStatic from "@fastify/static"
import fastifyWebsocket from "@fastify/websocket"
import {
  AdminConfigUpdateSchema,
  AdminDrawRequestSchema,
  AdminTimerActionSchema,
  ManualDonationSchema,
} from "@tombola/contracts"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"
import type { z } from "zod"
import { config } from "./config.js"
import { ARCHIVE_FILENAME_PATTERN, storage } from "./modules/storage.js"
import { tombolaEngine } from "./modules/tombola-engine.js"
import { wsManager } from "./modules/ws.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function safeCompare(a: string | undefined, b: string): boolean {
  if (!a) return false
  const hashA = crypto.createHash("sha256").update(a).digest()
  const hashB = crypto.createHash("sha256").update(b).digest()
  return crypto.timingSafeEqual(hashA, hashB)
}

/** Uniform error payload: `error` is the first human-readable Zod message. */
function sendZodError(reply: FastifyReply, status: number, error: z.ZodError, fallback: string) {
  return reply.status(status).send({
    error: error.errors[0]?.message || fallback,
    details: error.format(),
  })
}

export interface BuildAppOptions {
  logger?: boolean
  /** Reports the Streamlabs Charity listener status to /api/health. */
  isStreamlabsConnected?: () => boolean
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({
    logger: opts.logger ?? (config.NODE_ENV === "production" ? { level: "info" } : false),
  })

  await server.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })

  await server.register(fastifyWebsocket)

  // 1. Healthcheck for CapRover & Monitoring
  server.get("/api/health", async () => {
    return {
      status: "ok",
      uptime: process.uptime(),
      clientsCount: wsManager.clientCount,
      streamlabsConnected: opts.isStreamlabsConnected?.() ?? false,
      timestamp: new Date().toISOString(),
    }
  })

  // 2. Public state endpoint
  server.get("/api/state", async () => {
    return tombolaEngine.getState()
  })

  // Helper for Admin Auth (strictly via headers to prevent secret leakage in logs)
  function checkAdminAuth(request: FastifyRequest, reply: FastifyReply): boolean {
    const key =
      (request.headers["x-admin-key"] as string | undefined) ||
      (request.headers.authorization
        ? request.headers.authorization.replace(/^Bearer\s+/i, "")
        : undefined)

    if (!safeCompare(key, config.ADMIN_SECRET_KEY)) {
      reply.status(401).send({ error: "Unauthorized: Invalid admin secret key" })
      return false
    }
    return true
  }

  // 3. Admin routes
  server.post("/api/admin/timer", async (request, reply) => {
    if (!checkAdminAuth(request, reply)) return

    const result = AdminTimerActionSchema.safeParse(request.body)
    if (!result.success) {
      return sendZodError(reply, 400, result.error, "Action de minuteur invalide")
    }

    const { action, seconds } = result.data
    switch (action) {
      case "start":
        await tombolaEngine.startTimer()
        break
      case "pause":
        await tombolaEngine.pauseTimer()
        break
      case "reset":
        await tombolaEngine.resetTimer()
        break
      case "add_time":
        await tombolaEngine.addTimerSeconds(seconds ?? 60)
        break
    }

    return { success: true, state: tombolaEngine.getState() }
  })

  server.post("/api/admin/config", async (request, reply) => {
    if (!checkAdminAuth(request, reply)) return

    const result = AdminConfigUpdateSchema.safeParse(request.body)
    if (!result.success) {
      return sendZodError(reply, 400, result.error, "Configuration invalide")
    }

    try {
      const updated = await tombolaEngine.updateConfig(result.data)
      return { success: true, config: updated }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Configuration invalide"
      return reply.status(400).send({ error: msg })
    }
  })

  server.post("/api/admin/draw", async (request, reply) => {
    if (!checkAdminAuth(request, reply)) return

    const result = AdminDrawRequestSchema.safeParse(request.body ?? {})
    if (!result.success) {
      return sendZodError(reply, 400, result.error, "Requête de tirage invalide")
    }

    if (tombolaEngine.getState().draw.hasDrawn && !result.data.force) {
      return reply.status(409).send({ error: "Un gagnant a déjà été tiré" })
    }

    const winner = await tombolaEngine.drawWinner()
    if (!winner) {
      return reply.status(400).send({ error: "Aucun ticket éligible pour effectuer un tirage" })
    }

    return { success: true, winner }
  })

  server.post("/api/admin/reset", async (request, reply) => {
    if (!checkAdminAuth(request, reply)) return

    const archivedAs = await tombolaEngine.resetAll()
    return { success: true, archivedAs }
  })

  server.post("/api/admin/manual-donation", async (request, reply) => {
    if (!checkAdminAuth(request, reply)) return

    const result = ManualDonationSchema.safeParse(request.body)
    if (!result.success) {
      return sendZodError(reply, 400, result.error, "Don invalide")
    }

    // Same rule as the Charity socket channel: tickets are only credited while running
    const state = tombolaEngine.getState()
    if (state.timer.status !== "running") {
      return reply.status(409).send({
        error: "Lancez la tombola avant d'envoyer un don (compte à rebours en cours requis)",
      })
    }

    const { currency } = state.config
    if (result.data.currency && result.data.currency !== currency) {
      return reply.status(400).send({
        error: `La tombola est en ${currency} : convertissez le montant avant de l'ajouter.`,
      })
    }

    const donation = await tombolaEngine.addDonation({ ...result.data, currency })
    return { success: true, donation }
  })

  server.get("/api/admin/archives", async (request, reply) => {
    if (!checkAdminAuth(request, reply)) return

    return { archives: await storage.listArchives() }
  })

  server.get("/api/admin/archives/:fileName", async (request, reply) => {
    if (!checkAdminAuth(request, reply)) return

    const { fileName } = request.params as { fileName: string }
    if (!ARCHIVE_FILENAME_PATTERN.test(fileName)) {
      return reply.status(400).send({ error: "Nom d'archive invalide" })
    }

    const archive = await storage.readArchive(fileName)
    if (!archive) {
      return reply.status(404).send({ error: "Archive introuvable" })
    }

    return archive
  })

  // 4. WebSocket connection endpoint
  server.get("/ws", { websocket: true }, (socket, _req) => {
    wsManager.register(socket)

    // Send initial state immediately upon connection
    socket.send(
      JSON.stringify({
        type: "INITIAL_STATE",
        payload: tombolaEngine.getState(),
      }),
    )
  })

  // 5. Root endpoint and static files serving
  const webDistPath = path.resolve(__dirname, "../../web/dist")
  const indexPath = path.join(webDistPath, "index.html")

  server.get("/", async (_request, reply) => {
    if (fs.existsSync(indexPath)) {
      return reply.type("text/html").send(fs.readFileSync(indexPath, "utf-8"))
    }
    return reply.send({
      name: "Tombola Twitch Streamlabs API",
      status: "ok",
      version: "0.1.0",
      endpoints: {
        health: "/api/health",
        state: "/api/state",
        websocket: "/ws",
      },
    })
  })

  if (fs.existsSync(webDistPath)) {
    await server.register(fastifyStatic, {
      root: webDistPath,
      prefix: "/",
    })
  }

  // SPA fallback: only for GET navigations outside of the API and WebSocket surfaces.
  server.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? ""
    const isApiSurface = url.startsWith("/api/") || url === "/ws" || url.startsWith("/ws?")

    if (request.method === "GET" && !isApiSurface && fs.existsSync(indexPath)) {
      return reply.type("text/html").send(fs.readFileSync(indexPath, "utf-8"))
    }
    return reply.status(404).send({ error: "Not Found" })
  })

  return server
}
