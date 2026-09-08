import type { z } from "zod"
import type {
  AdminConfigUpdateSchema,
  AdminDrawRequestSchema,
  AdminTimerActionSchema,
  DonationSchema,
  ManualDonationSchema,
  StreamlabsCharityItemSchema,
  TombolaArchiveSummarySchema,
  TombolaBackupDataSchema,
  TombolaConfigSchema,
  TombolaDrawSchema,
  TombolaStateSchema,
  TombolaStatsSchema,
  TombolaTimerSchema,
  TombolaWinnerSchema,
  TopDonationSchema,
} from "./schemas.js"

export type Donation = z.infer<typeof DonationSchema>
export type TopDonation = z.infer<typeof TopDonationSchema>
export type TombolaConfig = z.infer<typeof TombolaConfigSchema>
export type OverlayTheme = TombolaConfig["overlayTheme"]
export type TombolaTimer = z.infer<typeof TombolaTimerSchema>
export type TombolaWinner = z.infer<typeof TombolaWinnerSchema>
export type TombolaDraw = z.infer<typeof TombolaDrawSchema>
export type TombolaStats = z.infer<typeof TombolaStatsSchema>
export type TombolaBackupData = z.infer<typeof TombolaBackupDataSchema>
export type TombolaState = z.infer<typeof TombolaStateSchema>
export type StreamlabsCharityItem = z.infer<typeof StreamlabsCharityItemSchema>
export type AdminTimerAction = z.infer<typeof AdminTimerActionSchema>
export type AdminConfigUpdate = z.infer<typeof AdminConfigUpdateSchema>
export type ManualDonation = z.infer<typeof ManualDonationSchema>
export type AdminDrawRequest = z.infer<typeof AdminDrawRequestSchema>
export type TombolaArchiveSummary = z.infer<typeof TombolaArchiveSummarySchema>

export type SocketEvent =
  | { type: "INITIAL_STATE"; payload: TombolaState }
  | { type: "DONATION_RECEIVED"; payload: { donation: Donation; stats: TombolaStats } }
  | { type: "TIMER_UPDATED"; payload: TombolaTimer }
  | { type: "CONFIG_UPDATED"; payload: TombolaConfig }
  | { type: "WINNER_DRAWN"; payload: TombolaDraw }
  | { type: "STATE_RESET"; payload: TombolaState }
