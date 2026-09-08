import type { FastifyBaseLogger } from "fastify"
import { io, type Socket } from "socket.io-client"
import { ingestStreamlabsItem } from "./donation-ingest.js"
import type { TombolaEngine } from "./tombola-engine.js"

export class StreamlabsListener {
  private socket: Socket | null = null
  private isConnected = false

  constructor(
    private token: string | undefined,
    private engine: TombolaEngine,
    private logger: FastifyBaseLogger,
  ) {}

  start() {
    if (!this.token) {
      this.logger.info(
        "ℹ️ STREAMLABS_SOCKET_TOKEN not provided, Streamlabs Socket listener inactive.",
      )
      return
    }

    this.logger.info("Connecting to Streamlabs Socket API (https://sockets.streamlabs.com)...")
    this.socket = io(`https://sockets.streamlabs.com?token=${this.token}`, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
    })

    this.socket.on("connect", () => {
      this.isConnected = true
      this.logger.info(
        "✅ Connected to Streamlabs Socket API! Live donations and test alerts are active.",
      )
    })

    this.socket.on("disconnect", (reason) => {
      this.isConnected = false
      this.logger.warn("Streamlabs Socket disconnected: %s", reason)
    })

    this.socket.on("connect_error", (err) => {
      this.logger.error("Streamlabs Socket connection error: %s", err.message)
    })

    this.socket.on("event", async (eventData: unknown) => {
      if (!eventData || typeof eventData !== "object") return

      const payload = eventData as { type?: string; message?: unknown }

      // Intercept donation events (both live tips and Alert Box 'Test Donation' clicks)
      if (payload.type !== "donation" || !Array.isArray(payload.message)) return

      for (const item of payload.message) {
        try {
          await ingestStreamlabsItem(this.engine, item, this.logger)
        } catch (err) {
          this.logger.error(err, "Failed to process Streamlabs donation from Socket API")
        }
      }
    })
  }

  stop() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
      this.isConnected = false
      this.logger.info("Streamlabs Socket listener stopped.")
    }
  }

  get connected(): boolean {
    return this.isConnected
  }
}
