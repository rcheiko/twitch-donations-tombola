/**
 * Formats an amount in the tombola's currency. Falls back to a plain rendering rather
 * than letting Intl throw on an unknown ISO code and blank the overlay mid-show.
 */
export function formatAmount(value: number, currency: string, maximumFractionDigits = 0): string {
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      maximumFractionDigits,
    }).format(value)
  } catch {
    return `${value} ${currency}`
  }
}
