# Streamlabs Integration & Testing Guide

This guide explains how Streamlabs donation events are ingested in real-time and how to test donations locally and in production.

---

> ⚠️ The Streamlabs **Socket API is the only donation channel**. There is no HTTP webhook endpoint, no `STREAMLABS_WEBHOOK_SECRET`, and no support for third-party forwarders (Zapier, Make, …). The only other way to credit tickets is the manual donation form in the Admin panel.

---

## 1. Streamlabs Real-Time Socket API (Only Channel)

Streamlabs provides a native, real-time **Socket API** (`https://sockets.streamlabs.com`) that delivers donation alerts directly to the server without requiring open inbound ports or reverse tunnels.

### Obtaining your Socket API Token:
1. Log in to [streamlabs.com/dashboard](https://streamlabs.com/dashboard) with your Twitch account.
2. Click your profile avatar in the top-right corner > **Account Settings**.
3. Click on **API Settings**.
4. Select the **API Tokens** tab.
5. Find **"Your Socket API Token"** and click **Copy**.
6. Set it in your `.env` (or CapRover environment variables):
   ```bash
   STREAMLABS_SOCKET_TOKEN=your_copied_socket_token_here
   ```

### Key Advantages:
- **Instant Connection:** The backend automatically establishes a persistent connection to `https://sockets.streamlabs.com` on startup.
- **Zero Port Forwarding:** Operates seamlessly in local development and production without ngrok or public IP configuration.
- **Alert Box Testing:** In your Streamlabs dashboard (`Alert Box`), clicking **"Test Donation"** triggers an immediate live donation event that updates the raffle tickets and OBS overlay in real time.
- **Live Event Safety:** Donations are captured while the raffle countdown is active (`timer.status === "running"`), automatically crediting tickets to qualifying donors. Events received while the timer is idle, paused or finished are ignored.
- **Connection Check:** `GET /api/health` returns `streamlabsConnected: boolean`, so you can confirm the socket is live before going on air.

---

## 2. Payload Format & Validation

Each donation event delivered by the socket carries a list of items shaped like this:

```json
{
  "type": "donation",
  "message": [
    {
      "id": "3194821",
      "name": "ZeratoR",
      "amount": "100.00",
      "formatted_amount": "100.00 €",
      "currency": "EUR",
      "message": "Good luck with the charity event!",
      "created_at": 1725710400
    }
  ]
}
```

Every item is validated individually with Zod (`safeParse`) before ingestion:

- `name` — trimmed, max **64** characters; empty or missing becomes **`"Anonyme"`**.
- `amount` — string or number, must resolve to a positive value up to **1 000 000**.
- `message` — trimmed, max **500** characters, defaults to an empty string.
- `id` — used as `streamlabsDonationId`; a donation whose id is already stored is **ignored** (deduplication against Streamlabs replays).

> 📌 **Documented `.strict()` exception:** this is the only schema in the project that is *not* strict. Streamlabs sends additional, undocumented fields on its events, so unknown keys are tolerated here (and only here). An item that still fails validation is logged and skipped — it never crashes the listener.

---

## 3. How to Test Donations (2 Options)

### Option 1: Streamlabs Alert Box "Test Donation" Button (Easiest)
Once `STREAMLABS_SOCKET_TOKEN` is set in your `.env`:
1. Open `http://localhost:5173/overlay` (or your deployed overlay).
2. Go to your [Streamlabs Alert Box](https://streamlabs.com/dashboard#/alertbox).
3. Click the **Test Donation** button.
4. The test donation is captured immediately and appears on the overlay!

### Option 2: Admin Dashboard Panel (`/admin`)
The built-in **Admin Dashboard** (`/admin`) features a **"Simulate Streamlabs Donation"** panel:
- Enter donor name, donation amount, and message.
- Click **"Send Simulated Donation"**.
- It dispatches a test donation to verify ticket distribution and visual feedback.

This is the manual donation channel (`POST /api/admin/manual-donation`, header `x-admin-key`). Like the Streamlabs socket channel, it only credits tickets while the countdown is **running** (otherwise `409`), so a pre-show test donation can never leak into the real draw. Same bounds apply: donor name 1–64 characters, amount up to 1 000 000, message up to 500 characters.
