import type { FastifyBaseLogger } from "fastify"
import { io, type Socket } from "socket.io-client"
import { ingestCharityDonationItem } from "./donation-ingest.js"
import type { TombolaEngine } from "./tombola-engine.js"

/** Charity rides the same socket and token as classic tips; only the event type differs. */
const CHARITY_EVENT_TYPE = "streamlabscharitydonation"

export class StreamlabsCharityListener {
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
        "ℹ️ STREAMLABS_SOCKET_TOKEN not provided, Streamlabs Charity listener inactive.",
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
        "✅ Connected to Streamlabs Socket API! Streamlabs Charity donations are active.",
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

      // Charity only: classic `donation` tips are deliberately ignored.
      if (payload.type !== CHARITY_EVENT_TYPE || payload.message == null) return

      const items = Array.isArray(payload.message) ? payload.message : [payload.message]

      for (const item of items) {
        try {
          await ingestCharityDonationItem(this.engine, item, this.logger)
        } catch (err) {
          this.logger.error(err, "Failed to process Streamlabs Charity donation from Socket API")
        }
      }
    })
  }

  stop() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
      this.isConnected = false
      this.logger.info("Streamlabs Charity listener stopped.")
    }
  }

  get connected(): boolean {
    return this.isConnected
  }
}
