# Mirentor waitlist backend

Takes the waitlist form from the Mirentor site, keeps every sign-up on disk, and writes it to the lead log
(Leads tab) as one row with Source "Waitlist form". It reads the row back before answering.

- `POST /api/waitlist`: 200 when the row is in the sheet, 202 when it waits on disk (Google off or down), 400 with the fields to fix.
- `GET /healthz`: `{ ok, sheets, pending, dataDir, desk }`.
- `GET /api/geo`: `{ ok, country }`, the visitor's ISO country code from Cloudflare's `cf-ipcountry` header (Render
  forwards it; `null` when unknown or Tor). Allowed origins only, nothing stored. The site's Spanish home uses it to send
  visitors outside the Spanish-speaking countries to `/en/` (site `src/partials/lang-auto.html`).
- The same entry id twice never makes a second row.
- `POST /api/visit`: a visit from a link we emailed. The link carries the lead's code (`?c=k7m2qx`, from
  `tools/ref.mjs`: the same lead ID always gives the same six characters). The site home (`src/partials/email-code.html`)
  sends one beacon per session, `text/plain` JSON `{ c, page, how }`, once the visitor scrolls, taps or types
  (`interact`) or stays 5 s (`timer`). Kept in `visits.jsonl`: code, time, country (Cloudflare), page, how and browser;
  never the address. Allowed origins only, 30 per address per 10 minutes. Answers 204.
- `GET /api/visits`: the visit list, `Authorization: Bearer $VISITS_TOKEN` (falls back to `DESK_PUSH_TOKEN`). Off when
  neither is set. `node tools/clicks.mjs` prints it by company, joined with the `outreach/*-links-*.csv` files.
- A sign-up that arrived through a coded link carries the code: Leads column M says `email code k7m2qx`.

## Environment

| Key | Value |
|---|---|
| `ALLOWED_ORIGINS` | `https://mirentor.onrender.com` (comma list) |
| `SHEET_ID` | the lead log's spreadsheet ID |
| `DATA_DIR` | `/var/data` once the disk is mounted; `./data` otherwise (lost on redeploy) |
| `VISITS_TOKEN` | optional bearer token for `GET /api/visits`; unset, `DESK_PUSH_TOKEN` is used |
| `DESK_PASSWORD` | the shared password for `/desk`; unset turns `/desk` off |
| `DESK_PUSH_TOKEN` | bearer token the desk sync uses to push the copy; unset turns `/desk` off |
| `DESK_HOST` | `desk.mirentor.com`: on that host the desk sits at the root (`/`, `/login`, `/data.json`) |
| `GOOGLE_SA_JSON` | the service account key, pasted whole. Share the sheet with its `client_email` as Editor. |

## Team Desk copy (`/desk`)

A view-only copy of the Prentis Team Desk (the claude.ai artifact) for the team, behind one password.

- `GET /desk`: the password form, or the desk once the `mdesk` cookie is set (30 days, signed, HttpOnly).
- `POST /desk/login`: checks the password; 10 wrong tries per address per 10 minutes, then 429.
- `GET /desk/data.json`: the latest snapshot; the page polls it every minute.
- `PUT /desk/snapshot`: `Authorization: Bearer $DESK_PUSH_TOKEN`, body `{ snapshot, page }`. The desk sync runs
  `PRENTIS_2026-10-28/desk/public-copy/push.mjs` after every run; it pushes, then reads the copy back through the password.
  The snapshot holds the desk's collections (`docs` and `workflows` are optional) and the documents `meta/desk`
  (required) and `meta/flow` (the Agents tab's flow chart numbers).

The page runs unchanged; a shim stands in for the claude.ai runtime with view-only access. Every `/desk` answer is
`no-store` and `noindex`. Changing `DESK_PASSWORD` signs everyone out.

## Tests

`npm test` (no dependencies).
