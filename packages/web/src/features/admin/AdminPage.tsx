import {
  OVERLAY_THEMES,
  type OverlayTheme,
  type TombolaArchiveSummary,
  type TombolaTimer,
} from "@tombola/contracts"
import {
  Archive,
  Coins,
  Download,
  Eye,
  Gift,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trophy,
  X,
} from "lucide-react"
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useCountdown } from "../../hooks/useCountdown.js"
import { useTombolaSocket } from "../../hooks/useTombolaSocket.js"
import { getApiBaseUrl } from "../../lib/api.js"
import { formatAmount } from "../../lib/format.js"

type AdminApiResult = {
  ok: boolean
  status: number
  data: Record<string, unknown>
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = (await res.json()) as unknown
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function errorMessage(data: Record<string, unknown>): string {
  return typeof data.error === "string" && data.error ? data.error : "Action refusée"
}

/** Human labels for OVERLAY_THEMES; adding a theme to the contract fails to compile until listed here. */
const OVERLAY_THEME_LABELS: Record<OverlayTheme, string> = {
  rose: "Rose",
  gold: "Or",
}

function formatArchiveDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("fr-FR")
}

const AdminTimerDisplay: React.FC<{
  timer: TombolaTimer | undefined
  serverOffset: number
}> = ({ timer, serverOffset }) => {
  const { formattedTimer } = useCountdown(timer, serverOffset)
  return <div className="text-2xl font-black font-mono text-gold-300">{formattedTimer}</div>
}

