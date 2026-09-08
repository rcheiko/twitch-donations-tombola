# 🎟️ Twitch & Streamlabs Charity Live Tombola (Charity Raffle)

A complete real-time monorepo application to organize **charity raffles during Twitch livestreams**, natively connected to the **Streamlabs Real-Time Socket API** and driven by **Streamlabs Charity** donations.

It provides an **OBS Browser Overlay** and a **Streamer Admin Dashboard** to manage the live show.

---

## ✨ Key Features

- ⚡ **Ultra-Fast Real-Time (WebSockets):** As soon as a donation occurs on Streamlabs Charity, the OBS overlay and admin control room update instantly.
- 🎨 **Ready-to-Use OBS Browser Overlay:** Polished gala/ZEvent design (dark card, gold Cinzel typography, central countdown capsule, donation counter, total funds raised, top donor highlight, customizable bottom banner, and victory confetti).
- 🛡️ **Absolute Crash-Proof Resilience:** Every donation is written atomically to `backup.json` (temporary `.tmp` file followed by a POSIX atomic rename). Complete state is seamlessly restored on restart.
- 🎲 **Fair & Cryptographically Secure Weighted Draw:** Secure random selection (`crypto.randomInt`). Each ticket has equal probability; donors acquire tickets proportionally to their total contributions (e.g. 1€ = 1 ticket or custom positive decimal price).
- 🎛️ **Full Streamer Admin Control (`/admin`):** Timer management (Start, Pause, Reset, +1m, +5m), live prize updates, random winner drawings, and built-in donation simulation for rehearsals.
- 🗄️ **Automatic Archiving:** Resetting a raffle that already holds donations archives the full state into `<DATA_DIR>/archive/`, browsable and downloadable from the Admin panel for charity accounting.
- 🚀 **Decoupled Modern Architecture:**
  - **Backend API (CapRover VPS):** Node 22 Alpine Docker container (~80 MB RAM), Fastify 5, WebSockets, and atomic persistence.
  - **Frontend SPA (Cloudflare Pages):** React 19 + Vite + Tailwind CSS distributed worldwide on Anycast CDN with zero hosting costs.

---

## 📖 Guide: Reusing This Project for Future Raffles

Follow this step-by-step walkthrough to set up a new raffle for any charity stream or partner event.

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/rcheiko/twitch-donations-tombola.git
cd twitch-donations-tombola
npm install
```

### 2. Configure Environment Variables (`.env`)

Create your `.env` file at the root from the provided template:
```bash
cp .env.example .env
```

Generate secure, high-entropy secrets (at least 16 random characters):
```bash
# Example generating random hex strings on Mac/Linux
openssl rand -hex 24
```

Fill in your `.env`:
```env
NODE_ENV=production
PORT=3000
DATA_DIR=/app/data

# Streamlabs Socket API Token — same token carries Streamlabs Charity donations
# (Copy from streamlabs.com -> Profile (top-right) -> Account Settings -> API Settings -> API Tokens)
STREAMLABS_SOCKET_TOKEN=your_socket_token_from_streamlabs

# Admin password for /admin dashboard
ADMIN_SECRET_KEY=your_super_secret_random_admin_password
```

> 💡 **Prize & Raffle Settings:** Prize title, ticket price, subtitles, and timer duration are **configured from the live Admin UI (`/admin`)** and automatically saved to `backup.json`.

> 🔒 **Security Notice:** The `.env` file is excluded from Git via `.gitignore`. Never commit tokens or secrets to source control.

### 3. Test Locally (Rehearsal)

To verify everything works before deploying:
```bash
# Start in development mode (API + Frontend with hot module reload)
npm run dev
```

- Open `http://localhost:5173/admin` in your browser.
- Open `http://localhost:5173/overlay` in another window or tab.
- In the Admin panel, enter your `ADMIN_SECRET_KEY` and use the **"Simulate a donation"** panel to send a test donation (e.g. 50€ from "ZeratoR").
- Check that the OBS overlay updates instantly with live ticket counts and animations.
- Test starting the timer and clicking **"Draw Random Winner 🎲"**.

