import type React from "react"
import { useEffect, useState } from "react"
import { AdminPage } from "./features/admin/AdminPage.js"
import { OverlayPage } from "./features/overlay/OverlayPage.js"

/**
 * Normalizes a pathname: lowercase, trailing slashes removed.
 * "/Overlay/" and "/overlay" both become "/overlay"; "/" stays "/".
 */
function normalizePath(pathname: string): string {
  const trimmed = pathname.toLowerCase().replace(/\/+$/, "")
  return trimmed === "" ? "/" : trimmed
}

const NotFoundPage: React.FC = () => (
  <div className="min-h-screen bg-neutral-950 text-stone-100 flex items-center justify-center p-4 font-sans">
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 text-center max-w-md shadow-xl">
      <div className="text-4xl mb-3">🎟️</div>
      <h1 className="font-serif font-bold text-xl text-[#eedaa2] mb-2">Page introuvable</h1>
      <p className="text-xs text-stone-400 mb-5">
        Cette adresse ne correspond à aucune page de la tombola.
      </p>
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <a
          href="/admin"
          className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-stone-200 border border-neutral-700 transition"
        >
          Régie Admin
        </a>
        <a
          href="/overlay"
          className="px-4 py-2 rounded-xl bg-gold-500/20 hover:bg-gold-500/30 text-xs font-semibold text-gold-300 border border-gold-500/30 transition"
        >
          Overlay OBS
        </a>
      </div>
    </div>
  </div>
)

export const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState(() => normalizePath(window.location.pathname))

  useEffect(() => {
    const onPopState = () => setCurrentPath(normalizePath(window.location.pathname))
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  if (currentPath === "/overlay") {
    return <OverlayPage />
  }

  if (currentPath === "/admin" || currentPath === "/") {
    return <AdminPage />
  }

  return <NotFoundPage />
}
