import type { SocketEvent } from "@tombola/contracts"
import type { WebSocket } from "ws"

interface HeartbeatWebSocket extends WebSocket {
  isAlive?: boolean
}

export class WebSocketManager {
  private clients: Set<HeartbeatWebSocket> = new Set()
  private heartbeatInterval: NodeJS.Timeout | null = null

  constructor() {
    this.startHeartbeat()
  }

  private startHeartbeat(): void {
    // Ping every 30 seconds to clean up zombie/dead sockets
    this.heartbeatInterval = setInterval(() => {
      for (const socket of this.clients) {
        if (socket.isAlive === false) {
          this.clients.delete(socket)
          socket.terminate()
          continue
        }
        socket.isAlive = false
        socket.ping()
      }
    }, 30000)

    // Unref so heartbeat does not keep Node.js process alive unnecessarily
    this.heartbeatInterval.unref?.()
  }

  register(socket: HeartbeatWebSocket): void {
    socket.isAlive = true
    this.clients.add(socket)

    socket.on("pong", () => {
      socket.isAlive = true
    })

    socket.on("close", () => {
      this.clients.delete(socket)
    })

    socket.on("error", (err) => {
      console.warn("WebSocket client error:", err)
      this.clients.delete(socket)
    })
  }

  broadcast(event: SocketEvent): void {
    const payload = JSON.stringify(event)
    for (const client of this.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(payload)
      }
    }
  }

  get clientCount(): number {
    return this.clients.size
  }

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    for (const socket of this.clients) {
      socket.terminate()
    }
    this.clients.clear()
  }
}

export const wsManager = new WebSocketManager()
