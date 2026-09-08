import crypto from "node:crypto"
import {
  DEFAULT_TOMBOLA_CONFIG,
  type Donation,
  DonationSchema,
  remainingSecondsFrom,
  type TombolaBackupData,
  type TombolaConfig,
  TombolaConfigSchema,
  type TombolaDraw,
  type TombolaState,
  type TombolaStats,
  type TombolaTimer,
  type TombolaWinner,
  ticketsFor,
} from "@tombola/contracts"
import { type StorageService, storage } from "./storage.js"
import { wsManager } from "./ws.js"

/** crypto.randomInt() only supports ranges below 2^48. */
const MAX_CRYPTO_RANDOM_RANGE = 2 ** 48 - 1

export class TombolaEngine {
  private readonly storage: StorageService
  private config: TombolaConfig
  private stats: TombolaStats
  private timer: TombolaTimer
  private draw: TombolaDraw
  private donations: Donation[] = []
  private timerTimeout: NodeJS.Timeout | null = null

  constructor(customStorage?: StorageService) {
    this.storage = customStorage || storage
    this.config = { ...DEFAULT_TOMBOLA_CONFIG }

    this.stats = {
      totalAmount: 0,
      donationCount: 0,
      totalTickets: 0,
      topDonation: null,
    }

    this.timer = {
      status: "idle",
      remainingSeconds: DEFAULT_TOMBOLA_CONFIG.timerDurationSeconds,
      endsAt: null,
    }

    this.draw = {
      hasDrawn: false,
      winner: null,
      drawnAt: null,
    }
  }

  async init(): Promise<void> {
    const loaded = await this.storage.load()
    if (!loaded) return

    this.config = loaded.config
    this.stats = loaded.stats
    this.timer = loaded.timer
    this.draw = loaded.draw
    this.donations = loaded.donations

    // If timer was running before crash/restart, recompute remaining time from endsAt
    if (this.timer.status === "running" && this.timer.endsAt) {
      const remaining = remainingSecondsFrom(this.timer.endsAt)
      if (remaining > 0) {
        this.timer.remainingSeconds = remaining
        this.scheduleTimerFinish()
      } else {
        this.timer.status = "finished"
        this.timer.remainingSeconds = 0
        this.timer.endsAt = null
      }
    }
  }

  getState(): TombolaState {
    const currentTimer = { ...this.timer }
    if (currentTimer.status === "running" && currentTimer.endsAt) {
      currentTimer.remainingSeconds = remainingSecondsFrom(currentTimer.endsAt)
    }

    return {
      version: 1,
      lastUpdated: new Date().toISOString(),
      config: this.config,
      stats: this.stats,
      timer: currentTimer,
      draw: this.draw,
      recentDonations: this.donations.slice(-20).reverse(),
    }
  }

  private getBackupData(): TombolaBackupData {
    return {
      version: 1,
      lastUpdated: new Date().toISOString(),
      config: this.config,
      stats: this.stats,
      timer: this.timer,
      draw: this.draw,
      donations: this.donations,
    }
  }

