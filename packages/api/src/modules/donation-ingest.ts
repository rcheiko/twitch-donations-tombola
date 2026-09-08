import { type Donation, StreamlabsItemSchema } from "@tombola/contracts"
import type { TombolaEngine } from "./tombola-engine.js"

/** Minimal logging surface, satisfied by Fastify's logger and by test doubles. */
export interface IngestLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** Highest donation amount accepted, mirroring DonationSchema. */
const MAX_DONATION_AMOUNT = 1_000_000

/**
 * Single ingestion path for a Streamlabs donation item (socket API).
 * Returns the credited donation, or null when the item is ignored (invalid payload,
 * non-positive/out-of-range amount, or tombola not running).
 */
export async function ingestStreamlabsItem(
  engine: TombolaEngine,
  rawItem: unknown,
  logger?: IngestLogger,
): Promise<Donation | null> {
  const parsed = StreamlabsItemSchema.safeParse(rawItem)
  if (!parsed.success) {
    logger?.warn("Invalid Streamlabs donation item ignored: %j", parsed.error.format())
    return null
  }

  const item = parsed.data
  const amount =
    typeof item.amount === "number" ? item.amount : Number.parseFloat(String(item.amount))

  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_DONATION_AMOUNT) {
    logger?.warn("Streamlabs donation ignored: unusable amount (%s)", String(item.amount))
    return null
  }

  const donorName = item.name?.trim() || "Anonyme"

  // Only credit donations while the tombola is actually running
  const state = engine.getState()
  if (state.timer.status !== "running") {
    logger?.info(
      "ℹ️ Streamlabs donation from %s (%d€) ignored: tombola is not currently running (status: %s).",
      donorName,
      amount,
      state.timer.status,
    )
    return null
  }

  logger?.info("🎉 Streamlabs donation received via Socket API: %s - %d€", donorName, amount)

  return engine.addDonation({
    donorName,
    amount,
    currency: item.currency || "EUR",
    message: item.message,
    streamlabsDonationId: item.id !== undefined ? String(item.id) : undefined,
  })
}
