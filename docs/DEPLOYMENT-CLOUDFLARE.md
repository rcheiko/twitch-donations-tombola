# Cloudflare Pages Deployment Guide (Frontend SPA)

This document details deploying the React web frontend (OBS Overlay & Streamer Admin) to **Cloudflare Pages**, connected to the backend API hosted on your CapRover VPS.

---

## Decoupled Architecture

```
[ Streamlabs Alert / Tip ] ──> [ Streamlabs Socket API ] ──> [ Fastify API (CapRover VPS) ]
                                                                        │
                                                                        ▼ (WebSockets /ws)
[ OBS Studio Browser ]  ──> [ Cloudflare Pages CDN ] ◄──────────────────┘
[ Streamer Admin Panel ] ──> [ Cloudflare Pages CDN ] ◄─────────────────┘
```

- **Frontend (Cloudflare Pages):** Globally distributed over Cloudflare's Anycast CDN, instant load times, zero hosting cost.
- **Backend (CapRover VPS):** Captures Streamlabs donations in real-time, calculates raffle tickets, handles atomic disk persistence (`backup.json`), and broadcasts state via WebSockets.

---

## 1. Create the Project on Cloudflare Pages

1. Navigate to your **Cloudflare Dashboard** > **Workers & Pages**.
2. Click **Create Application** > **Pages** tab > **Connect to Git**.
3. Select your repository: `XXX/twitch-donations-tombola`.
4. Click **Begin setup**.

---

## 2. Configure Build Settings

Fill in the build configuration:

| Setting | Value | Explanation |
|---|---|---|
| **Project name** | `tombola-twitch` | Project name (generates `tombola-twitch.pages.dev`) |
| **Production branch** | `main` | Primary production branch |
| **Framework preset** | `None` or `Vite` | Framework build preset |
| **Root directory** | `/` | Monorepo root directory |
| **Build command** | `npm run build:web` | Builds `@tombola/contracts` and `@tombola/web` via Turborepo |
| **Build output directory** | `packages/web/dist` | Directory containing compiled static assets |

---

## 3. Set Environment Variable `VITE_API_URL`

Under **Environment variables (advanced)**:
- Click **Add variable**:
  - **Variable name:** `VITE_API_URL`
  - **Value:** The HTTPS URL of your CapRover API (e.g. `https://api-tombola.yourdomain.com`)

> ⚠️ **Important:** Do NOT include a trailing slash `/`. The frontend automatically derives the secure WebSocket URL (`wss://api-tombola.yourdomain.com/ws`).

---

## 4. Trigger Deployment

1. Click **Save and Deploy**.
2. Cloudflare Pages will:
   - Detect `.nvmrc` and use Node 22.
   - Install dependencies (`npm ci`).
   - Run `npm run build:web`.
   - Publish static assets and apply the SPA redirect rule from [`packages/web/public/_redirects`](../packages/web/public/_redirects).
3. Within ~1 minute, your site will be live at `https://tombola-twitch.pages.dev`!

---

## 5. Final Access URLs

Once deployed:

- **OBS Overlay:** `https://tombola-twitch.pages.dev/overlay`
  - Add as a **Browser Source** in OBS Studio (width `450`, height `650`).
- **Streamer Admin:** `https://tombola-twitch.pages.dev/admin`
  - Dashboard to manage timers, adjust prize details, and execute drawings.