  async addDonation(input: {
    donorName: string
    amount: number
    currency?: string
    message?: string
    streamlabsDonationId?: string
  }): Promise<Donation> {
    // Idempotency: Streamlabs may replay the same tip on socket reconnection.
    if (input.streamlabsDonationId) {
      const existing = this.donations.find(
        (d) => d.streamlabsDonationId === input.streamlabsDonationId,
      )
      if (existing) return existing
    }

    const tickets = ticketsFor(input.amount, this.config.ticketPrice)

    const donation: Donation = DonationSchema.parse({
      id: `don_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      streamlabsDonationId: input.streamlabsDonationId,
      donorName: input.donorName.trim() || "Anonyme",
      amount: input.amount,
      currency: input.currency || this.config.currency,
      ticketsCount: tickets,
      message: input.message ? input.message.trim() : "",
      createdAt: new Date().toISOString(),
    })

    this.donations.push(donation)

    // Update stats
    this.stats.totalAmount = Math.round((this.stats.totalAmount + donation.amount) * 100) / 100
    this.stats.donationCount += 1
    this.stats.totalTickets += tickets

    if (!this.stats.topDonation || donation.amount > this.stats.topDonation.amount) {
      this.stats.topDonation = {
        donorName: donation.donorName,
        amount: donation.amount,
        currency: donation.currency,
      }
    }

    // Persist to backup.json immediately
    await this.storage.save(this.getBackupData())

    // Broadcast to overlay & admin
    wsManager.broadcast({
      type: "DONATION_RECEIVED",
      payload: {
        donation,
        stats: this.stats,
      },
    })

    return donation
  }

  async startTimer(): Promise<void> {
    if (this.timer.status === "running") return

    if (this.timer.remainingSeconds <= 0) {
      this.timer.remainingSeconds = this.config.timerDurationSeconds
    }

    this.timer.status = "running"
    this.timer.endsAt = new Date(Date.now() + this.timer.remainingSeconds * 1000).toISOString()

    this.scheduleTimerFinish()
    await this.persistAndBroadcastTimer()
  }

  async pauseTimer(): Promise<void> {
    if (this.timer.status !== "running") return

    this.clearTimerTimeout()

    this.timer.remainingSeconds = remainingSecondsFrom(this.timer.endsAt)
    this.timer.status = "paused"
    this.timer.endsAt = null

    await this.persistAndBroadcastTimer()
  }

  async resetTimer(): Promise<void> {
    this.clearTimerTimeout()

    this.timer.status = "idle"
    this.timer.remainingSeconds = this.config.timerDurationSeconds
    this.timer.endsAt = null

    await this.persistAndBroadcastTimer()
  }

  async addTimerSeconds(seconds: number): Promise<void> {
    if (this.timer.status === "running" && this.timer.endsAt) {
      const next = Math.max(0, remainingSecondsFrom(this.timer.endsAt) + seconds)
      this.timer.remainingSeconds = next
      this.timer.endsAt = new Date(Date.now() + next * 1000).toISOString()
      this.scheduleTimerFinish()
    } else {
      this.timer.remainingSeconds = Math.max(0, this.timer.remainingSeconds + seconds)
    }

    await this.persistAndBroadcastTimer()
  }

  /** Stops any pending timer callback. Used on shutdown and in tests. */
  dispose(): void {
    this.clearTimerTimeout()
  }

  private clearTimerTimeout(): void {
    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout)
      this.timerTimeout = null
    }
  }

  private async persistAndBroadcastTimer(): Promise<void> {
    await this.storage.save(this.getBackupData())
    wsManager.broadcast({ type: "TIMER_UPDATED", payload: this.timer })
  }

  private scheduleTimerFinish(): void {
    this.clearTimerTimeout()

    if (this.timer.status !== "running" || !this.timer.endsAt) return

    const delayMs = Math.max(0, Date.parse(this.timer.endsAt) - Date.now())

    this.timerTimeout = setTimeout(async () => {
      this.timer.status = "finished"
      this.timer.remainingSeconds = 0
      this.timer.endsAt = null
      this.timerTimeout = null

      try {
        await this.persistAndBroadcastTimer()
      } catch (err) {
        console.error("❌ Failed to persist finished timer state:", err)
      }
    }, delayMs)
    this.timerTimeout.unref?.()
  }

  async updateConfig(partial: Partial<TombolaConfig>): Promise<TombolaConfig> {
    const merged = TombolaConfigSchema.safeParse({ ...this.config, ...partial })
    if (!merged.success) {
      throw new Error(merged.error.errors[0]?.message || "Configuration invalide")
    }

    const previousDuration = this.config.timerDurationSeconds
    this.config = merged.data

    // An idle or finished countdown must immediately reflect the new duration.
    const durationChanged = this.config.timerDurationSeconds !== previousDuration
    const timerIsStopped = this.timer.status === "idle" || this.timer.status === "finished"
    if (durationChanged && timerIsStopped) {
      this.timer.remainingSeconds = this.config.timerDurationSeconds
      this.timer.endsAt = null
    }

    await this.storage.save(this.getBackupData())

    wsManager.broadcast({ type: "CONFIG_UPDATED", payload: this.config })
    if (durationChanged && timerIsStopped) {
      wsManager.broadcast({ type: "TIMER_UPDATED", payload: this.timer })
    }

    return this.config
  }

  async drawWinner(): Promise<TombolaWinner | null> {
    const eligible = this.donations.filter((d) => d.ticketsCount > 0)
    const totalTickets = eligible.reduce((sum, d) => sum + d.ticketsCount, 0)
    if (totalTickets <= 0) return null

    const winningTicket =
      totalTickets <= MAX_CRYPTO_RANDOM_RANGE
        ? crypto.randomInt(1, totalTickets + 1)
        : Math.floor(Math.random() * totalTickets) + 1

    // Walk per-donation ticket intervals to find the donation holding the winning ticket.
    let cumulative = 0
    let winningDonation: Donation | null = null
    for (const donation of eligible) {
      cumulative += donation.ticketsCount
      if (winningTicket <= cumulative) {
        winningDonation = donation
        break
      }
    }

    if (!winningDonation) return null

    // Aggregate the winner's totals across all of their donations (display only).
    let ticketsCount = 0
    let totalDonated = 0
    for (const donation of this.donations) {
      if (donation.donorName === winningDonation.donorName) {
        ticketsCount += donation.ticketsCount
        totalDonated += donation.amount
      }
    }

    const selectedWinner: TombolaWinner = {
      donorName: winningDonation.donorName,
      donationId: winningDonation.id,
      ticketsCount,
      totalDonated: Math.round(totalDonated * 100) / 100,
      winningTicketNumber: winningTicket,
    }

    this.draw = {
      hasDrawn: true,
      winner: selectedWinner,
      drawnAt: new Date().toISOString(),
    }

    await this.storage.save(this.getBackupData())

    wsManager.broadcast({ type: "WINNER_DRAWN", payload: this.draw })

    return selectedWinner
  }

  /**
   * Archives the current tombola (when it holds anything worth keeping) then wipes the state.
   * Returns the archive file name, or null when nothing was archived.
   */
  async resetAll(): Promise<string | null> {
    this.clearTimerTimeout()

    let archivedAs: string | null = null
    if (this.donations.length > 0 || this.draw.hasDrawn) {
      archivedAs = await this.storage.archive(this.getBackupData())
    }

    this.stats = {
      totalAmount: 0,
      donationCount: 0,
      totalTickets: 0,
      topDonation: null,
    }

    this.timer = {
      status: "idle",
      remainingSeconds: this.config.timerDurationSeconds,
      endsAt: null,
    }

    this.draw = {
      hasDrawn: false,
      winner: null,
      drawnAt: null,
    }

    this.donations = []

    await this.storage.save(this.getBackupData())

    wsManager.broadcast({ type: "STATE_RESET", payload: this.getState() })

    return archivedAs
  }
}

export const tombolaEngine = new TombolaEngine()
