import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import { z } from "zod"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Ensure .env is loaded reliably from cwd or repo root in monorepo
const possibleEnvPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "../../../.env"),
  path.resolve(__dirname, "../../.env"),
  path.resolve(process.cwd(), "../../.env"),
]

// Directory the loaded .env lives in (falls back to cwd). A relative DATA_DIR is
// resolved against it, so `DATA_DIR=./data` means the same folder whether the API
// is started from the monorepo root or from packages/api (turbo).
let envBaseDir = process.cwd()
for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
    envBaseDir = path.dirname(envPath)
    break
  }
}

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().default(3000),
    HOST: z.string().default("0.0.0.0"),
    DATA_DIR: z.string().default("./data"),
    STREAMLABS_SOCKET_TOKEN: z.string().optional(),
    ADMIN_SECRET_KEY: z.string().optional(),
  })
  // Production guards live in a refinement (not a transform) so that failures are collected
  // as Zod issues and displayed by the error block below instead of throwing past safeParse.
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== "production") return

    if (!data.STREAMLABS_SOCKET_TOKEN || data.STREAMLABS_SOCKET_TOKEN.length < 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STREAMLABS_SOCKET_TOKEN"],
        message:
          "❌ CONFIGURATION : En production, STREAMLABS_SOCKET_TOKEN doit être configuré (Streamlabs: Profil en haut à droite -> Account Settings -> API Settings -> API Tokens -> Your Socket API Token).",
      })
    }

    if (
      !data.ADMIN_SECRET_KEY ||
      data.ADMIN_SECRET_KEY.includes("default") ||
      data.ADMIN_SECRET_KEY.length < 16
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ADMIN_SECRET_KEY"],
        message:
          "❌ SÉCURITÉ CRITIQUE : En production, ADMIN_SECRET_KEY doit être défini dans le .env et comporter au moins 16 caractères aléatoires (pas de valeur par défaut).",
      })
    }
  })
  .transform((data) => ({
    ...data,
    // Tests always get an isolated throwaway directory; otherwise a relative DATA_DIR
    // is resolved against the directory of the loaded .env (or cwd without .env).
    DATA_DIR:
      data.NODE_ENV === "test"
        ? path.resolve(os.tmpdir(), `tombola-test-${process.pid}`)
        : path.resolve(envBaseDir, data.DATA_DIR),
    ADMIN_SECRET_KEY: data.ADMIN_SECRET_KEY || "dev_admin_secret_insecure_456",
  }))

const parsed = EnvSchema.safeParse(process.env)

if (!parsed.success) {
  console.error("❌ Erreur de configuration d'environnement :")
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.message}`)
  }
  process.exit(1)
}

export const config = parsed.data
