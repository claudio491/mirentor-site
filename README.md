# Mirentor waitlist backend

Takes the waitlist form from the Mirentor site, keeps every sign-up on disk, and writes it to the lead log
(Leads tab) as one row with Source "Waitlist form". It reads the row back before answering.

- `POST /api/waitlist`: 200 when the row is in the sheet, 202 when it waits on disk (Google off or down), 400 with the fields to fix.
- `GET /healthz`: `{ ok, sheets, pending }`.
- The same entry id twice never makes a second row.

## Environment

| Key | Value |
|---|---|
| `ALLOWED_ORIGINS` | `https://mirentor.onrender.com` (comma list) |
| `SHEET_ID` | the lead log's spreadsheet ID |
| `DATA_DIR` | `/var/data` once the disk is mounted; `./data` otherwise (lost on redeploy) |
| `GOOGLE_SA_JSON` | the service account key, pasted whole. Share the sheet with its `client_email` as Editor. |

## Tests

`npm test` (no dependencies).
