import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test, { type TestContext } from "node:test"
import {
  AdminDrawRequestSchema,
  DEFAULT_TOMBOLA_CONFIG,
  DonationSchema,
  ManualDonationSchema,
  remainingSecondsFrom,
  StreamlabsCharityItemSchema,
  slugify,
  type TombolaBackupData,
  TombolaBackupDataSchema,
  TombolaConfigSchema,
  ticketsFor,
} from "@tombola/contracts"
import type { FastifyInstance } from "fastify"
import { buildApp } from "./app.js"
import { config } from "./config.js"
import { ingestCharityDonationItem } from "./modules/donation-ingest.js"
import { StorageService } from "./modules/storage.js"
import { TombolaEngine, tombolaEngine } from "./modules/tombola-engine.js"

const ADMIN_HEADERS = { "x-admin-key": config.ADMIN_SECRET_KEY }

/** Fresh engine + storage on a throwaway directory, cleaned up after the test. */
async function makeEngine(t: TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tombola-unit-"))
  const storage = new StorageService(dir)
  const engine = new TombolaEngine(storage)
  t.after(async () => {
    engine.dispose()
    await fs.rm(dir, { recursive: true, force: true })
  })
  await engine.init()
  return { dir, storage, engine }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor: condition not met in time")
    await new Promise((r) => setTimeout(r, 10))
  }
  // Let the pending persist of the finished state complete.
  await new Promise((r) => setTimeout(r, 50))
}

async function readBackup(dir: string): Promise<TombolaBackupData> {
  const raw = await fs.readFile(path.join(dir, "backup.json"), "utf-8")
  const parsed = TombolaBackupDataSchema.safeParse(JSON.parse(raw))
  assert.equal(parsed.success, true, "backup.json must always stay schema-valid")
  return (parsed as { data: TombolaBackupData }).data
}

function backupData(overrides: Partial<TombolaBackupData> = {}): TombolaBackupData {
  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    config: { ...DEFAULT_TOMBOLA_CONFIG },
    stats: { totalAmount: 0, donationCount: 0, totalTickets: 0, topDonation: null },
    timer: {
      status: "idle",
      remainingSeconds: DEFAULT_TOMBOLA_CONFIG.timerDurationSeconds,
      endsAt: null,
    },
    draw: { hasDrawn: false, winner: null, drawnAt: null },
    donations: [],
    ...overrides,
  }
}

/** Server bound to the singleton engine/storage, with a clean data directory. */
async function makeServer(t: TestContext): Promise<FastifyInstance> {
  // Wipe any leftover state from a previous test before starting from a clean directory
  await tombolaEngine.resetAll()
  await fs.rm(config.DATA_DIR, { recursive: true, force: true })
  const server = await buildApp({ logger: false })
  t.after(async () => {
    await server.close()
    await fs.rm(config.DATA_DIR, { recursive: true, force: true })
  })
  return server
}

