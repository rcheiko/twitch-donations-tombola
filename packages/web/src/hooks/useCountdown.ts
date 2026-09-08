import { remainingSecondsFrom, type TombolaTimer } from "@tombola/contracts"
import { useEffect, useState } from "react"

function getRemainingSeconds(timer: TombolaTimer | undefined, serverOffset = 0): number {
  if (!timer) return 0
  if (timer.status !== "running" || !timer.endsAt) {
    return Math.max(0, timer.remainingSeconds)
  }
  return remainingSecondsFrom(timer.endsAt, Date.now() + serverOffset)
}

function formatRemaining(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`
}

export function useCountdown(
  timer: TombolaTimer | undefined,
  serverOffset = 0,
): {
  remainingSeconds: number
  formattedTimer: string
} {
  const status = timer?.status
  const endsAt = timer?.endsAt ?? null
  const timerRemaining = timer?.remainingSeconds ?? 0

  const [remaining, setRemaining] = useState<number>(() => getRemainingSeconds(timer, serverOffset))

  useEffect(() => {
    const compute = () =>
      status === "running" && endsAt
        ? remainingSecondsFrom(endsAt, Date.now() + serverOffset)
        : Math.max(0, timerRemaining)

    setRemaining(compute())

    if (status !== "running" || !endsAt) {
      return
    }

    const interval = setInterval(() => {
      const current = compute()
      setRemaining(current)
      if (current <= 0) {
        clearInterval(interval)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [status, endsAt, timerRemaining, serverOffset])

  return { remainingSeconds: remaining, formattedTimer: formatRemaining(remaining) }
}
