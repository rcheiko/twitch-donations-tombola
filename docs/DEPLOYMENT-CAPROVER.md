# CapRover Deployment Guide (VPS)

This document provides a step-by-step guide to configuring and deploying the **Twitch Tombola** backend on your VPS using **CapRover**.

---

## Deployment Architecture

The backend application is designed to run in a **single optimized Docker container**:
- Single exposed port: **`3000`**
- WebSockets enabled: native support on `/ws`
- Persistent volume mounted on `/app/data` to save `backup.json` (prevents data loss during container updates or VPS reboots).

---

## 1. Create the Application in CapRover

1. Log in to your CapRover dashboard (`https://captain.your-vps.com`).
2. Go to the **Apps** tab.
3. Enter an application name: e.g. **`tombola`**.
4. ⚠️ **Critical: Check the "Has Persistent Data" box** before clicking "Create New App".

---

## 2. Configure the Persistent Volume (Crash-Proof Storage)

1. Click on the created application **`tombola`**.
2. Go to the **App Configs** tab.
3. Scroll down to the **Persistent Directories** section:
   - **Path in Container**: `/app/data`
   - **Label**: `tombola-data`
4. Click **Save & Update**.

> This setting guarantees that `backup.json` — and the `archive/` sub-directory holding past raffles — will never be deleted during redeployments, restarts, or VPS reboots.

---

## 3. Set Environment Variables

Under **App Configs** > **Environment Variables**, add:

```bash
NODE_ENV=production
PORT=3000
DATA_DIR=/app/data
STREAMLABS_SOCKET_TOKEN=your_token_from_streamlabs_account_settings_api_tokens
ADMIN_SECRET_KEY=choose_a_strong_admin_password
```

> ⚠️ **Production guard:** with `NODE_ENV=production`, the server refuses to start if `ADMIN_SECRET_KEY` is missing, left at its default placeholder or shorter than 16 characters, or if `STREAMLABS_SOCKET_TOKEN` is missing or left at its default placeholder.

> 💡 **Reminder:** Raffle settings (prize title, ticket price, subtitles, timer duration) are not environment variables. They are configured dynamically from the live Admin UI (`/admin`) and automatically persisted to `backup.json`.

Then click **Save & Update**.

---

## 4. Configure Port and WebSocket Support

Under **HTTP Settings**:
1. **Container HTTP Port**: Enter **`3000`**.
2. **Websocket Support**: Check the box (or let CapRover configure Nginx with proper upgrade headers).

---

## 5. Attach Custom Domain & Enable HTTPS

1. Under **Connect New Domain**, enter your subdomain (e.g. `api-tombola.yourdomain.com`).
   *(Ensure your DNS A record points to your VPS IP address).*
2. Once domain verification succeeds, click **Enable HTTPS** (automatic Let's Encrypt certificate).
3. Check **Force HTTPS** to redirect all HTTP traffic to HTTPS.

---

## 6. Deployment Methods

### Option A: Automatic Deployment via GitHub Webhook (Recommended)
1. Under the **Deployment** tab in CapRover:
2. Scroll to **Method 3: Deploy from Github/Bitbucket/Gitlab**.
3. Enter repository URL: `https://github.com/xxx/twitch-donations-tombola.git`
4. Branch: `main`
5. (If the repo is private, configure an SSH Key Pair or Personal Access Token).
6. Copy the CapRover Webhook URL and paste it into GitHub (Repository Settings > Webhooks) to trigger automatic deployments on `git push`.

### Option B: Deployment via CapRover CLI
From your local machine:
```bash
# Install CapRover CLI globally (if not installed)
npm install -g caprover

# Deploy current branch
caprover deploy
```
Select your CapRover server and target app `tombola`.

---

## 7. Production URLs

Once deployed with your custom domain (e.g. `api-tombola.yourdomain.com`):

| Service | URL | Role |
|---|---|---|
| **OBS Overlay** | `https://api-tombola.yourdomain.com/overlay` | Browser Source URL in OBS (450x650) |
| **Admin Panel** | `https://api-tombola.yourdomain.com/admin` | Streamer control room for timers and draws |
| **Healthcheck** | `https://api-tombola.yourdomain.com/api/health` | Server status + `streamlabsConnected` (live Streamlabs Charity socket state) |
| **Archives** | `https://api-tombola.yourdomain.com/api/admin/archives` | Past raffles archived on reset (requires `x-admin-key`) |
| **WebSocket** | `wss://api-tombola.yourdomain.com/ws` | Real-time WebSocket connection |

