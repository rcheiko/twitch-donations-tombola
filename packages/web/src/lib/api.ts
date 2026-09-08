export function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL
  if (envUrl) {
    return envUrl.replace(/\/+$/, "")
  }
  return ""
}

export function getWsUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL
  const pageIsSecure = window.location.protocol === "https:"

  if (envUrl) {
    const clean = envUrl.trim().replace(/\/+$/, "")
    if (clean.startsWith("https://")) {
      return `wss://${clean.slice("https://".length)}/ws`
    }
    if (clean.startsWith("http://")) {
      return `ws://${clean.slice("http://".length)}/ws`
    }
    if (clean.startsWith("wss://") || clean.startsWith("ws://")) {
      return `${clean}/ws`
    }
    // No scheme provided (e.g. "api.example.com" or "//api.example.com"):
    // align on the page protocol so local http dev setups keep working.
    const host = clean.replace(/^\/+/, "")
    return `${pageIsSecure ? "wss:" : "ws:"}//${host}/ws`
  }

  return `${pageIsSecure ? "wss:" : "ws:"}//${window.location.host}/ws`
}
