import type { Donation, TombolaState } from "@tombola/contracts"
import confetti from "canvas-confetti"
import type React from "react"
import { useEffect, useMemo } from "react"
import { useCountdown } from "../../hooks/useCountdown.js"

interface OverlayCardProps {
  state: TombolaState
  lastDonation: Donation | null
  serverOffset?: number
}

const TimerCapsule: React.FC<{ timer: TombolaState["timer"]; serverOffset: number }> = ({
  timer,
  serverOffset,
}) => {
  const { formattedTimer } = useCountdown(timer, serverOffset)
  return (
    <div className="my-2 flex justify-center">
      <div className="w-full max-w-[210px] bg-[#0c0c0e] border border-[#262529] rounded-2xl py-3 px-6 text-center shadow-inner">
        <span className="font-sans font-black text-4xl tracking-wider text-[#ecd59d] drop-shadow-[0_2px_10px_rgba(229,177,56,0.25)]">
          {formattedTimer}
        </span>
      </div>
    </div>
  )
}

export const OverlayCard: React.FC<OverlayCardProps> = ({
  state,
  lastDonation,
  serverOffset = 0,
}) => {
  const { config, stats, timer, draw } = state

  // Format currency with french locale spacing (e.g. 8 651 €)
  const formattedTotalAmount = useMemo(() => {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(stats.totalAmount)
  }, [stats.totalAmount])

  // Fire confetti when a winner is drawn. Keyed on drawnAt (a stable string) so
  // that a WebSocket reconnection re-sending the same draw does not re-trigger it.
  const drawnAt = draw.drawnAt
  useEffect(() => {
    if (drawnAt) {
      try {
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 },
          colors: ["#f7e2a9", "#e5b138", "#ffffff"],
        })
      } catch {
        // ignore if canvas not supported
      }
    }
  }, [drawnAt])

  return (
    <div className="relative w-[380px] bg-[#121214] border border-[#2b2a2e] rounded-3xl p-6 shadow-2xl overflow-hidden font-sans text-white">
      {/* Background radial gold glow */}
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-48 bg-gold-500/10 blur-3xl pointer-events-none rounded-full" />

      {/* 1. Header Lot Title */}
      <div className="text-center pt-1 pb-3">
        <h1 className="font-serif font-bold text-lg leading-tight uppercase tracking-wider text-[#eedaa2] drop-shadow-sm px-2">
          {config.lotTitle}
        </h1>
      </div>

      {/* Gold Divider Line */}
      <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-[#876a30] to-transparent my-1" />

      {/* 2. Subtitle Row (Ticket price + optional disclaimer) */}
      <div
        className={`flex items-center text-xs pt-3 pb-4 px-1 ${
          config.lotSubtitle ? "justify-between" : "justify-center"
        }`}
      >
        <div className="font-extrabold text-sm text-white tracking-wide">
          {config.ticketPrice}€ = 1 ticket
        </div>
        {config.lotSubtitle ? (
          <div className="text-stone-400 underline decoration-stone-500 text-[11px]">
            {config.lotSubtitle}
          </div>
        ) : null}
      </div>

      {/* 3. Center Timer Capsule */}
      <TimerCapsule timer={timer} serverOffset={serverOffset} />

      {/* 4. Stats Two Columns */}
      <div className="grid grid-cols-2 gap-4 my-5 text-center px-1">
        {/* Number of donations */}
        <div className="flex flex-col items-center">
          <span className="text-stone-400 text-xs font-medium tracking-tight mb-1">
            Nombre de dons
          </span>
          <span className="font-sans font-extrabold text-3xl tracking-tight text-white">
            {stats.donationCount}
          </span>
        </div>

        {/* Total collected */}
        <div className="flex flex-col items-center">
          <span className="text-stone-400 text-xs font-medium tracking-tight mb-1">
            Somme récoltée
          </span>
          <span className="font-sans font-extrabold text-3xl tracking-tight text-white whitespace-nowrap">
            {formattedTotalAmount}
          </span>
        </div>
      </div>

      {/* 5. Highlight Top Donation */}
      <div className="text-center text-xs pb-5 pt-1">
        <span className="text-stone-400">Plus gros don : </span>
        {stats.topDonation ? (
          <span className="font-bold underline decoration-stone-500 text-stone-200">
            {stats.topDonation.donorName}{" "}
            <span className="text-[#ecd59d] font-extrabold ml-1">{stats.topDonation.amount} €</span>
          </span>
        ) : (
          <span className="text-stone-500 italic">En attente de dons...</span>
        )}
      </div>

      {/* 6. Bottom Gold Banner Button */}
      <div className="w-full">
        <div className="w-full bg-gradient-to-r from-[#d8ab48] via-[#f7e09e] to-[#cf9d3a] hover:opacity-95 transition-all text-[#16130b] font-serif font-black text-base py-3 px-4 rounded-2xl text-center uppercase tracking-wider shadow-lg flex items-center justify-center">
          {config.eventTitle}
        </div>
      </div>

      {/* Winner Overlay Modal (if drawn) */}
      {draw.hasDrawn && draw.winner && (
        <div className="absolute inset-0 bg-black/90 backdrop-blur-md rounded-3xl flex flex-col items-center justify-center p-6 text-center animate-fade-in z-20">
          <div className="text-gold-400 text-3xl mb-2">🏆</div>
          <span className="text-xs uppercase tracking-widest text-gold-400 font-bold mb-1">
            Vainqueur du Tirage
          </span>
          <h2 className="font-serif font-black text-2xl text-white mb-2 max-w-full truncate">
            {draw.winner.donorName}
          </h2>
          <p className="text-xs text-stone-300 mb-4">
            Avec <span className="font-bold text-gold-300">{draw.winner.ticketsCount} tickets</span>{" "}
            ({draw.winner.totalDonated} € donnés)
          </p>
          <div className="text-[11px] text-stone-400 border border-gold-500/30 bg-gold-500/10 rounded-lg px-3 py-1">
            Ticket gagnant : #{draw.winner.winningTicketNumber}
          </div>
        </div>
      )}

      {/* Real-time donation popup pill (subtle toast) */}
      {lastDonation && (
        <div className="absolute top-2 left-2 right-2 bg-gradient-to-r from-[#d8ab48] via-[#f7e09e] to-[#cb9226] text-black text-xs font-bold py-2 px-3 rounded-xl shadow-2xl flex justify-between items-center z-20 border border-gold-300">
          <span className="flex items-center gap-1.5 truncate">
            <span>🎉</span>
            <span className="truncate">Nouveau don : {lastDonation.donorName}</span>
          </span>
          <span className="bg-black/80 text-white px-2 py-0.5 rounded-md text-[11px] font-mono whitespace-nowrap ml-2">
            +{lastDonation.amount} €
          </span>
        </div>
      )}
    </div>
  )
}