/** Starts the countdown through the public API (manual donations require a running tombola). */
async function startTombola(server: FastifyInstance): Promise<void> {
  const res = await server.inject({
    method: "POST",
    url: "/api/admin/timer",
    headers: ADMIN_HEADERS,
    payload: { action: "start" },
  })
  assert.equal(res.statusCode, 200)
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

test("strict schemas reject unknown fields", () => {
  const base = {
    id: "don_1",
    donorName: "Alice",
    amount: 50,
    currency: "EUR",
    ticketsCount: 50,
    message: "Top !",
    createdAt: new Date().toISOString(),
  }

  assert.equal(DonationSchema.safeParse(base).success, true)
  assert.equal(DonationSchema.safeParse({ ...base, hacked: true }).success, false)

  assert.equal(ManualDonationSchema.safeParse({ donorName: "Bob", amount: 5 }).success, true)
  assert.equal(
    ManualDonationSchema.safeParse({ donorName: "Bob", amount: 5, evil: 1 }).success,
    false,
  )

  assert.equal(AdminDrawRequestSchema.safeParse({}).data?.force, false)
  assert.equal(AdminDrawRequestSchema.safeParse({ force: true, extra: 1 }).success, false)

  // Donations are bounded: no giant amount, no oversized name
  assert.equal(DonationSchema.safeParse({ ...base, amount: 5_000_000 }).success, false)
  assert.equal(DonationSchema.safeParse({ ...base, donorName: "x".repeat(65) }).success, false)

  // Streamlabs Charity items stay permissive on purpose (extra fields tolerated)
  const item = StreamlabsCharityItemSchema.safeParse({
    from: "Zoe",
    amount: "12.50",
    isTest: true,
    campaignId: "713449001231458231",
    priority: 10,
  })
  assert.equal(item.success, true)
  assert.equal(item.data?.message, "")
  assert.equal(item.data?.currency, "EUR")

  // The tombola currency is a normalised 3-letter code defaulting to EUR
  assert.equal(TombolaConfigSchema.safeParse({}).data?.currency, "EUR")
  assert.equal(TombolaConfigSchema.safeParse({ currency: " usd " }).data?.currency, "USD")
  assert.equal(TombolaConfigSchema.safeParse({ currency: "EURO" }).success, false)

  // The overlay theme is a closed enum defaulting to rose
  assert.equal(TombolaConfigSchema.safeParse({}).data?.overlayTheme, "rose")
  assert.equal(TombolaConfigSchema.safeParse({ overlayTheme: "gold" }).success, true)
  assert.equal(TombolaConfigSchema.safeParse({ overlayTheme: "turquoise" }).success, false)
})

test("ticketsFor computes in integer cents", () => {
  assert.equal(ticketsFor(0.3, 0.1), 3)
  assert.equal(ticketsFor(10, 1), 10)
  assert.equal(ticketsFor(7.5, 2.5), 3)
  assert.equal(ticketsFor(0.05, 1), 0)
  assert.equal(ticketsFor(-10, 1), 0)
  assert.equal(ticketsFor(Number.NaN, 1), 0)
})

test("remainingSecondsFrom never goes negative", () => {
  assert.equal(remainingSecondsFrom(null), 0)
  assert.equal(remainingSecondsFrom(new Date(Date.now() - 60_000).toISOString()), 0)
  assert.equal(remainingSecondsFrom("not-a-date"), 0)

  const inTen = new Date(Date.now() + 10_000).toISOString()
  assert.ok(remainingSecondsFrom(inTen) > 8 && remainingSecondsFrom(inTen) <= 10)
})

test("slugify produces a filesystem-safe slug", () => {
  assert.equal(slugify("TOMBOLA DES LÉGENDES"), "tombola-des-legendes")
  assert.equal(slugify("  !!! "), "")
  assert.ok(slugify("a".repeat(80)).length <= 40)
})

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

test("save() resolves only once data is on disk, and concurrent saves keep the last state", async (t) => {
  const { dir, storage } = await makeEngine(t)

  const first = backupData({
    stats: { totalAmount: 1, donationCount: 1, totalTickets: 1, topDonation: null },
  })
  await storage.save(first)
  assert.equal((await readBackup(dir)).stats.totalAmount, 1)

  const second = backupData({
    stats: { totalAmount: 2, donationCount: 2, totalTickets: 2, topDonation: null },
  })
  const third = backupData({
    stats: { totalAmount: 3, donationCount: 3, totalTickets: 3, topDonation: null },
  })
  await Promise.all([storage.save(second), storage.save(third)])

  assert.equal((await readBackup(dir)).stats.totalAmount, 3)

  const files = await fs.readdir(dir)
  assert.ok(!files.some((f) => f.endsWith(".tmp")), "no leftover .tmp file")
})

test("save() refuses to write invalid data", async (t) => {
  const { dir, storage } = await makeEngine(t)

  const invalid = { ...backupData(), donations: [{ nope: true }] } as unknown as TombolaBackupData
  await assert.rejects(() => storage.save(invalid))

  const files = await fs.readdir(dir)
  assert.ok(!files.includes("backup.json"), "no invalid backup.json written")
})

test("corrupted backup.json is quarantined and the engine restarts clean", async (t) => {
  const { dir, storage } = await makeEngine(t)
  await storage.init()
  await fs.writeFile(path.join(dir, "backup.json"), "{ this is not json", "utf-8")

  const engine = new TombolaEngine(storage)
  await engine.init()

  const state = engine.getState()
  assert.equal(state.stats.donationCount, 0)
  assert.equal(state.recentDonations.length, 0)

  const files = await fs.readdir(dir)
  assert.ok(
    files.some((f) => f.startsWith("backup.corrupted.")),
    "a backup.corrupted.* copy must be created",
  )
})

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

test("donations are persisted immediately with cent-accurate tickets", async (t) => {
  const { dir, engine } = await makeEngine(t)
  await engine.updateConfig({ ticketPrice: 0.1 })

  const donation = await engine.addDonation({ donorName: "Bob", amount: 0.3 })
  assert.equal(donation.ticketsCount, 3)

  const backup = await readBackup(dir)
  assert.equal(backup.donations.length, 1)
  assert.equal(backup.donations[0]?.ticketsCount, 3)
  assert.equal(backup.stats.totalTickets, 3)
  assert.equal(backup.stats.totalAmount, 0.3)
})

test("state is restored after a reboot, running timer included", async (t) => {
  const { dir, storage, engine } = await makeEngine(t)

  await engine.updateConfig({ timerDurationSeconds: 120 })
  await engine.addDonation({ donorName: "Alice", amount: 25 })
  await engine.startTimer()

  const rebooted = new TombolaEngine(new StorageService(dir))
  await rebooted.init()
  const state = rebooted.getState()

  assert.equal(state.stats.donationCount, 1)
  assert.equal(state.stats.totalAmount, 25)
  assert.equal(state.recentDonations[0]?.donorName, "Alice")
  assert.equal(state.timer.status, "running")
  assert.ok(state.timer.remainingSeconds > 0 && state.timer.remainingSeconds <= 120)

  assert.equal((await storage.load())?.donations.length, 1)
})

test("streamlabsDonationId is deduplicated", async (t) => {
  const { engine } = await makeEngine(t)

  const first = await engine.addDonation({
    donorName: "Zoe",
    amount: 10,
    streamlabsDonationId: "sl-42",
  })
  const replay = await engine.addDonation({
    donorName: "Zoe",
    amount: 10,
    streamlabsDonationId: "sl-42",
  })

  assert.equal(replay.id, first.id)
  const state = engine.getState()
  assert.equal(state.stats.donationCount, 1)
  assert.equal(state.stats.totalAmount, 10)
})

test("blank donor names fall back to Anonyme and stay reloadable", async (t) => {
  const { dir, engine } = await makeEngine(t)

  const donation = await engine.addDonation({ donorName: "   ", amount: 5 })
  assert.equal(donation.donorName, "Anonyme")

  const backup = await readBackup(dir)
  assert.equal(backup.donations[0]?.donorName, "Anonyme")

  const rebooted = new TombolaEngine(new StorageService(dir))
  await rebooted.init()
  assert.equal(rebooted.getState().stats.donationCount, 1)
})

test("a giant donation does not break the draw", async (t) => {
  const { engine } = await makeEngine(t)

  await engine.addDonation({ donorName: "Whale", amount: 1_000_000 })
  const winner = await engine.drawWinner()

  assert.equal(winner?.donorName, "Whale")
  assert.equal(winner?.ticketsCount, 1_000_000)
})

test("draw points to the donation holding the winning ticket and is weighted", async (t) => {
  const { engine } = await makeEngine(t)

  await engine.addDonation({ donorName: "Big", amount: 99 })
  await engine.addDonation({ donorName: "Small", amount: 1 })

  const winner = await engine.drawWinner()
  assert.ok(winner)
  const donationIds = engine.getState().recentDonations.map((d) => d.id)
  assert.ok(donationIds.includes(winner.donationId), "winner.donationId must exist")
  assert.equal(engine.getState().draw.hasDrawn, true)

  let bigWins = 0
  for (let i = 0; i < 200; i++) {
    const result = await engine.drawWinner()
    if (result?.donorName === "Big") bigWins++
  }
  assert.ok(bigWins > 150, `expected the 99-ticket donor to dominate, got ${bigWins}/200`)
})

test("negative add_time is clamped to zero and keeps the backup valid", async (t) => {
  const { dir, engine } = await makeEngine(t)

  await engine.updateConfig({ timerDurationSeconds: 60 })
  await engine.resetTimer()
  await engine.addTimerSeconds(-600)

  assert.equal(engine.getState().timer.remainingSeconds, 0)
  assert.equal((await readBackup(dir)).timer.remainingSeconds, 0)

  await engine.startTimer()
  await engine.addTimerSeconds(-100_000)
  assert.equal(engine.getState().timer.remainingSeconds, 0)
  await waitFor(() => engine.getState().timer.status === "finished")
  const backup = await readBackup(dir)
  assert.equal(backup.timer.status, "finished")
  assert.equal(backup.timer.remainingSeconds, 0)
})

test("a backup written before themes existed reloads on the rose default", async (t) => {
  const { dir, engine } = await makeEngine(t)

  assert.equal(engine.getState().config.overlayTheme, "rose")

  const legacy = backupData()
  const legacyConfig: Record<string, unknown> = { ...legacy.config }
  delete legacyConfig.overlayTheme
  await fs.writeFile(
    path.join(dir, "backup.json"),
    JSON.stringify({ ...legacy, config: legacyConfig }),
  )

  const rebooted = new TombolaEngine(new StorageService(dir))
  t.after(() => rebooted.dispose())
  await rebooted.init()

  assert.equal(rebooted.getState().config.overlayTheme, "rose")
  assert.equal((await rebooted.updateConfig({ overlayTheme: "gold" })).overlayTheme, "gold")
})

test("changing timerDurationSeconds while idle updates remainingSeconds", async (t) => {
  const { dir, engine } = await makeEngine(t)

  assert.equal(engine.getState().timer.status, "idle")
  await engine.updateConfig({ timerDurationSeconds: 1234 })

  assert.equal(engine.getState().timer.remainingSeconds, 1234)
  assert.equal((await readBackup(dir)).timer.remainingSeconds, 1234)
})

test("resetAll archives the previous tombola", async (t) => {
  const { dir, engine, storage } = await makeEngine(t)

  await engine.updateConfig({ eventTitle: "TOMBOLA DES LÉGENDES" })
  await engine.addDonation({ donorName: "Alice", amount: 20 })

  const fileName = await engine.resetAll()
  assert.ok(fileName)
  const today = new Date().toISOString().slice(0, 10)
  assert.equal(fileName, `${today}_tombola-des-legendes.json`)

  const archived = await storage.readArchive(fileName)
  assert.equal(archived?.donations.length, 1)
  assert.equal(engine.getState().stats.donationCount, 0)

  // Nothing to archive on an already empty tombola
  assert.equal(await engine.resetAll(), null)

  // Name collisions get a numeric suffix
  await engine.addDonation({ donorName: "Bob", amount: 5 })
  const second = await engine.resetAll()
  assert.equal(second, `${today}_tombola-des-legendes-2.json`)

  const archives = await new StorageService(dir).listArchives()
  assert.equal(archives.length, 2)
  assert.equal(archives[0]?.eventTitle, "TOMBOLA DES LÉGENDES")
  assert.equal(archives[0]?.donationCount, 1)
})

// ---------------------------------------------------------------------------
// Streamlabs Charity ingestion
// ---------------------------------------------------------------------------

/** Real `streamlabscharitydonation` item as captured on the Streamlabs Socket API. */
function charityItem(overrides: Record<string, unknown> = {}) {
  return {
    charityDonationId: "455768204817176347",
    formattedAmount: "\u20ac25.00",
    formatted_amount: "\u20ac25.00",
    currency: "EUR",
    amount: "25.00",
    message: "Avec amour d\u2019Anvers en Belgique.",
    to: { name: "Durss" },
    memberId: "717456377752197490",
    from: "StormRider",
    id: 24182,
    userId: "717456361696403399",
    campaignId: "713449001231458231",
    createdAt: "2024-09-06 20:29:57",
    custom: [],
    _id: "34af89885d0532f74996f3042ca18fb2",
    priority: 10,
    ...overrides,
  }
}

test("ingestCharityDonationItem only credits while the tombola runs", async (t) => {
  const { engine } = await makeEngine(t)

  const item = charityItem()

  assert.equal(await ingestCharityDonationItem(engine, item), null)
  assert.equal(engine.getState().stats.donationCount, 0)

  await engine.startTimer()
  const donation = await ingestCharityDonationItem(engine, item)
  assert.equal(donation?.donorName, "StormRider")
  assert.equal(donation?.amount, 25)
  assert.equal(donation?.currency, "EUR")
  assert.equal(donation?.message, "Avec amour d\u2019Anvers en Belgique.")
  // Deduplication keys on charityDonationId, never on the per-alert `id` counter
  assert.equal(donation?.streamlabsDonationId, "455768204817176347")

  // Replay of the very same socket event is ignored
  await ingestCharityDonationItem(engine, item)
  assert.equal(engine.getState().stats.donationCount, 1)

  // Two distinct donations that happen to share the same alert `id` both count
  await ingestCharityDonationItem(engine, charityItem({ charityDonationId: "999", amount: "5.00" }))
  assert.equal(engine.getState().stats.donationCount, 2)

  // Invalid or unusable items are ignored without throwing
  assert.equal(await ingestCharityDonationItem(engine, { from: "X" }), null)
  assert.equal(await ingestCharityDonationItem(engine, null), null)
  assert.equal(await ingestCharityDonationItem(engine, { from: "X", amount: "abc" }), null)
  assert.equal(await ingestCharityDonationItem(engine, { from: "X", amount: -5 }), null)
  assert.equal(await ingestCharityDonationItem(engine, { from: "X", amount: 9_999_999 }), null)
  assert.equal(engine.getState().stats.donationCount, 2)

  // Anonymous donations are credited under "Anonyme"
  const anonymous = await ingestCharityDonationItem(engine, {
    amount: 3,
    charityDonationId: "charity-anon",
  })
  assert.equal(anonymous?.donorName, "Anonyme")
})

test("an over-long charity name or message is truncated, never dropped", async (t) => {
  const { engine } = await makeEngine(t)
  await engine.startTimer()

  const donation = await ingestCharityDonationItem(
    engine,
    charityItem({ from: "N".repeat(200), message: "M".repeat(900) }),
  )

  assert.equal(donation?.donorName.length, 64)
  assert.equal(donation?.message.length, 500)
  assert.equal(engine.getState().stats.donationCount, 1)
})

test("charity items fall back to _id and tolerate null free-text fields", async (t) => {
  const { engine } = await makeEngine(t)
  await engine.startTimer()

  const donation = await ingestCharityDonationItem(engine, {
    _id: "34af89885d0532f74996f3042ca18fb2",
    from: null,
    message: null,
    currency: null,
    amount: "10.50",
  })

  assert.equal(donation?.streamlabsDonationId, "34af89885d0532f74996f3042ca18fb2")
  assert.equal(donation?.donorName, "Anonyme")
  assert.equal(donation?.message, "")
  assert.equal(donation?.currency, "EUR")
})

test("a charity donation in another currency is ignored entirely", async (t) => {
  const { engine } = await makeEngine(t)
  await engine.startTimer()

  // 5000 HUF is worth ~12 €: crediting it at face value would hand out 5000 tickets.
  const refused = await ingestCharityDonationItem(
    engine,
    charityItem({ charityDonationId: "huf-1", amount: "5000", currency: "HUF", from: "Cheater" }),
  )

  assert.equal(refused, null)
  const state = engine.getState()
  assert.equal(state.stats.donationCount, 0)
  assert.equal(state.stats.totalTickets, 0)
  assert.equal(state.stats.totalAmount, 0)

  // A lowercase code is the same currency, not a foreign one
  const credited = await ingestCharityDonationItem(
    engine,
    charityItem({ charityDonationId: "eur-1", currency: "eur" }),
  )
  assert.equal(credited?.currency, "EUR")
  assert.equal(engine.getState().stats.donationCount, 1)

  // Switching the tombola currency flips which donations are accepted
  await engine.updateConfig({ currency: "USD" })
  assert.equal(
    await ingestCharityDonationItem(engine, charityItem({ charityDonationId: "eur-2" })),
    null,
  )
  assert.equal(engine.getState().stats.donationCount, 1)
})

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

test("every admin route requires the admin key", async (t) => {
  const server = await makeServer(t)

  const routes: Array<{ method: "GET" | "POST"; url: string }> = [
    { method: "POST", url: "/api/admin/timer" },
    { method: "POST", url: "/api/admin/config" },
    { method: "POST", url: "/api/admin/draw" },
    { method: "POST", url: "/api/admin/reset" },
    { method: "POST", url: "/api/admin/manual-donation" },
    { method: "GET", url: "/api/admin/archives" },
    { method: "GET", url: "/api/admin/archives/whatever.json" },
  ]

  for (const route of routes) {
    const anonymous = await server.inject({ method: route.method, url: route.url, payload: {} })
    assert.equal(anonymous.statusCode, 401, `${route.url} must be protected`)

    const wrongKey = await server.inject({
      method: route.method,
      url: route.url,
      headers: { "x-admin-key": "definitely-not-the-key" },
      payload: {},
    })
    assert.equal(wrongKey.statusCode, 401, `${route.url} must reject a wrong key`)
  }
})

test("health exposes the Streamlabs Charity listener status", async (t) => {
  await fs.rm(config.DATA_DIR, { recursive: true, force: true })
  const server = await buildApp({ logger: false, isStreamlabsConnected: () => true })
  t.after(async () => {
    await server.close()
    await fs.rm(config.DATA_DIR, { recursive: true, force: true })
  })

  const res = await server.inject({ method: "GET", url: "/api/health" })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().streamlabsConnected, true)
})

