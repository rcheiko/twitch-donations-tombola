# Twitch Streamlabs Tombola — Project Context & Developer Guide

Real-time monorepo application for a charity raffle live event (ZEvent-style).
The application collects Streamlabs donations through the real-time Streamlabs Socket API (plus manual admin donations), grants raffle tickets (e.g., 1€ = 1 ticket or custom amount), manages an endsAt-based countdown timer, calculates live statistics (donation count, prize pool, top donor), broadcasts updates in real-time over WebSockets, and provides:
1. A polished **OBS Browser Overlay** (`/overlay`) (dark & gold gala theme, stats, countdown capsule, prize display).
2. A **Streamer Admin Dashboard** (`/admin`) to control the raffle, timer, drawings, and simulations.

---

## Essential Commands

```bash
# Install dependencies
npm install

# Local development (turbo runs api + web concurrently)
npm run dev

# TypeScript typechecking
npm run typecheck

# Linting & formatting (Biome)
npm run lint
npm run lint:fix
npm run format

# Production build
npm run build
npm run build:web
npm run build:api

# Automated tests (unit & integration)
npm test
```

---

## Core Rules & Quality Standards

1. **Security & Strict Validation:**
   - Zod schemas with `.strict()` validation on every incoming payload (WebSockets, admin endpoints, config).
   - Documented exception: the schema validating inbound **Streamlabs Socket API** items is non-strict, because Streamlabs sends additional fields on its events. Every other schema stays `.strict()`.
   - Donations come from exactly two sources: the Streamlabs Socket API (`STREAMLABS_SOCKET_TOKEN`) and the manual donation endpoint of the Admin panel. Both only credit tickets while the countdown is `running`. There is **no** HTTP webhook route.
   - Admin API protected strictly via `x-admin-key` header (`ADMIN_SECRET_KEY`), compared with `crypto.timingSafeEqual`.
   - In production, boot fails if `ADMIN_SECRET_KEY` or `STREAMLABS_SOCKET_TOKEN` is missing or left at its default placeholder value.
   - Input bounds: amount ≤ 1 000 000, donor name ≤ 64 chars, message ≤ 500 chars, `add_time` seconds within ±86400, timer duration between 10 and 86400 seconds.

2. **Data Resilience (Crash-Proof):**
   - Every received donation is immediately persisted into `backup.json` (inside `/app/data`).
   - Atomic disk writes (write to `.tmp` file then POSIX atomic `rename`) preventing file corruption during power cuts or abrupt shutdowns.
   - Automatic state restoration on server boot.
   - Every donation and event is ISO-8601 UTC timestamped (`createdAt: string`).
   - Resetting a non-empty raffle archives the full state into `<DATA_DIR>/archive/<YYYY-MM-DD>_<slug>.json`, listed by `GET /api/admin/archives` and downloadable via `GET /api/admin/archives/:fileName`.
   - Test mode is enabled **only** by `NODE_ENV=test`. A relative `DATA_DIR` is resolved against the directory of the loaded `.env` (or the current working directory without `.env`).

3. **Clean Monorepo Architecture:**
   - `packages/contracts`: Single source of truth for TypeScript types, Zod schemas, and WebSocket event contracts. Zero duplicated types.
   - `packages/api`: Fastify 5 + WebSocket server handling REST endpoints, real-time broadcasts, and optional SPA static assets.
   - `packages/web`: React 19 + Vite + Tailwind CSS application for the OBS Overlay and Streamer Admin panel.
   - `packages/config`: Shared Biome and base tsconfig configurations.

4. **Production Deployment:**
   - **Backend API (CapRover VPS)**: Lightweight Docker multi-stage image (`node:22-alpine`) running on port `3000`, with persistent volume mounted to `/app/data`.
   - **Frontend SPA (Cloudflare Pages)**: Built with `npm run build:web`, globally distributed on Anycast CDN with `VITE_API_URL` pointing to the CapRover backend.

5. **Code Quality & Git Commits:**
   - Strict formatting & linting with Biome (no semicolons when not needed: `"semicolons": "asNeeded"`).
   - Clean, consolidated commit history: each commit on `main` is a verified, fully working state.
