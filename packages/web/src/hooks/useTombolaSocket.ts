import type { Donation, SocketEvent, TombolaState } from "@tombola/contracts"
import { useCallback, useEffect, useRef, useState } from "react"
import { getWsUrl } from "../lib/api.js"

const INITIAL_RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_DELAY_MS = 30000

export function useTombolaSocket() {
  const [state, setState] = useState<TombolaState | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [lastDonation, setLastDonation] = useState<Donation | null>(null)
  const [serverOffset, setServerOffset] = useState<number>(0)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const donationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelayRef = useRef<number>(INITIAL_RECONNECT_DELAY_MS)

  const connect = useCallback(() => {
    const wsUrl = getWsUrl()
    const ws = new WebSocket(wsUrl)
    socketRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      // Successful connection: reset the exponential backoff.
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as SocketEvent
        switch (msg.type) {
          case "INITIAL_STATE": {
            setState(msg.payload)
            // Synchronize client clock with server time to eliminate clock drift
            if (msg.payload.lastUpdated) {
              const serverTime = new Date(msg.payload.lastUpdated).getTime()
              setServerOffset(serverTime - Date.now())
            }
            break
          }
          case "DONATION_RECEIVED":
            setLastDonation(msg.payload.donation)
            if (donationTimeoutRef.current) {
              clearTimeout(donationTimeoutRef.current)
            }
            donationTimeoutRef.current = setTimeout(() => {
              setLastDonation(null)
            }, 5000)
            setState((prev) => {
              if (!prev) return null
              return {
                ...prev,
                stats: msg.payload.stats,
                recentDonations: [msg.payload.donation, ...prev.recentDonations.slice(0, 19)],
              }
            })
            break
          case "TIMER_UPDATED":
            setState((prev) => (prev ? { ...prev, timer: msg.payload } : null))
            break
          case "CONFIG_UPDATED":
            setState((prev) => (prev ? { ...prev, config: msg.payload } : null))
            break
          case "WINNER_DRAWN":
            setState((prev) => (prev ? { ...prev, draw: msg.payload } : null))
            break
          case "STATE_RESET":
            if (donationTimeoutRef.current) {
              clearTimeout(donationTimeoutRef.current)
            }
            setState(msg.payload)
            setLastDonation(null)
            break
        }
      } catch (err) {
        console.error("Failed to parse websocket message:", err)
      }
    }

    ws.onclose = () => {
      setIsConnected(false)
      // Guard against duplicate reconnects from unmounted/superseded sockets
      if (socketRef.current !== ws) return

      const delay = reconnectDelayRef.current
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS)
      reconnectTimeoutRef.current = setTimeout(() => {
        connect()
      }, delay)
    }

    ws.onerror = (err) => {
      console.warn("WebSocket error:", err)
      ws.close()
    }
  }, [])

  useEffect(() => {
    connect()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (donationTimeoutRef.current) {
        clearTimeout(donationTimeoutRef.current)
      }
      if (socketRef.current) {
        const s = socketRef.current
        socketRef.current = null
        s.close()
      }
    }
  }, [connect])

  return { state, isConnected, lastDonation, serverOffset }
}