export const AdminPage: React.FC = () => {
  const { state, isConnected, serverOffset } = useTombolaSocket()

  const [adminKey, setAdminKey] = useState(() => localStorage.getItem("tombola_admin_key") || "")
  const [testDonor, setTestDonor] = useState("Shokker")
  const [testAmount, setTestAmount] = useState(50)
  const [testMessage, setTestMessage] = useState("Congrats !")
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState("")
  const [drawConflict, setDrawConflict] = useState<string | null>(null)

  // Editable configuration fields
  const [editLotTitle, setEditLotTitle] = useState("")
  const [editLotSubtitle, setEditLotSubtitle] = useState("")
  const [editEventTitle, setEditEventTitle] = useState("")
  const [editTicketPrice, setEditTicketPrice] = useState(1)
  const [editCurrency, setEditCurrency] = useState("EUR")
  const [editTimerDuration, setEditTimerDuration] = useState(900)
  const [editOverlayTheme, setEditOverlayTheme] = useState<OverlayTheme>("rose")
  const [isConfigDirty, setIsConfigDirty] = useState(false)
  const isConfigDirtyRef = useRef(false)
  const appliedConfigRef = useRef<string | null>(null)

  // Archives
  const [archives, setArchives] = useState<TombolaArchiveSummary[]>([])
  const [archivesError, setArchivesError] = useState("")
  const [isArchivesLoading, setIsArchivesLoading] = useState(false)
  const [archivePreview, setArchivePreview] = useState<{ fileName: string; json: string } | null>(
    null,
  )

  const markConfigDirty = () => {
    isConfigDirtyRef.current = true
    setIsConfigDirty(true)
  }

  const clearConfigDirty = () => {
    isConfigDirtyRef.current = false
    setIsConfigDirty(false)
  }

  const config = state?.config

  // Sync the edit form only when the config VALUES actually change (a websocket
  // reconnection re-sends an equal-but-new object, which must not wipe the form),
  // and never while the streamer has unsaved modifications.
  useEffect(() => {
    if (!config) return
    const signature = JSON.stringify([
      config.lotTitle,
      config.lotSubtitle,
      config.eventTitle,
      config.ticketPrice,
      config.currency,
      config.timerDurationSeconds,
      config.overlayTheme,
    ])
    if (signature === appliedConfigRef.current) return
    appliedConfigRef.current = signature
    if (isConfigDirtyRef.current) return

    setEditLotTitle(config.lotTitle)
    setEditLotSubtitle(config.lotSubtitle)
    setEditEventTitle(config.eventTitle)
    setEditTicketPrice(config.ticketPrice)
    setEditCurrency(config.currency)
    setEditTimerDuration(config.timerDurationSeconds)
    setEditOverlayTheme(config.overlayTheme)
  }, [config])

  const saveAdminKey = (key: string) => {
    setAdminKey(key)
    localStorage.setItem("tombola_admin_key", key)
  }

  const callAdminApi = async (endpoint: string, body: unknown): Promise<AdminApiResult> => {
    setIsActionLoading(true)
    setStatusMsg("")
    try {
      const baseUrl = getApiBaseUrl()
      const res = await fetch(`${baseUrl}/api/admin/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": adminKey,
        },
        body: JSON.stringify(body),
      })

      const data = await readJson(res)
      if (!res.ok) {
        setStatusMsg(`❌ Erreur: ${errorMessage(data)}`)
      } else {
        setStatusMsg("✅ Action exécutée avec succès")
      }
      return { ok: res.ok, status: res.status, data }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue"
      setStatusMsg(`❌ Erreur réseau: ${msg}`)
      return { ok: false, status: 0, data: {} }
    } finally {
      setIsActionLoading(false)
    }
  }

  const loadArchives = useCallback(async () => {
    if (!adminKey) {
      setArchives([])
      setArchivesError("Renseignez la clé admin pour consulter les archives.")
      return
    }
    setIsArchivesLoading(true)
    setArchivesError("")
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/admin/archives`, {
        headers: { "X-Admin-Key": adminKey },
      })
      const data = await readJson(res)
      if (!res.ok) {
        setArchives([])
        setArchivesError(errorMessage(data))
        return
      }
      setArchives(Array.isArray(data.archives) ? (data.archives as TombolaArchiveSummary[]) : [])
    } catch (err: unknown) {
      setArchives([])
      setArchivesError(err instanceof Error ? err.message : "Erreur réseau")
    } finally {
      setIsArchivesLoading(false)
    }
  }, [adminKey])

  // Debounced so typing the admin key does not fire one request per keystroke
  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadArchives()
    }, 400)
    return () => clearTimeout(timeout)
  }, [loadArchives])

  const handleViewArchive = async (fileName: string) => {
    setArchivesError("")
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/admin/archives/${encodeURIComponent(fileName)}`,
        { headers: { "X-Admin-Key": adminKey } },
      )
      const data = await readJson(res)
      if (!res.ok) {
        setArchivesError(errorMessage(data))
        return
      }
      setArchivePreview({ fileName, json: JSON.stringify(data, null, 2) })
    } catch (err: unknown) {
      setArchivesError(err instanceof Error ? err.message : "Erreur réseau")
    }
  }

  const handleDownloadArchive = () => {
    if (!archivePreview) return
    const url = URL.createObjectURL(new Blob([archivePreview.json], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = archivePreview.fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleTimerAction = (
    action: "start" | "pause" | "reset" | "add_time",
    seconds?: number,
  ) => {
    void callAdminApi("timer", { action, seconds })
  }

  const runDraw = async (force: boolean) => {
    setDrawConflict(null)
    const result = await callAdminApi("draw", force ? { force: true } : {})
    if (!result.ok && result.status === 409) {
      setDrawConflict(errorMessage(result.data))
    }
  }

  const handleDrawWinner = () => {
    if (window.confirm("Êtes-vous sûr de vouloir tirer au sort le vainqueur maintenant ?")) {
      void runDraw(false)
    }
  }

  const handleForceDraw = () => {
    if (
      window.confirm(
        "⚠️ Un gagnant a déjà été tiré. Retirer quand même un nouveau vainqueur (l'ancien sera remplacé) ?",
      )
    ) {
      void runDraw(true)
    }
  }

  const handleResetAll = async () => {
    if (
      !window.confirm(
        "⚠️ ATTENTION : Cela va réinitialiser toute la tombola et les stats. Continuer ?",
      )
    ) {
      return
    }
    const result = await callAdminApi("reset", {})
    if (!result.ok) return

    setDrawConflict(null)
    const archivedAs = typeof result.data.archivedAs === "string" ? result.data.archivedAs : null
    setStatusMsg(
      archivedAs
        ? `✅ Tombola réinitialisée — état archivé dans ${archivedAs}`
        : "✅ Tombola réinitialisée (rien à archiver)",
    )
    void loadArchives()
  }

  const isTombolaRunning = state?.timer.status === "running"

  const handleSendTestDonation = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isTombolaRunning) {
      setStatusMsg("❌ Lancez la tombola avant d'envoyer un don test")
      return
    }
    void callAdminApi("manual-donation", {
      donorName: testDonor,
      amount: Number(testAmount),
      currency: "EUR",
      message: testMessage,
    })
  }

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    if (editTicketPrice <= 0) {
      setStatusMsg("❌ Erreur: Le prix d'un ticket doit être supérieur à 0")
      return
    }
    const result = await callAdminApi("config", {
      lotTitle: editLotTitle,
      lotSubtitle: editLotSubtitle,
      eventTitle: editEventTitle,
      ticketPrice: Number(editTicketPrice),
      currency: editCurrency,
      timerDurationSeconds: Number(editTimerDuration),
      overlayTheme: editOverlayTheme,
    })
    if (result.ok) {
      clearConfigDirty()
    }
  }

  if (!state) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center p-4">
        <div className="text-center">
          <RefreshCw className="animate-spin w-8 h-8 text-gold-400 mx-auto mb-2" />
          <p>Chargement des données de régie...</p>
        </div>
      </div>
    )
  }

  const timerMinutes = Math.floor(editTimerDuration / 60)
  const timerSecondsRem = editTimerDuration % 60
  const durationLabel = `${timerMinutes} min${timerSecondsRem > 0 ? ` ${timerSecondsRem}s` : ""}`
  const preview10EuroTickets = editTicketPrice > 0 ? Math.floor(10 / editTicketPrice) : 0

  return (
    <div className="min-h-screen bg-neutral-950 text-stone-100 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-neutral-900 border border-neutral-800 rounded-2xl p-4 md:p-6 shadow-xl">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold font-serif text-[#eedaa2]">
                Régie Tombola — Streamlabs Charity
              </h1>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  isConnected
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                }`}
              >
                {isConnected ? "● Connecté" : "○ Déconnecté"}
              </span>
            </div>
            <p className="text-xs text-stone-400 mt-1">
              Contrôlez le lot, le timer, déclenchez les tirages et suivez les dons Streamlabs
              Charity en direct.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/overlay"
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-stone-200 border border-neutral-700 transition"
            >
              Ouvrir l'Overlay OBS ↗
            </a>
          </div>
        </div>

        {/* Admin key input & status feedback */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 w-full md:w-auto">
            <span className="text-xs font-medium text-stone-400 whitespace-nowrap">
              Clé Admin (du .env) :
            </span>
            <input
              type="password"
              value={adminKey}
              onChange={(e) => saveAdminKey(e.target.value)}
              placeholder="Ex: 123456"
              className="bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-1 text-xs text-stone-200 focus:outline-none focus:border-gold-500 w-full md:w-64 font-mono"
            />
          </div>
          {statusMsg && (
            <div
              className={`text-xs font-bold px-3 py-1.5 rounded-lg ${
                statusMsg.startsWith("❌")
                  ? "bg-rose-950/60 text-rose-300 border border-rose-800/50"
                  : "bg-emerald-950/60 text-emerald-300 border border-emerald-800/50"
              }`}
            >
              {statusMsg}
            </div>
          )}
        </div>

        {/* Full-width Quick Stats overview */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 text-center shadow-md">
            <span className="text-xs text-stone-400 block mb-1">Total Récolté</span>
            <span className="text-2xl md:text-3xl font-black text-white">
              {formatAmount(state.stats.totalAmount, state.config.currency)}
            </span>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 text-center shadow-md">
            <span className="text-xs text-stone-400 block mb-1">Nombre de dons</span>
            <span className="text-2xl md:text-3xl font-black text-white">
              {state.stats.donationCount}
            </span>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 text-center shadow-md">
            <span className="text-xs text-stone-400 block mb-1">Tickets Totaux</span>
            <span className="text-2xl md:text-3xl font-black text-gold-400 font-serif">
              {state.stats.totalTickets}
            </span>
          </div>
        </div>

        {/* Main 2-column grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 cols: Main Stage & Controls */}
          <div className="lg:col-span-2 space-y-6">
            {/* HERO CARD: Configuration du Lot & Affichage */}
            <div className="relative overflow-hidden bg-gradient-to-br from-neutral-900 via-neutral-900 to-amber-950/25 border-2 border-gold-500/40 rounded-2xl p-6 shadow-gold-glow space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-gold-500/10 border border-gold-500/30 text-gold-400">
                    <Gift className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                      Configuration du Lot & Affichage OBS
                    </h2>
                    <p className="text-xs text-stone-400">
                      Définissez le lot en jeu, le barème des tickets et les textes diffusés sur le
                      live.
                    </p>
                  </div>
                </div>

                <div className="self-start sm:self-auto flex items-center gap-2">
                  {isConfigDirty && (
                    <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold">
                      Modifications non enregistrées
                    </span>
                  )}
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gold-500/10 border border-gold-500/30 text-gold-300 text-xs font-semibold">
                    <Sparkles className="w-3.5 h-3.5 text-gold-400" />
                    <span>1 ticket = {formatAmount(editTicketPrice, editCurrency, 2)}</span>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSaveConfig} className="space-y-4 pt-1">
                {/* Lot Title (Hero input) */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="lot-title"
                    className="text-xs font-bold uppercase tracking-wider text-gold-400/90 block"
                  >
                    Intitulé du lot principal (affiché en grand sur l'overlay)
                  </label>
                  <input
                    id="lot-title"
                    type="text"
                    value={editLotTitle}
                    onChange={(e) => {
                      setEditLotTitle(e.target.value)
                      markConfigDirty()
                    }}
                    placeholder="Ex: Maillot Dédicacé Toulouse FC"
                    className="w-full bg-neutral-950 border border-gold-500/40 rounded-xl px-4 py-3 text-base sm:text-lg text-gold-200 font-serif font-bold tracking-wide focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400 placeholder:text-stone-600 transition"
                    required
                  />
                </div>

                {/* Subtitle & Event Title in 2 columns */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label
                      htmlFor="lot-subtitle"
                      className="text-xs text-stone-300 font-medium block"
                    >
                      Mention légale / Sous-titre
                    </label>
                    <input
                      id="lot-subtitle"
                      type="text"
                      placeholder="Ex: Valable 1 an, tirage au sort certifié"
                      value={editLotSubtitle}
                      onChange={(e) => {
                        setEditLotSubtitle(e.target.value)
                        markConfigDirty()
                      }}
                      className="w-full bg-neutral-950 border border-neutral-700 rounded-xl px-3.5 py-2 text-xs text-stone-200 focus:outline-none focus:border-gold-500 placeholder:text-stone-600 transition"
                    />
                  </div>

                  <div className="space-y-1">
                    <label
                      htmlFor="event-title"
                      className="text-xs text-stone-300 font-medium block"
                    >
                      Titre du bandeau inférieur (Overlay)
                    </label>
                    <input
                      id="event-title"
                      type="text"
                      value={editEventTitle}
                      onChange={(e) => {
                        setEditEventTitle(e.target.value)
                        markConfigDirty()
                      }}
                      placeholder="Ex: ÉVÉNEMENT CARITATIF — TOULOUSE"
                      className="w-full bg-neutral-950 border border-neutral-700 rounded-xl px-3.5 py-2 text-xs text-stone-200 focus:outline-none focus:border-gold-500 placeholder:text-stone-600 transition"
                    />
                  </div>
                </div>

                {/* Overlay accent theme */}
                <fieldset className="min-w-0 space-y-1.5">
                  <legend className="text-xs text-stone-300 font-medium mb-1.5">
                    Thème de l'overlay
                  </legend>
                  <div className="grid grid-cols-2 gap-2">
                    {OVERLAY_THEMES.map((theme) => (
                      <button
                        key={theme}
                        type="button"
                        aria-pressed={editOverlayTheme === theme}
                        onClick={() => {
                          setEditOverlayTheme(theme)
                          markConfigDirty()
                        }}
                        className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                          editOverlayTheme === theme
                            ? "border-gold-500/60 bg-gold-500/10 text-stone-100"
                            : "border-neutral-700 bg-neutral-950 text-stone-400 hover:border-neutral-600"
                        }`}
                      >
                        {/* The swatch reads that theme's own CSS variables, so it never drifts */}
                        <span
                          data-overlay-theme={theme}
                          className="h-4 w-9 rounded-full bg-gradient-to-r from-accent-deep via-accent-bright to-accent-edge"
                        />
                        {OVERLAY_THEME_LABELS[theme]}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {/* Ticket Price & Duration in 2 columns with live helper tags */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label htmlFor="ticket-price" className="text-xs text-stone-300 font-medium">
                        Prix du ticket & devise
                      </label>
                      <span className="text-[11px] text-stone-500">
                        Don de {formatAmount(10, editCurrency)} = {preview10EuroTickets} tickets
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        id="ticket-price"
                        type="number"
                        value={editTicketPrice}
                        onChange={(e) => {
                          setEditTicketPrice(Number(e.target.value))
                          markConfigDirty()
                        }}
                        className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-gold-500 transition"
                        min="0.01"
                        step="any"
                        required
                      />
                      <input
                        aria-label="Devise de la tombola (code ISO)"
                        type="text"
                        value={editCurrency}
                        onChange={(e) => {
                          setEditCurrency(e.target.value.toUpperCase().slice(0, 3))
                          markConfigDirty()
                        }}
                        className="w-16 shrink-0 bg-neutral-950 border border-neutral-700 rounded-xl px-2 py-2 text-xs text-center text-white uppercase focus:outline-none focus:border-gold-500 transition"
                        maxLength={3}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="timer-duration"
                        className="text-xs text-stone-300 font-medium"
                      >
                        Durée initiale du timer (sec)
                      </label>
                      <span className="text-[11px] text-stone-500">{durationLabel}</span>
                    </div>
                    <input
                      id="timer-duration"
                      type="number"
                      value={editTimerDuration}
                      onChange={(e) => {
                        setEditTimerDuration(Number(e.target.value))
                        markConfigDirty()
                      }}
                      className="w-full bg-neutral-950 border border-neutral-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-gold-500 transition"
                      min="10"
                      required
                    />
                  </div>
                </div>

                {/* Submit Save button */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isActionLoading}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-gold-500 via-amber-500 to-gold-600 text-black font-extrabold text-xs sm:text-sm shadow-md hover:brightness-110 active:scale-[0.99] disabled:opacity-50 transition"
                  >
                    <Save className="w-4 h-4" /> Enregistrer & Diffuser sur l'Overlay OBS ⚡
                  </button>
                </div>
              </form>
            </div>

            {/* Timer Management */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-stone-200 flex items-center gap-2">
                  <span>⏱️ Compte à Rebours</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full uppercase font-mono ${
                      state.timer.status === "running"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-neutral-800 text-stone-400"
                    }`}
                  >
                    {state.timer.status}
                  </span>
                </h2>
                <AdminTimerDisplay timer={state.timer} serverOffset={serverOffset} />
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                {state.timer.status === "running" ? (
                  <button
                    type="button"
                    onClick={() => handleTimerAction("pause")}
                    disabled={isActionLoading}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600/20 text-amber-300 border border-amber-500/30 hover:bg-amber-600/30 text-xs font-bold transition"
                  >
                    <Pause className="w-3.5 h-3.5" /> Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleTimerAction("start")}
                    disabled={isActionLoading}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 text-xs font-bold transition"
                  >
                    <Play className="w-3.5 h-3.5" /> Lancer
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleTimerAction("reset")}
                  disabled={isActionLoading}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-neutral-800 text-stone-300 hover:bg-neutral-700 text-xs font-semibold transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reset
                </button>

                <button
                  type="button"
                  onClick={() => handleTimerAction("add_time", 60)}
                  disabled={isActionLoading}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl bg-neutral-800 text-stone-300 hover:bg-neutral-700 text-xs font-semibold transition"
                >
                  <Plus className="w-3 h-3" /> 1 min
                </button>

                <button
                  type="button"
                  onClick={() => handleTimerAction("add_time", 300)}
                  disabled={isActionLoading}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl bg-neutral-800 text-stone-300 hover:bg-neutral-700 text-xs font-semibold transition"
                >
                  <Plus className="w-3 h-3" /> 5 min
                </button>
              </div>
            </div>

            {/* Winner Draw & Lot Information */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-stone-200 flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-gold-400" /> Tirage au Sort du Lot
                </h2>
                <button
                  type="button"
                  onClick={handleDrawWinner}
                  disabled={isActionLoading || state.stats.totalTickets === 0}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-gold-500 to-amber-500 text-black font-extrabold text-xs shadow-md hover:opacity-90 disabled:opacity-50 transition"
                >
                  Tirer un Vainqueur Aléatoire 🎲
                </button>
              </div>

              {drawConflict && (
                <div className="bg-rose-950/30 border border-rose-800/50 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <p className="text-xs text-rose-300 font-semibold">{drawConflict}</p>
                  <button
                    type="button"
                    onClick={handleForceDraw}
                    disabled={isActionLoading}
                    className="px-3 py-1.5 rounded-lg bg-rose-600/20 text-rose-200 border border-rose-500/40 hover:bg-rose-600/30 text-xs font-bold disabled:opacity-50 transition whitespace-nowrap"
                  >
                    Retirer quand même
                  </button>
                </div>
              )}

              {state.draw.hasDrawn && state.draw.winner ? (
                <div className="bg-gold-500/10 border border-gold-500/30 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] uppercase tracking-wider text-gold-400 font-bold block">
                      Gagnant tiré au sort
                    </span>
                    <span className="text-lg font-bold text-white">
                      {state.draw.winner.donorName}
                    </span>
                    <p className="text-xs text-stone-400">
                      {state.draw.winner.ticketsCount} tickets (
                      {formatAmount(state.draw.winner.totalDonated, state.config.currency, 2)}) —
                      Ticket #{state.draw.winner.winningTicketNumber}
                    </p>
                  </div>
                  <div className="text-2xl">🏆</div>
                </div>
              ) : (
                <p className="text-xs text-stone-500 italic">
                  Aucun vainqueur tiré pour le moment.
                </p>
              )}
            </div>
          </div>

          {/* Right col: Simulator, Recent Donations & Danger Zone */}
          <div className="space-y-6">
            {/* Manual donation: rehearsal tests AND re-entering a refused donation */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-stone-300 flex items-center gap-1.5">
                <Coins className="w-4 h-4 text-amber-400" /> Don manuel
              </h3>
              <p className="text-[11px] text-stone-400">
                Pour tester l'overlay, ou injecter un don reçu par un autre biais.
              </p>

              <form onSubmit={handleSendTestDonation} className="space-y-2.5 pt-1">
                <input
                  type="text"
                  placeholder="Nom donateur"
                  value={testDonor}
                  onChange={(e) => setTestDonor(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-gold-500"
                  required
                />
                <input
                  type="number"
                  placeholder={`Montant (${state.config.currency})`}
                  value={testAmount}
                  onChange={(e) => setTestAmount(Number(e.target.value))}
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-gold-500"
                  min="0.01"
                  step="any"
                  required
                />
                <input
                  type="text"
                  placeholder="Message (optionnel)"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-gold-500"
                />
                {!isTombolaRunning && (
                  <p className="text-[11px] text-amber-500/90">
                    Lancez la tombola pour pouvoir envoyer un don (même règle que Streamlabs
                    Charity).
                  </p>
                )}
                <button
                  type="submit"
                  disabled={isActionLoading || !isTombolaRunning}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-gold-500/20 text-gold-300 border border-gold-500/30 hover:bg-gold-500/30 text-xs font-bold transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" /> Envoyer le don
                </button>
              </form>
            </div>

            {/* Recent Donations Feed */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
                  Derniers Dons Reçus
                </h3>
                <span className="text-[11px] text-stone-500">
                  {state.recentDonations.length} affichés
                </span>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {state.recentDonations.length === 0 ? (
                  <p className="text-xs text-stone-500 italic py-2">En attente de dons...</p>
                ) : (
                  state.recentDonations.map((don) => (
                    <div
                      key={don.id}
                      className="bg-neutral-950/80 border border-neutral-800/80 rounded-xl p-2.5 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-bold text-white block">{don.donorName}</span>
                        {don.message && (
                          <p className="text-stone-400 text-[11px] truncate max-w-[160px]">
                            {don.message}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="font-extrabold text-gold-400">
                          {formatAmount(don.amount, don.currency, 2)}
                        </span>
                        <span className="text-[10px] text-stone-500 block">
                          {don.ticketsCount} tickets
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Archives des tombolas précédentes */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-300 flex items-center gap-1.5">
                  <Archive className="w-4 h-4 text-gold-400" /> Archives
                </h3>
                <button
                  type="button"
                  onClick={() => void loadArchives()}
                  disabled={isArchivesLoading}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-[11px] font-semibold text-stone-300 disabled:opacity-50 transition"
                >
                  <RefreshCw className={`w-3 h-3 ${isArchivesLoading ? "animate-spin" : ""}`} />
                  Rafraîchir
                </button>
              </div>
              <p className="text-[11px] text-stone-400">
                Chaque réinitialisation archive automatiquement la tombola en cours.
              </p>

              {archivesError && (
                <p className="text-[11px] text-rose-300 bg-rose-950/30 border border-rose-800/40 rounded-lg px-2.5 py-1.5">
                  {archivesError}
                </p>
              )}

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {archives.length === 0 && !archivesError ? (
                  <p className="text-xs text-stone-500 italic py-2">
                    {isArchivesLoading
                      ? "Chargement des archives..."
                      : "Aucune archive pour l'instant."}
                  </p>
                ) : (
                  archives.map((archive) => (
                    <div
                      key={archive.fileName}
                      className="bg-neutral-950/80 border border-neutral-800/80 rounded-xl p-2.5 space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-bold text-white text-xs block truncate">
                            {archive.lotTitle}
                          </span>
                          <span className="text-[11px] text-stone-400 block truncate">
                            {archive.eventTitle}
                          </span>
                          <span className="text-[10px] text-stone-500 block">
                            {formatArchiveDate(archive.archivedAt)}
                          </span>
                        </div>
                        <div className="text-right whitespace-nowrap">
                          <span className="font-extrabold text-gold-400 text-xs block">
                            {archive.totalAmount} €
                          </span>
                          <span className="text-[10px] text-stone-500 block">
                            {archive.donationCount} dons · {archive.totalTickets} tickets
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-stone-400 truncate">
                          {archive.winnerName ? (
                            <>
                              🏆{" "}
                              <span className="text-gold-300 font-semibold">
                                {archive.winnerName}
                              </span>
                            </>
                          ) : (
                            <span className="italic text-stone-500">Aucun tirage</span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleViewArchive(archive.fileName)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-[11px] font-semibold text-stone-300 transition whitespace-nowrap"
                        >
                          <Eye className="w-3 h-3" /> Voir le JSON
                        </button>
                      </div>

                      {/* Full width and wrapping: the id must stay readable without opening the JSON. */}
                      {archive.winnerName && (
                        <div className="rounded-lg bg-neutral-900/70 px-2 py-1">
                          <span className="block text-[9px] uppercase tracking-wider text-stone-500 font-semibold">
                            Id Streamlabs du don gagnant
                          </span>
                          {archive.winnerStreamlabsDonationId ? (
                            <span className="block font-mono text-[10px] text-stone-300 break-all select-all">
                              {archive.winnerStreamlabsDonationId}
                            </span>
                          ) : (
                            <span className="block text-[10px] italic text-stone-500">
                              Don manuel — aucun id Streamlabs
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Danger Zone: Reset */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleResetAll}
                disabled={isActionLoading}
                className="w-full py-2.5 rounded-xl border border-rose-900/40 bg-rose-950/20 text-rose-400 hover:bg-rose-950/40 text-xs font-bold transition"
              >
                Réinitialiser la tombola à zéro
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Archive JSON preview */}
      {archivePreview && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between gap-3 p-4 border-b border-neutral-800">
              <h3 className="text-xs font-bold text-gold-300 font-mono truncate">
                {archivePreview.fileName}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadArchive}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-[11px] font-semibold text-stone-300 transition"
                >
                  <Download className="w-3 h-3" /> Télécharger
                </button>
                <button
                  type="button"
                  onClick={() => setArchivePreview(null)}
                  aria-label="Fermer"
                  className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-stone-300 transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <pre className="overflow-auto p-4 text-[11px] leading-relaxed text-stone-300 font-mono">
              {archivePreview.json}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
