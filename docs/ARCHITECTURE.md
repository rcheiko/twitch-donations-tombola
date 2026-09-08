# Technical Architecture — Twitch Tombola

This document details data flows, the lifecycle of a Streamlabs donation, and the real-time persistence model.

---

## Data Flow Overview

There are exactly **two** donation channels: the Streamlabs Real-Time Socket API, and the manual donation endpoint of the Admin panel. No HTTP webhook route exists.

```
[ Streamlabs Tip Page / Alert Box ]        [ Admin Panel ]
                 │                                │
                 ▼                                ▼
[ Streamlabs Real-Time Socket API ]   [ POST /api/admin/manual-donation ]
                 │                                │
                 └──────────────┬─────────────────┘
                                ▼
                     [ Zod Validation & Auth ]
                                │
                                ▼
                 [ Tombola Engine (In-Memory Store) ]
                                │
                                ├──> Deduplication by `streamlabsDonationId`
                                ├──> Donor name fallback -> "Anonyme"
                                ├──> Ticket Calculation (integer cents, see below)
                                ├──> Update Global Stats (total amount, count, top donation)
                                │
                                ├───► [ Atomic Disk Persistence ] -> <DATA_DIR>/backup.json
                                │
                                └───► [ WebSocket Broadcast ] -> /ws
                                            │
                                            ├──► [ OBS Overlay ] : instant animated UI update
                                            └──► [ Admin Panel ] : real-time dashboard refresh
```

### Ingestion rules

- **Socket validation:** every incoming Streamlabs item is validated with `StreamlabsItemSchema.safeParse`. This schema is the single documented exception to the project-wide `.strict()` rule, because Streamlabs adds extra fields to its events. An invalid item is ignored (logged, never thrown).
- **Timer guard:** socket donations are only credited while `timer.status === "running"`.
- **Deduplication:** if a donation with the same `streamlabsDonationId` is already stored, the engine returns the existing donation, credits nothing and does not re-persist. Streamlabs replays are therefore harmless.
- **Anonymous fallback:** a donor name that is empty after trimming becomes `"Anonyme"`.
- **Bounds:** amount ≤ `1 000 000`, donor name ≤ `64` characters, message ≤ `500` characters.

### Ticket calculation (integer cents)

Tickets are never computed with raw floating-point division; both the amount and the ticket price are converted to integer cents first, which avoids `0.1 + 0.2` style rounding drift:

```ts
ticketsFor(amount, ticketPrice) =
  Math.floor(Math.round(amount * 100) / Math.round(ticketPrice * 100))  // never negative
```

For example, `0.30 €` with a `0.10 €` ticket price yields exactly `3` tickets.

---

## Backup File Structure (`backup.json`)

The backup file stored at `/app/data/backup.json` has the following structure:

```json
{
  "version": 1,
  "lastUpdated": "2026-09-07T12:00:00.000Z",
  "config": {
    "ticketPrice": 1,
    "eventTitle": "TOMBOLA CARITATIVE",
    "lotTitle": "SIGNED BASKETBALL BY KARL-ANTHONY TOWNS",
    "lotSubtitle": "",
    "timerDurationSeconds": 900
  },
  "stats": {
    "totalAmount": 8651,
    "donationCount": 1789,
    "topDonation": {
      "donorName": "Shokker",
      "amount": 1000,
      "currency": "EUR"
    }
  },
  "donations": [
    {
      "id": "don_abc123",
      "streamlabsDonationId": "sl_987654",
      "donorName": "Shokker",
      "amount": 1000,
      "currency": "EUR",
      "ticketsCount": 1000,
      "message": "GG for the charity event!",
      "createdAt": "2026-09-07T11:45:00.000Z"
    }
  ],
  "timer": {
    "status": "running",
    "remainingSeconds": 690,
    "endsAt": "2026-09-07T12:11:30.000Z"
  },
  "draw": {
    "hasDrawn": true,
    "winner": {
      "donationId": "don_abc123",
      "donorName": "Shokker",
      "ticketsCount": 1000,
      "totalDonated": 1000
    },
    "drawnAt": "2026-09-07T12:12:00.000Z"
  }
}
```

Timer state is stored as an absolute `endsAt` timestamp; the remaining seconds displayed anywhere (API, overlay, admin) are always recomputed from it with the shared helper `remainingSecondsFrom(endsAt)` — `Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 1000))` — so a server restart or a slow client never drifts.

---

## Weighted Random Draw Algorithm

Each donation carries its own `ticketsCount`, so the draw operates on **ticket intervals per donation**, in insertion order:

1. The engine walks the donations in order and assigns each one a contiguous ticket interval; the sum is `totalTickets`.
2. A cryptographically secure ticket number is drawn with `crypto.randomInt(1, totalTickets + 1)` (i.e. a uniform integer in `[1, totalTickets]`).
3. The donation whose interval contains that ticket number is the winning donation. Its `id` is stored as the winner's **`donationId`**, which makes the result auditable against `backup.json`.
4. For display, `ticketsCount` and `totalDonated` are then aggregated across **all** donations sharing the winner's `donorName` — so the overlay shows the donor's full contribution, not just the winning donation.
5. The `WINNER_DRAWN` event (payload: the whole `TombolaDraw`) is broadcast over WebSockets to trigger the OBS overlay victory screen and confetti animation.

Because probability is proportional to tickets, a donor holding 99 of 100 tickets wins ~99 % of the time.

### Draw endpoint semantics

- `POST /api/admin/draw` accepts an empty body, or `{ "force": true }`.
- If a winner has already been drawn and `force` is not set, the API answers **`409 Conflict`** with `{ "error": "Un gagnant a déjà été tiré" }`. The Admin panel surfaces this and offers a "draw anyway" action that re-sends the request with `force: true`.

---

## Archiving

`POST /api/admin/reset` never destroys a raffle silently. If the current state holds at least one donation (or a drawn winner), the complete backup payload is first written to:

```
<DATA_DIR>/archive/<YYYY-MM-DD>_<slug(eventTitle)>.json
```

The slug is lowercased, accent-stripped, non-alphanumeric characters replaced by `-`, truncated to 40 characters. On a name collision a `-2`, `-3`, … suffix is appended. The reset response is `{ "success": true, "archivedAs": "2026-09-07_tombola-caritative.json" | null }`.

Archives are read back through two admin routes (header `x-admin-key`):

| Endpoint | Response |
|---|---|
| `GET /api/admin/archives` | `{ "archives": TombolaArchiveSummary[] }` — file name, event title, prize title, `archivedAt`, donation count, total amount, total tickets, winner name (nullable), `drawnAt` (nullable); sorted newest first |
| `GET /api/admin/archives/:fileName` | The full archived `TombolaBackupData`. `fileName` must match `^[a-z0-9._-]+\.json$`; anything else (e.g. `../secret.json`) is rejected with `400` |

---

## Health & Observability

`GET /api/health` reports the process status **and** the live Streamlabs socket state:

```json
{ "status": "ok", "streamlabsConnected": true }
```

`streamlabsConnected` reflects the actual listener connection, which is the quickest way to confirm before a live show that donations will be ingested.

---

## Error Format

Every route answers errors with the same shape:

```json
{ "error": "human readable message", "details": {} }
```

where `error` is the first readable Zod message when the failure comes from validation. Unknown routes return `{ "error": "Not Found" }` as JSON; the SPA fallback only applies to `GET` requests outside of `/api/` and `/ws`.
