import type React from "react"
import { useTombolaSocket } from "../../hooks/useTombolaSocket.js"
import { OverlayCard } from "./OverlayCard.js"

export const OverlayPage: React.FC = () => {
  const { state, isConnected, lastDonation, serverOffset } = useTombolaSocket()

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-[#121214] border border-[#2b2a2e] rounded-2xl p-6 text-center text-stone-400">
          <div className="animate-spin w-8 h-8 border-2 border-accent-base border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-sm font-medium">Connexion à la tombola...</p>
          {!isConnected && (
            <span className="text-[11px] text-amber-500 block mt-1">
              Tentative de connexion au serveur WebSocket...
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-transparent p-4">
      <OverlayCard state={state} lastDonation={lastDonation} serverOffset={serverOffset} />
    </div>
  )
}
