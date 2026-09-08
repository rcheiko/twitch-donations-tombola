/**
 * Accent palettes selectable for the OBS overlay from the admin panel.
 * Each entry must have a matching `[data-overlay-theme="…"]` block in the web app's
 * `index.css`, which is where the actual colours live.
 */
export const OVERLAY_THEMES = ["rose", "gold"] as const

export const DEFAULT_TOMBOLA_CONFIG = {
  ticketPrice: 1,
  currency: "EUR",
  lotTitle: "Gift title",
  lotSubtitle: "",
  eventTitle: "TOMBOLA",
  timerDurationSeconds: 900,
  overlayTheme: "rose",
} as const
