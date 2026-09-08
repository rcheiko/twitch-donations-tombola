import { z } from "zod"
import { DEFAULT_TOMBOLA_CONFIG } from "./constants.js"

export const DonationSchema = z
  .object({
    id: z.string(),
    streamlabsDonationId: z.string().optional(),
    donorName: z.string().trim().min(1).max(64),
    amount: z.number().positive().max(1_000_000),
    currency: z.string().default("EUR"),
    ticketsCount: z.number().int().nonnegative(),
    message: z.string().max(500).default(""),
    createdAt: z.string().datetime(),
  })
  .strict()

export const TopDonationSchema = z
  .object({
    donorName: z.string(),
    amount: z.number().positive(),
    currency: z.string().default("EUR"),
  })
  .strict()

export const TombolaConfigSchema = z
  .object({
    ticketPrice: z
      .number({ invalid_type_error: "Le prix du ticket doit être un nombre valide" })
      .positive("Le prix d'un ticket doit être supérieur à 0 €")
      .max(10_000, "Le prix d'un ticket ne peut pas dépasser 10 000 €")
      .default(DEFAULT_TOMBOLA_CONFIG.ticketPrice),
    lotTitle: z
      .string()
      .trim()
      .min(1, "Le titre du lot ne peut pas être vide")
      .max(120, "Le titre du lot ne peut pas dépasser 120 caractères")
      .default(DEFAULT_TOMBOLA_CONFIG.lotTitle),
    lotSubtitle: z
      .string()
      .trim()
      .max(200, "Le sous-titre du lot ne peut pas dépasser 200 caractères")
      .default(DEFAULT_TOMBOLA_CONFIG.lotSubtitle),
    eventTitle: z
      .string()
      .trim()
      .min(1, "Le titre de l'événement ne peut pas être vide")
      .max(120, "Le titre de l'événement ne peut pas dépasser 120 caractères")
      .default(DEFAULT_TOMBOLA_CONFIG.eventTitle),
    timerDurationSeconds: z
      .number()
      .int()
      .min(10, "La durée du compte à rebours doit être d'au moins 10 secondes")
      .max(86_400, "La durée du compte à rebours ne peut pas dépasser 24 heures")
      .default(DEFAULT_TOMBOLA_CONFIG.timerDurationSeconds),
  })
  .strict()

export const TombolaTimerStatusSchema = z.enum(["idle", "running", "paused", "finished"])

export const TombolaTimerSchema = z
  .object({
    status: TombolaTimerStatusSchema,
    remainingSeconds: z.number().int().nonnegative(),
    endsAt: z.string().datetime().nullable(),
  })
  .strict()

export const TombolaWinnerSchema = z
  .object({
    donorName: z.string(),
    donationId: z.string(),
    ticketsCount: z.number().int().positive(),
    totalDonated: z.number().positive(),
    winningTicketNumber: z.number().int().positive(),
  })
  .strict()

export const TombolaDrawSchema = z
  .object({
    hasDrawn: z.boolean(),
    winner: TombolaWinnerSchema.nullable(),
    drawnAt: z.string().datetime().nullable(),
  })
  .strict()

export const TombolaStatsSchema = z
  .object({
    totalAmount: z.number().nonnegative(),
    donationCount: z.number().int().nonnegative(),
    totalTickets: z.number().int().nonnegative(),
    topDonation: TopDonationSchema.nullable(),
  })
  .strict()

export const TombolaBackupDataSchema = z
  .object({
    version: z.number().int().positive().default(1),
    lastUpdated: z.string().datetime(),
    config: TombolaConfigSchema,
    stats: TombolaStatsSchema,
    timer: TombolaTimerSchema,
    draw: TombolaDrawSchema,
    donations: z.array(DonationSchema),
  })
  .strict()

export const TombolaStateSchema = z
  .object({
    version: z.number().int().positive().default(1),
    lastUpdated: z.string().datetime(),
    config: TombolaConfigSchema,
    stats: TombolaStatsSchema,
    timer: TombolaTimerSchema,
    draw: TombolaDrawSchema,
    recentDonations: z.array(DonationSchema),
  })
  .strict()

export const TombolaArchiveSummarySchema = z
  .object({
    fileName: z.string(),
    eventTitle: z.string(),
    lotTitle: z.string(),
    archivedAt: z.string().datetime(),
    donationCount: z.number().int().nonnegative(),
    totalAmount: z.number().nonnegative(),
    totalTickets: z.number().int().nonnegative(),
    winnerName: z.string().nullable(),
    drawnAt: z.string().datetime().nullable(),
  })
  .strict()

/**
 * Exception to the project-wide `.strict()` rule: Streamlabs sends many extra fields
 * (priority, isTest, from, emotes, ...) that we deliberately ignore instead of rejecting.
 */
export const StreamlabsItemSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  name: z.string().trim().max(64).optional(),
  amount: z.union([z.string(), z.number()]),
  formatted_amount: z.string().optional(),
  currency: z.string().optional().default("EUR"),
  message: z.string().trim().max(500).optional().default(""),
  created_at: z.union([z.number(), z.string()]).optional(),
})

export const AdminTimerActionSchema = z
  .object({
    action: z.enum(["start", "pause", "reset", "add_time"]),
    seconds: z.number().int().min(-86_400).max(86_400).optional(),
  })
  .strict()

export const AdminConfigUpdateSchema = TombolaConfigSchema.partial()

export const AdminDrawRequestSchema = z
  .object({
    force: z.boolean().optional().default(false),
  })
  .strict()

export const ManualDonationSchema = z
  .object({
    donorName: z.string().trim().min(1).max(64),
    amount: z.number().positive().max(1_000_000),
    currency: z.string().default("EUR"),
    message: z.string().trim().max(500).optional().default(""),
  })
  .strict()
