import { z } from "zod"
import { DEFAULT_TOMBOLA_CONFIG, OVERLAY_THEMES } from "./constants.js"

/** Keeps files written before the id rename readable: `id` and `donationId` are remapped. */
function acceptLegacyKey<T extends z.ZodTypeAny>(legacyKey: string, currentKey: string, schema: T) {
  return z.preprocess((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value

    const record = value as Record<string, unknown>
    if (record[currentKey] !== undefined || typeof record[legacyKey] !== "string") return value

    const { [legacyKey]: legacyValue, ...rest } = record
    return { ...rest, [currentKey]: legacyValue }
  }, schema)
}

export const DonationSchema = acceptLegacyKey(
  "id",
  "localDonationId",
  z
    .object({
      /** Generated here, `don_<millis>_<random>`. */
      localDonationId: z.string(),
      /** Streamlabs' `charityDonationId` (or `_id`). Absent on a manual donation. */
      streamlabsDonationId: z.string().optional(),
      /**
       * Streamlabs' own donation date, verbatim as sent (`"2024-09-06 20:29:57"`), never
       * converted: it carries no timezone marker and Streamlabs documents none.
       * Not to be confused with `createdAt`, the reception time on this server.
       */
      streamlabsCreatedAt: z.string().max(64).optional(),
      donorName: z.string().trim().min(1).max(64),
      amount: z.number().positive().max(1_000_000),
      currency: z.string().default("EUR"),
      ticketsCount: z.number().int().nonnegative(),
      message: z.string().max(500).default(""),
      createdAt: z.string().datetime(),
    })
    .strict(),
)

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
    // Ticket maths and the raised total are expressed in this currency only; a donation
    // in any other currency is refused rather than counted at face value.
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .length(3, "La devise doit être un code ISO à 3 lettres (ex : EUR)")
      .default(DEFAULT_TOMBOLA_CONFIG.currency),
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
    // Defaulted, so a backup.json written before themes existed still loads.
    overlayTheme: z
      .enum(OVERLAY_THEMES, {
        errorMap: () => ({
          message: `Thème d'overlay invalide (attendu : ${OVERLAY_THEMES.join(" ou ")})`,
        }),
      })
      .default(DEFAULT_TOMBOLA_CONFIG.overlayTheme),
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

export const TombolaWinnerSchema = acceptLegacyKey(
  "donationId",
  "localDonationId",
  z
    .object({
      donorName: z.string(),
      /** Matches the winning entry in `donations`. */
      localDonationId: z.string(),
      ticketsCount: z.number().int().positive(),
      totalDonated: z.number().positive(),
      winningTicketNumber: z.number().int().positive(),
    })
    .strict(),
)

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
    /** Charity id of the winning donation, null for a manual donation or an untracked one. */
    winnerStreamlabsDonationId: z.string().nullable(),
    drawnAt: z.string().datetime().nullable(),
  })
  .strict()

/**
 * Item of a `streamlabscharitydonation` socket event: the donor is `from`, the stable id
 * is `charityDonationId` (`id` is only a per-alert counter), and `amount` is a string.
 *
 * Documented exception to the project-wide `.strict()` rule, because Streamlabs adds extra
 * fields to its events. Free-text lengths stay unbounded here on purpose: ingestion
 * truncates rather than dropping a real donation.
 */
export const StreamlabsCharityItemSchema = z.object({
  charityDonationId: z.union([z.string(), z.number()]).optional(),
  /** Fallback deduplication key when `charityDonationId` is absent. */
  _id: z.string().optional(),
  from: z
    .string()
    .nullish()
    .transform((value) => value ?? ""),
  amount: z.union([z.string(), z.number()]),
  currency: z
    .string()
    .nullish()
    .transform((value) => value || "EUR"),
  message: z
    .string()
    .nullish()
    .transform((value) => value ?? ""),
  /** Streamlabs-side donation time, `"YYYY-MM-DD HH:mm:ss"` in practice, timezone undocumented. */
  createdAt: z.union([z.string(), z.number()]).nullish(),
  isTest: z.boolean().optional(),
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
    currency: z.string().trim().toUpperCase().length(3).optional(),
    message: z.string().trim().max(500).optional().default(""),
  })
  .strict()