test("unknown API routes answer JSON 404, never the SPA", async (t) => {
  const server = await makeServer(t)

  const res = await server.inject({ method: "POST", url: "/api/adminn/draw", payload: {} })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error, "Not Found")
})

test("manual donation is refused while the tombola is not running", async (t) => {
  const server = await makeServer(t)

  const refused = await server.inject({
    method: "POST",
    url: "/api/admin/manual-donation",
    headers: ADMIN_HEADERS,
    payload: { donorName: "Alice", amount: 10 },
  })
  assert.equal(refused.statusCode, 409)
  assert.match(refused.json().error, /Lancez la tombola/)
  assert.equal(tombolaEngine.getState().stats.donationCount, 0)

  await startTombola(server)
  const accepted = await server.inject({
    method: "POST",
    url: "/api/admin/manual-donation",
    headers: ADMIN_HEADERS,
    payload: { donorName: "Alice", amount: 10 },
  })
  assert.equal(accepted.statusCode, 200)
  assert.equal(tombolaEngine.getState().stats.donationCount, 1)
})

test("a manual donation must use the tombola currency", async (t) => {
  const server = await makeServer(t)
  await startTombola(server)

  const wrongCurrency = await server.inject({
    method: "POST",
    url: "/api/admin/manual-donation",
    headers: ADMIN_HEADERS,
    payload: { donorName: "Bob", amount: 10, currency: "USD" },
  })
  assert.equal(wrongCurrency.statusCode, 400)

  const implicitCurrency = await server.inject({
    method: "POST",
    url: "/api/admin/manual-donation",
    headers: ADMIN_HEADERS,
    payload: { donorName: "Bob", amount: 10 },
  })
  assert.equal(implicitCurrency.statusCode, 200)
  assert.equal(implicitCurrency.json().donation.currency, "EUR")
})

