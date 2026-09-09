import fs from "node:fs/promises"
import path from "node:path"
import {
  slugify,
  type TombolaArchiveSummary,
  type TombolaBackupData,
  TombolaBackupDataSchema,
} from "@tombola/contracts"
import { config } from "../config.js"

export const ARCHIVE_FILENAME_PATTERN = /^[a-z0-9._-]+\.json$/

export class StorageService {
  private readonly dataDir: string
  private readonly filePath: string
  private readonly tmpFilePath: string
  private readonly archiveDir: string
  /** Serializes disk writes: each save() resolves only once its own payload hit the disk. */
  private writeChain: Promise<void> = Promise.resolve()

  constructor(customDataDir?: string) {
    this.dataDir = customDataDir || config.DATA_DIR
    this.filePath = path.join(this.dataDir, "backup.json")
    this.tmpFilePath = path.join(this.dataDir, "backup.json.tmp")
    this.archiveDir = path.join(this.dataDir, "archive")
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true })
  }

  async load(): Promise<TombolaBackupData | null> {
    await this.init()

    try {
      const content = await fs.readFile(this.filePath, "utf-8")
      if (!content.trim()) return null

      const parsed = JSON.parse(content)
      const validated = TombolaBackupDataSchema.safeParse(parsed)

      if (!validated.success) {
        console.warn(
          "⚠️ Corrupted backup.json, creating a timestamped backup before recovery:",
          validated.error.format(),
        )
        const corruptedBackupPath = path.join(this.dataDir, `backup.corrupted.${Date.now()}.json`)
        await fs.copyFile(this.filePath, corruptedBackupPath)
        return null
      }

      return validated.data
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null
      }
      if (err instanceof SyntaxError) {
        console.warn("⚠️ Unparsable backup.json, creating a timestamped backup before recovery")
        const corruptedBackupPath = path.join(this.dataDir, `backup.corrupted.${Date.now()}.json`)
        await fs.copyFile(this.filePath, corruptedBackupPath)
        return null
      }
      console.error("❌ Failed to read backup.json:", err)
      return null
    }
  }

  /**
   * Persists `data` atomically. The returned promise resolves only once the given payload
   * (or a more recent one queued after it) is actually on disk, and a later failing write
   * never rejects an already successful save.
   */
  async save(data: TombolaBackupData): Promise<void> {
    const validated = TombolaBackupDataSchema.safeParse(data)
    if (!validated.success) {
      console.error("❌ Refusing to write an invalid backup.json:", validated.error.format())
      throw new Error("Invalid backup data: refusing to write backup.json")
    }

    const payload = validated.data
    const run = this.writeChain.then(
      () => this.writeAtomic(payload),
      () => this.writeAtomic(payload),
    )
    // Failures must not poison the queue for subsequent saves.
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async writeAtomic(data: TombolaBackupData): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true })
      const json = JSON.stringify(data, null, 2)
      await fs.writeFile(this.tmpFilePath, json, "utf-8")
      await fs.rename(this.tmpFilePath, this.filePath)
    } catch (err) {
      console.error("❌ Critical error writing backup.json:", err)
      throw err
    }
  }

  /**
   * Snapshots the current tombola into `<DATA_DIR>/archive/<YYYY-MM-DD>_<slug>[-n].json`.
   * Returns the created file name.
   */
  async archive(data: TombolaBackupData): Promise<string> {
    const validated = TombolaBackupDataSchema.safeParse(data)
    if (!validated.success) {
      console.error("❌ Refusing to archive invalid tombola data:", validated.error.format())
      throw new Error("Invalid backup data: refusing to archive")
    }

    await fs.mkdir(this.archiveDir, { recursive: true })

    const datePart = new Date().toISOString().slice(0, 10)
    const slug = slugify(validated.data.config.eventTitle) || "tombola"
    const json = JSON.stringify(validated.data, null, 2)

    for (let attempt = 1; attempt <= 100; attempt++) {
      const fileName =
        attempt === 1 ? `${datePart}_${slug}.json` : `${datePart}_${slug}-${attempt}.json`
      try {
        await fs.writeFile(path.join(this.archiveDir, fileName), json, {
          encoding: "utf-8",
          flag: "wx",
        })
        return fileName
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
      }
    }

    throw new Error("Cannot create the archive: too many files sharing the same name")
  }

  async listArchives(): Promise<TombolaArchiveSummary[]> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.archiveDir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
      throw err
    }

    const summaries: TombolaArchiveSummary[] = []

    for (const fileName of entries) {
      if (!ARCHIVE_FILENAME_PATTERN.test(fileName)) continue
      const data = await this.readArchive(fileName)
      if (!data) continue

      const winner = data.draw.winner
      const winningDonation = winner
        ? data.donations.find((donation) => donation.id === winner.donationId)
        : undefined

      summaries.push({
        fileName,
        eventTitle: data.config.eventTitle,
        lotTitle: data.config.lotTitle,
        archivedAt: data.lastUpdated,
        donationCount: data.stats.donationCount,
        totalAmount: data.stats.totalAmount,
        totalTickets: data.stats.totalTickets,
        winnerName: winner?.donorName ?? null,
        winnerStreamlabsDonationId: winningDonation?.streamlabsDonationId ?? null,
        drawnAt: data.draw.drawnAt,
      })
    }

    summaries.sort((a, b) => {
      const diff = Date.parse(b.archivedAt) - Date.parse(a.archivedAt)
      return diff !== 0 ? diff : b.fileName.localeCompare(a.fileName)
    })

    return summaries
  }

  /** Reads one archive. Returns null when missing or unreadable. `fileName` must be pre-validated. */
  async readArchive(fileName: string): Promise<TombolaBackupData | null> {
    if (!ARCHIVE_FILENAME_PATTERN.test(fileName)) return null

    try {
      const content = await fs.readFile(path.join(this.archiveDir, fileName), "utf-8")
      const validated = TombolaBackupDataSchema.safeParse(JSON.parse(content))
      if (!validated.success) {
        console.warn(`⚠️ Archive ${fileName} is not a valid tombola backup, ignored.`)
        return null
      }
      return validated.data
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`⚠️ Failed to read archive ${fileName}:`, err)
      }
      return null
    }
  }
}

export const storage = new StorageService()
