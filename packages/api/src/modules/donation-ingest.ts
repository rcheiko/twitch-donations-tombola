import { type Donation, StreamlabsCharityItemSchema } from "@tombola/contracts"
import type { TombolaEngine } from "./tombola-engine.js"

/** Minimal logging surface, satisfied by Fastify's logger and by test doubles. */
export interface IngestLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** Bounds mirroring DonationSchema. */
const MAX_DONATION_AMOUNT = 1_000_000
const MAX_DONOR_NAME_LENGTH = 64
const MAX_MESSAGE_LENGTH = 500

/** Trims then caps a free-text field, so an over-long value is shortened, never rejected. */
function truncate(value: string | null | undefined, maxLength: number): string {
  return (value ?? "").trim().slice(0, maxLength)
}

/**
 * Single ingestion path for a Streamlabs Charity donation item.
 * Returns the credited donation, or null when the item is ignored (invalid payload,
 * non-positive/out-of-range amount, or tombola not running).
 */
export async function ingestCharityDonationItem(
  engine: TombolaEngine,
  rawItem: unknown,
  logger?: IngestLogger,
): Promise<Donation | null> {
  const parsed = StreamlabsCharityItemSchema.safeParse(rawItem)
  if (!parsed.success) {
    logger?.warn("Invalid Streamlabs Charity donation item ignored: %j", parsed.error.format())
    return null
  }

  const item = parsed.data
  const amount =
    typeof item.amount === "number" ? item.amount : Number.parseFloat(String(item.amount))

  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_DONATION_AMOUNT) {
    logger?.warn("Streamlabs Charity donation ignored: unusable amount (%s)", String(item.amount))
    return null
  }

  const donorName = truncate(item.from, MAX_DONOR_NAME_LENGTH) || "Anonyme"

  // Only credit donations while the tombola is actually running
  const state = engine.getState()
  if (state.timer.status !== "running") {
    logger?.info(
      "ℹ️ Streamlabs Charity donation from %s (%d) ignored: tombola is not currently running (status: %s).",
      donorName,
      amount,
      state.timer.status,
    )
    return null
  }

  // Crediting a foreign currency at face value would hand out tickets far too cheaply
  // (5000 HUF is ~12 €), so ignore it rather than guess an exchange rate.
  const expectedCurrency = state.config.currency
  const currency = item.currency.trim().toUpperCase()
  if (currency !== expectedCurrency) {
    logger?.warn(
      "⚠️ Streamlabs Charity donation from %s refused: received %s %s while the tombola runs in %s. No ticket credited; re-enter it converted from /admin.",
      donorName,
      String(amount),
      currency,
      expectedCurrency,
    )
    return null
  }

  logger?.info(
    "🎉 Streamlabs Charity donation received: %s - %d %s%s",
    donorName,
    amount,
    currency,
    item.isTest ? " (test event)" : "",
  )

  const charityDonationId =
    item.charityDonationId !== undefined ? String(item.charityDonationId) : item._id

  return engine.addDonation({
    donorName,
    amount,
    currency,
    message: truncate(item.message, MAX_MESSAGE_LENGTH),
    streamlabsDonationId: charityDonationId,
  })
}
