/**
 * Pure helpers shared by the API and the web app.
 * Zero dependency, zero side effect: they must stay safely importable everywhere.
 */

/**
 * Remaining whole seconds before `endsAt`, never negative.
 * Returns 0 when `endsAt` is null or unparsable.
 */
export function remainingSecondsFrom(endsAt: string | null, nowMs: number = Date.now()): number {
  if (!endsAt) return 0
  const endMs = Date.parse(endsAt)
  if (Number.isNaN(endMs)) return 0
  return Math.max(0, Math.ceil((endMs - nowMs) / 1000))
}

/**
 * Number of raffle tickets granted by `amount` at `ticketPrice`.
 * Computed with integer cents to avoid float drift (0.30 / 0.10 must give 3, not 2).
 * A ticket price rounding to less than one cent is clamped to one cent.
 */
export function ticketsFor(amount: number, ticketPrice: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(ticketPrice)) return 0
  const amountCents = Math.round(amount * 100)
  const priceCents = Math.max(1, Math.round(ticketPrice * 100))
  if (amountCents <= 0) return 0
  return Math.max(0, Math.floor(amountCents / priceCents))
}

/**
 * Filesystem-safe slug: lowercase, accents stripped, non alphanumeric collapsed to "-",
 * truncated to 40 characters.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "")
}