test("draw refuses a second winner unless forced", async (t) => {
  const server = await makeServer(t)
  await startTombola(server)

  await server.inject({
    method: "POST",
    url: "/api/admin/manual-donation",
    headers: ADMIN_HEADERS,
    payload: { donorName: "Alice", amount: 10 },
  })

  const first = await server.inject({
    method: "POST",
    url: "/api/admin/draw",
    headers: ADMIN_HEADERS,
  })
  assert.equal(first.statusCode, 200)
  assert.ok(first.json().winner.donationId)

  const second = await server.inject({
    method: "POST",
    url: "/api/admin/draw",
    headers: ADMIN_HEADERS,
    payload: {},
  })
  assert.equal(second.statusCode, 409)
  assert.equal(second.json().error, "Un gagnant a déjà été tiré")

  const forced = await server.inject({
    method: "POST",
    url: "/api/admin/draw",
    headers: ADMIN_HEADERS,
    payload: { force: true },
  })
  assert.equal(forced.statusCode, 200)

  const bad = await server.inject({
    method: "POST",
    url: "/api/admin/draw",
    headers: ADMIN_HEADERS,
    payload: { force: "yes" },
  })
  assert.equal(bad.statusCode, 400)
  assert.ok(typeof bad.json().error === "string")
})

test("reset archives the tombola and exposes it through the archives routes", async (t) => {
  const server = await makeServer(t)
  await startTombola(server)

  await server.inject({
    method: "POST",
    url: "/api/admin/manual-donation",
    headers: ADMIN_HEADERS,
    payload: { donorName: "Alice", amount: 12 },
  })

  const reset = await server.inject({
    method: "POST",
    url: "/api/admin/reset",
    headers: ADMIN_HEADERS,
  })
  assert.equal(reset.statusCode, 200)
  const archivedAs: string = reset.json().archivedAs
  assert.match(archivedAs, /^\d{4}-\d{2}-\d{2}_[a-z0-9-]+\.json$/)

  const list = await server.inject({
    method: "GET",
    url: "/api/admin/archives",
    headers: ADMIN_HEADERS,
  })
  assert.equal(list.statusCode, 200)
  const archives = list.json().archives
  assert.equal(archives.length, 1)
  assert.equal(archives[0].fileName, archivedAs)
  assert.equal(archives[0].donationCount, 1)
  assert.equal(archives[0].totalAmount, 12)

  const detail = await server.inject({
    method: "GET",
    url: `/api/admin/archives/${archivedAs}`,
    headers: ADMIN_HEADERS,
  })
  assert.equal(detail.statusCode, 200)
  assert.equal(TombolaBackupDataSchema.safeParse(detail.json()).success, true)

  const traversal = await server.inject({
    method: "GET",
    url: `/api/admin/archives/${encodeURIComponent("../x.json")}`,
    headers: ADMIN_HEADERS,
  })
  assert.equal(traversal.statusCode, 400)

  const missing = await server.inject({
    method: "GET",
    url: "/api/admin/archives/nope.json",
    headers: ADMIN_HEADERS,
  })
  assert.equal(missing.statusCode, 404)
})

