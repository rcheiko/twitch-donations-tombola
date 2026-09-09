# Streamlabs Charity Integration & Testing Guide

This guide explains how **Streamlabs Charity** donation events are ingested in real-time and how to test donations locally and in production.

---

> ⚠️ The Streamlabs **Socket API is the only donation channel**, and only **Streamlabs Charity** donations credit tickets. There is no HTTP webhook endpoint, no `STREAMLABS_WEBHOOK_SECRET`, and no support for third-party forwarders (Zapier, Make, …). Classic Streamlabs tips (`type: "donation"`) are deliberately ignored. The only other way to credit tickets is the manual donation form in the Admin panel.

---

## 1. Same Socket, Same Token

Streamlabs Charity does **not** need a separate credential. Charity donations are delivered on the very same real-time **Socket API** (`https://sockets.streamlabs.com`) and the very same `STREAMLABS_SOCKET_TOKEN` as classic tips — only the event type differs:

| Event type | Source | Credited here |
| --- | --- | --- |
| `donation` | Classic Streamlabs tip page | ❌ ignored |
| `streamlabscharitydonation` | Streamlabs Charity campaign | ✅ credits tickets |

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

> 📌 **Prerequisite:** the Streamlabs account owning this token must be linked to the Streamlabs Charity campaign. If it is not, the socket connects fine but no `streamlabscharitydonation` event is ever delivered — `/api/health` will report `streamlabsConnected: true` while nothing is credited.

### Key Advantages:
- **Instant Connection:** The backend automatically establishes a persistent connection to `https://sockets.streamlabs.com` on startup.
- **Zero Port Forwarding:** Operates seamlessly in local development and production without ngrok or public IP configuration.
- **Live Event Safety:** Donations are captured while the raffle countdown is active (`timer.status === "running"`), automatically crediting tickets to qualifying donors. Events received while the timer is idle, paused or finished are ignored.
- **Connection Check:** `GET /api/health` returns `streamlabsConnected: boolean`, so you can confirm the socket is live before going on air.

---

## 2. Payload Format & Validation

A Streamlabs Charity event carries a list of items shaped like this (real event, abridged):

```json
{
  "type": "streamlabscharitydonation",
  "for": "streamlabscharity",
  "message": [
    {
      "charityDonationId": "455768204817176347",
      "from": "StormRider",
      "amount": "25.00",
      "formattedAmount": "€25.00",
      "currency": "EUR",
      "message": "Avec amour d'Anvers en Belgique.",
      "to": { "name": "Durss" },
      "memberId": "717456377752197490",
      "campaignId": "713449001231458231",
      "id": 24182,
      "_id": "34af89885d0532f74996f3042ca18fb2",
      "createdAt": "2024-09-06 20:29:57",
      "priority": 10
    }
  ],
  "event_id": "evt_db13e7589d97e76af7112f73624d0f5d"
}
```

### Differences with a classic Streamlabs tip

| | Classic tip | Streamlabs Charity |
| --- | --- | --- |
| Donor name | `name` | **`from`** |
| Stable id | `id` | **`charityDonationId`** |
| Amount type | string or number | **string** (`"25.00"`) |
| Donation date | `created_at` (epoch) | **`createdAt`** (`"2024-09-06 20:29:57"`) |

> ⚠️ The Charity `id` field (`24182` above) is only a **per-alert counter**, not a donation identifier — it can repeat across donations. Deduplication therefore keys on `charityDonationId`, falling back to `_id` when absent.

Every item is validated individually with Zod (`safeParse`) before ingestion:

- `from` — trimmed and **truncated** to 64 characters; empty or missing becomes **`"Anonyme"`**.
- `amount` — string or number, must resolve to a positive value up to **1 000 000**.
- `message` — trimmed and **truncated** to 500 characters; `null` or missing becomes an empty string.
- `currency` — compared with the tombola's own currency (`config.currency`, `EUR` by default, editable in `/admin`). A donation in **any other currency is ignored**: nothing is credited, and a `warn` line names the donor, the amount and both currencies so it can be re-entered converted from `/admin` if needed. Crediting it at face value would be a fairness hole — 5000 HUF is worth about 12 €, so it would buy 5000 tickets.
- `charityDonationId` — stored as `streamlabsDonationId`; a donation whose id is already stored is **ignored** (deduplication against Streamlabs replays).
- `createdAt` — the Streamlabs-side donation date, stored **verbatim** as `streamlabsCreatedAt`. It is never converted: Streamlabs marks no timezone on it and documents none. Missing, or longer than 64 characters and therefore not a date, leaves the field absent — a truncated date would read like a real one. Not to be confused with the donation's own `createdAt`, which is when **this server** received the event.

> 📌 **Documented `.strict()` exception:** this is the only schema in the project that is *not* strict. Streamlabs Charity sends additional, undocumented fields on its events (`priority`, `custom`, `userId`, `to`, …), so unknown keys are tolerated here (and only here). Free-text lengths are deliberately **not** bounded in the schema either: an over-long donor name or message is truncated at ingestion rather than dropping a real charity donation mid-event. An item that still fails validation is logged and skipped — it never crashes the listener.

---

## 3. How to Test Donations (2 Options)

### Option 1: Streamlabs Charity Alert Box test (real socket path)
Once `STREAMLABS_SOCKET_TOKEN` is set in your `.env`:
1. Open `http://localhost:5173/overlay` (or your deployed overlay).
2. Start the countdown in `/admin` (nothing is credited while the timer is idle).
3. Trigger a **Streamlabs Charity** test alert from your Streamlabs dashboard.
4. The test donation is captured immediately and appears on the overlay.

> ℹ️ Test events carry `isTest: true`. They are **credited like real donations** (and logged as `(événement de test)`), which is what makes this a genuine end-to-end check — so run them before starting the countdown, or reset the raffle afterwards. Note that the classic Alert Box **"Test Donation"** button sends a `donation` event, which this server now ignores; it will *not* show up.

### Option 2: Admin Dashboard Panel (`/admin`)
The built-in **Admin Dashboard** (`/admin`) features a **"Don manuel"** panel, to rehearse before the show or to credit a donation that reached the tombola some other way:
- Enter donor name, donation amount, and message.
- Click **"Send Simulated Donation"**.
- It dispatches a test donation to verify ticket distribution and visual feedback.

This is the manual donation channel (`POST /api/admin/manual-donation`, header `x-admin-key`). Like the Streamlabs Charity socket channel, it only credits tickets while the countdown is **running** (otherwise `409`), so a pre-show test donation can never leak into the real draw. It also refuses an explicit `currency` that is not the tombola's (`400`); omit the field and the tombola currency is used. Same bounds apply: donor name 1–64 characters, amount up to 1 000 000, message up to 500 characters.