### 4. Deploy to Production

- **Backend API on CapRover (VPS):** Follow the [CapRover Deployment Guide](./docs/DEPLOYMENT-CAPROVER.md).
  - Create app with **Has Persistent Data** enabled on `/app/data`.
  - Configure environment variables and enable Let's Encrypt HTTPS.
- **Frontend SPA on Cloudflare Pages:** Follow the [Cloudflare Pages Deployment Guide](./docs/DEPLOYMENT-CLOUDFLARE.md).
  - Connect GitHub repo, set build command `npm run build:web`, output `packages/web/dist`, and set `VITE_API_URL`.

### 5. Connect Streamlabs Charity (Real-Time Donations)

Streamlabs Charity donations travel on the **same Socket API and the same token** as classic tips — only the event type differs (`streamlabscharitydonation`). There is no separate Charity credential to obtain:

1. Log in to [streamlabs.com/dashboard](https://streamlabs.com/dashboard).
2. Click your profile avatar in the top-right corner > **Account Settings** > **API Settings** > **API Tokens** tab.
3. Copy **"Your Socket API Token"** and paste it into your `.env` as `STREAMLABS_SOCKET_TOKEN`.
4. Make sure this Streamlabs account is **linked to your Streamlabs Charity campaign** — otherwise the socket connects but no charity event is ever delivered.
5. When the server starts, it connects automatically to Streamlabs.
6. When you click **"Start"** on the raffle timer in `/admin`, any Streamlabs Charity donation instantly credits tickets and displays on the overlay.

> ℹ️ Only **Streamlabs Charity** donations credit tickets: classic Streamlabs tips (`type: "donation"`) are deliberately ignored, and so is the Alert Box **"Test Donation"** button, which sends a classic tip. The Streamlabs Charity socket is the **only** donation channel (there is no HTTP webhook endpoint); the single other way to credit tickets is the manual/simulated donation from the Admin panel. You can verify the socket status at any time on `GET /api/health`, which returns `streamlabsConnected: boolean`.

*(For testing and details, see the [Streamlabs Charity Integration Guide](./docs/STREAMLABS-CHARITY.md)).*

### 6. Embed Overlay in OBS Studio

1. In OBS Studio, add a new **Browser Source**.
2. Enter the overlay URL:
   ```
   https://tombola-twitch.pages.dev/overlay
   ```
3. Recommended settings:
   - **Width:** `420`
   - **Height:** `480`
   - **Uncheck:** *"Shutdown source when not visible"* (prevents timer pausing when switching scenes).
   - **Uncheck:** *"Refresh browser when scene becomes active"*.
4. The overlay features a transparent background to blend over camera feeds or gameplay.

### 7. Live Event Workflow (Game Day)

1. The stream production team opens `https://tombola-twitch.pages.dev/admin` and enters the admin key.
2. Adjust the prize title and ticket price if needed.
3. When the streamer launches the raffle, click **"Start"** to initiate the countdown.
4. Add bonus time live (+1 min, +5 min) if donation milestones are reached.
5. When the countdown expires, click **"Draw Random Winner 🎲"**:
   - The winner is randomly selected among all distributed tickets.
   - The OBS overlay automatically reveals the winner banner with victory confetti!
   - If a winner has already been drawn, the API answers `409 Conflict` and the Admin panel offers a **"Draw anyway"** button (which re-sends the request with `{ "force": true }`).
6. To run consecutive raffles with new prizes, click **"Reset Tombola"** and edit the prize settings. If the current raffle already holds donations (or a drawn winner), it is archived first and the Admin panel displays the resulting archive file name.

### 8. Archiving & Accounting

All transactions, timestamps, donor names, and tickets are preserved in `<DATA_DIR>/backup.json`.

When you press **"Reset Tombola"** and the current raffle is not empty, the whole state is first written to:

```
<DATA_DIR>/archive/<YYYY-MM-DD>_<slugified-event-title>.json
```

(a `-2`, `-3`, … suffix is appended if a file with the same name already exists). The reset response returns `archivedAs` (the file name, or `null` if nothing had to be archived).

Archives are exposed through the admin API (header `x-admin-key` required):

| Endpoint | Description |
|---|---|
| `GET /api/admin/archives` | Lists archive summaries (file name, event title, prize title, archived date, donation count, total amount, total tickets, winner name, draw date), newest first |
| `GET /api/admin/archives/:fileName` | Returns the full archived backup payload. `fileName` must match `^[a-z0-9._-]+\.json$` (path traversal such as `../x.json` is rejected with `400`) |

The Admin dashboard exposes an **Archives** section listing past raffles with a **"View JSON"** action, so you can hand accounting proof to partner charities without SSH access to the VPS.

---

## 🛠️ Monorepo Commands

```bash
# Run all services in development mode
npm run dev

# Build all packages for production
npm run build
npm run build:web
npm run build:api

# Typecheck with TypeScript
npm run typecheck

# Lint & format with Biome (fast)
npm run lint
npm run lint:fix
npm run format

# Run automated tests (schemas, engine, persistence, admin API)
npm test
```

> The API test suite runs with `NODE_ENV=test`, which is the **only** way to enable test mode (production secret checks are then skipped). A relative `DATA_DIR` is resolved against the directory of the loaded `.env` file (or the current working directory when no `.env` exists).

---

## 🏗️ Project Structure

```
twitch-donations-tombola/
├── .github/workflows/ci.yml       # Continuous integration (Lint, Typecheck, Build)
├── captain-definition             # CapRover v2 configuration
├── docker/Dockerfile              # Multi-stage Docker image (Node 22 Alpine)
├── CLAUDE.md                      # Developer guide & coding standards
├── docs/                          # Technical documentation
│   ├── ARCHITECTURE.md            # Data model & weighted draw algorithm
│   ├── DEPLOYMENT-CAPROVER.md     # Backend VPS deployment guide (CapRover)
│   ├── DEPLOYMENT-CLOUDFLARE.md   # Frontend SPA deployment guide (Cloudflare Pages)
│   └── STREAMLABS-CHARITY.md      # Real-time Charity Socket API guide & test methods
├── packages/
│   ├── config/                    # Shared Biome & TypeScript base configs
│   ├── contracts/                 # Strict Zod schemas & shared TypeScript types
│   ├── api/                       # Fastify server + WebSockets + JSON persistence
│   └── web/                       # React 19 + Vite + Tailwind (OBS Overlay & Admin)
```

---

## 🔒 Security & Best Practices

- **Zero Hardcoded Secrets:** In production (`NODE_ENV=production`) the server refuses to start if `ADMIN_SECRET_KEY` is missing, still set to its default placeholder, or shorter than 16 characters, or if `STREAMLABS_SOCKET_TOKEN` is missing or still set to its default placeholder.
- **Strict Zod Validation:** All incoming HTTP requests and admin payloads are validated with `.strict()` schemas to reject untrusted or unknown fields. The **only documented exception** is the schema validating inbound Streamlabs Charity Socket API items, which is deliberately non-strict because Streamlabs adds extra fields to its events.
- **Constant-Time Auth:** The admin key (`x-admin-key` header) is verified using `crypto.timingSafeEqual` to prevent timing attacks.
- **Documented Input Bounds:** amount ≤ `1 000 000`, donor name ≤ `64` characters, message ≤ `500` characters, timer `add_time` between `-86400` and `+86400` seconds, timer duration between `10` and `86400` seconds. On the Charity socket, an over-long donor name or message is **truncated** to those bounds rather than dropping a real donation.