test("admin timer and config routes validate their payload", async (t) => {
  const server = await makeServer(t)

  const outOfRange = await server.inject({
    method: "POST",
    url: "/api/admin/timer",
    headers: ADMIN_HEADERS,
    payload: { action: "add_time", seconds: 999_999 },
  })
  assert.equal(outOfRange.statusCode, 400)
  assert.ok(typeof outOfRange.json().error === "string")

  const negative = await server.inject({
    method: "POST",
    url: "/api/admin/timer",
    headers: ADMIN_HEADERS,
    payload: { action: "add_time", seconds: -86_400 },
  })
  assert.equal(negative.statusCode, 200)
  assert.equal(negative.json().state.timer.remainingSeconds, 0)

  const badConfig = await server.inject({
    method: "POST",
    url: "/api/admin/config",
    headers: ADMIN_HEADERS,
    payload: { ticketPrice: 0 },
  })
  assert.equal(badConfig.statusCode, 400)
  assert.equal(badConfig.json().error, "Le prix d'un ticket doit être supérieur à 0 €")

  const okConfig = await server.inject({
    method: "POST",
    url: "/api/admin/config",
    headers: ADMIN_HEADERS,
    payload: { timerDurationSeconds: 300 },
  })
  assert.equal(okConfig.statusCode, 200)
  assert.equal(okConfig.json().config.timerDurationSeconds, 300)

  const state = await server.inject({ method: "GET", url: "/api/state" })
  assert.equal(state.json().timer.remainingSeconds, 300)
})

test("the root endpoint no longer advertises a webhook", async (t) => {
  const server = await makeServer(t)

  const res = await server.inject({ method: "GET", url: "/" })
  const body = res.body
  assert.ok(!body.includes("webhook"), "no webhook endpoint should be advertised")

  const removed = await server.inject({
    method: "POST",
    url: "/api/webhooks/streamlabs",
    payload: { type: "donation", message: [] },
  })
  assert.equal(removed.statusCode, 404)
})
