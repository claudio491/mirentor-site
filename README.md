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
| `ALLOWED_ORIGINS` | comma list of the addresses the site is opened at: `https://www.mirentor.com`, `https://mirentor.com`, `https://mirentor.onrender.com`. The board's writes come through www, so that one must be here: without it every write answers `403 origin` |
| `SHEET_ID` | the lead log's spreadsheet ID |
| `DATA_DIR` | `/var/data` once the disk is mounted; `./data` otherwise (lost on redeploy) |
| `VISITS_TOKEN` | optional bearer token for `GET /api/visits`; unset, `DESK_PUSH_TOKEN` is used |
| `DESK_PASSWORD` | the shared password for `/desk`; unset turns `/desk` off |
| `DESK_PUSH_TOKEN` | bearer token the desk sync uses to push the copy; unset turns `/desk` off |
| `DESK_HOST` | `desk.mirentor.com`: on that host the desk sits at the root (`/`, `/login`, `/data.json`) |
| `GOOGLE_SA_JSON` | the service account key, pasted whole. Share the sheet with its `client_email` as Editor. |
| `TEAM_ENABLED` | `1` turns the sales team's board on inside the sales portal, at `/ventas/equipo`. Unset, it stays off whatever other keys exist. It needs the portal (`SALES_GOOGLE_CLIENT_ID` and `SALES_SESSION_SECRET`): people come in through its Google sign-in, so without the portal the board stays off and the service log says why |
| `TEAM_PUSH_TOKEN` | optional bearer token for the nightly CRM routine and the first manager; unset, `DESK_PUSH_TOKEN` is used |
| `TEAM_BOOTSTRAP` | `1` opens `POST bootstrap` again once the team has an admin. Set it only for the minutes it takes to make another one (the only admin left, or was made with the wrong address), then remove it |

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

## Sales team board (`/ventas/equipo`)

Where the field sales reps log each contact and see their own numbers, and where managers see the team. Spec and rules:
`docs/superpowers/specs/2026-11-16-mirentor-sales-team-platform-design.md`. The client lives in `team/`.

- One file is the truth: `<DATA_DIR>/team/events.jsonl`, one JSON line per change, replayed on start. Points, marks, streaks
  and tables are computed from it on every request (`lib/team/score.mjs`, `lib/team/view.mjs`); the season's numbers are in
  `lib/team/rules.mjs`. A correction is a new line (a void), never an edit.
- Access: the board has no sign-in of its own. It lives inside the sales portal and knows each person by the Google
  account the portal already checked (`lib/sales.mjs`: a verified account on mirentor.com). A manager adds a person
  with their work email and from then on that account opens the board: no PIN, no link to hand over, no secret of the
  board's to keep. A company account that is not on the team gets `403 not_on_team` with the address it used, and the
  app says so; a person taken off the team loses the board on their next request.
- Sessions: the portal's own (`msales`, 30 days, signed, HttpOnly, Secure, SameSite=Lax, path `/ventas`), so one
  sign-in opens the portal and the board. Opened without a session, `/ventas/equipo/` shows the portal's sign-in page
  in place; that page posts back to `/ventas/equipo/auth`, which the portal answers, and lands on the board.
  `/ventas/equipo/salir` ends the session and comes back to the board's address, so the next sign-in lands on the
  board. `lib/team/api.mjs` takes who a request is (`identify`) and that door (`door`) from whoever mounts it:
  `startTeam` wires both to the portal (on the portal's own host, `SALES_HOST`, the door is at the root, as the portal
  is), and `tests/team-door.test.mjs` runs the two modules together.
- What that sharing means: the board trusts every page served at the same address. A script on any page of the
  portal, or of the site at www.mirentor.com, runs with the session of whoever has it open, so publishing a page there
  (`PUT /ventas/_files`, a deploy of the site) is as much as acting on the board for that person, an admin included.
  The portal's pages allow inline scripts. A stricter setup gives the board an address of its own.
- Writes are protected from other sites three ways: the session cookie is `SameSite=Lax`, a write must be JSON, and
  when the browser names where it comes from (`Origin`) it must be this host or one in `ALLOWED_ORIGINS`.
- The answers carry codes and numbers only. Every sentence the rep reads is in `team/i18n.js`, in Spanish and English.

| Who | Routes under `/ventas/equipo/api` |
|---|---|
| Anyone on the team | `GET photo/<person id>` |
| A rep | `GET me`, `GET leads?q=`, `POST log`, `POST close {tomorrow, blocker, preview?}`, `POST goal {k}`, `POST kudos {target, on}`, `POST play {logId, text}`, `POST held {logId}`, `POST lang {lang}` |
| A manager | `GET me?as=<rep id>` (read only), `GET team`, `POST confirm {logId, what, undo?}`, `POST void {logId, reason}`, `POST reopen {rep, day}`, `POST reps {email, name, city, ...}`, `POST reps/<id> {patch}`, `POST dayoff {scope, date}`, `POST site {id?, rep, lead}`, `POST site/<id> {what}`, `POST badge {rep, text}` |
| The bearer token | `POST bootstrap {email, name}`, `PUT leads [...]` (`?force=1`), `GET export?since=<iso>`, `POST leadmap {pairs}`, `PUT photo/<person id> {type, data}`, `DELETE photo/<person id>` |

- `POST log {id, lead: {id} or {name, zone}, kind, channel?, tag?, note?, contact?, when?, voicemail?, clientAt}` answers
  `{repeat, updated, gained, pending, tookLead, streakUp, me}`. The `id` is made on the phone, so a retry never counts
  twice; the same result on the same business the same day is a repeat too, and its new details (note, tag, contact,
  date) update the first log (`updated: true`). A business typed as new that has the same name and zone as one already
  in that city is that business. Whether a log is a follow-up is decided when it is made and kept on the log (`prior`),
  so pushing the lead list again never moves points already earned. The time kept is the server's; a phone clock more
  than 10 minutes off marks the log `late` for the manager. After the day is closed it answers `409 day_closed`.
- `POST close` writes the day's report in the agreed Spanish template and locks the day. `preview: true` returns the
  report without closing, with `empty: true` when nothing is logged yet: such a day answers `409 nothing_to_close`.
  A manager opens a closed day again with `POST reopen {rep, day}`; the points for closing go with it.
- `POST confirm` takes `what` as `meeting_held`, `contract_sent` or `contract_signed`; `undo: true` takes one back. A
  meeting waits for its confirmation from the day of the meeting, not from the day it was booked. Once the wait is
  over the part earns nothing and a late confirmation answers `409 expired`.
- `POST site` records a signed site. The form makes the `id` (`s_...`), so sending it twice is one site.
  `POST site/<id>` takes `what` as `installed`, `first_hour` or `void`; a voided site pays nothing.
- A person's photo shows in their profile, in the manager's table and in the list of people; without one the app
  shows their initials. `PUT photo/<person id>` takes `{type, data}`: `type` is `image/jpeg`, `image/png` or
  `image/webp` and `data` is the file in base64, up to 400 KB. The kind is read from the file's first bytes and must
  match `type`. The file lives in `<DATA_DIR>/team/photos/`; the event log keeps who has a photo and its version, and
  the version is part of the photo's address. `DELETE photo/<person id>` takes it down.
- Working days are Monday to Friday: the hand has five fingers, and other days sent to `POST reps` are dropped.
- `POST bootstrap {email, name}` makes the first manager (role `admin`) from their work email; they then open the
  board and sign in with that Google account. Once the team has an admin it answers `409 bootstrap_closed`, and the
  admin adds everyone else inside the app. With `TEAM_BOOTSTRAP=1` it makes another admin, which is the way back in
  when the only one left or was made with the wrong address. `node tools/team-admin.mjs <service-url> <email> "<name>"`
  wraps it. An address must be on the company domain (`400 email_domain`), belong to nobody else (`409 email_taken`)
  and carry no plus sign: Google answers with the account's own address, so a tagged one could never sign in. An admin
  can correct anyone's address but their own; a manager, a rep's.
- The nightly CRM routine pushes the lead list with `PUT leads` (`{id, company, city, zone, stage, lastContact, doNotCall}`),
  reads the day with `GET export` (`logs` with the CRM's channel and outcome, `stages`, `newLeads`, `doNotCall`) and
  answers each business added in the app with its CRM id through `POST leadmap`. `stages` holds the highest stage the
  day's logs justify: the routine raises a CRM stage, never lowers it. An empty list answers `400 empty`, and a list
  under half the size of the one in place answers `409 shrink` unless the address carries `?force=1`.
- A rep picks from the leads whose `city` is their own city (accents and capitals do not count), so `PUT leads` and
  the rep must name the city the same way. The manager's form offers the cities the list has, and each rep's line
  says how many businesses match. A business added in the app is a line in the event log (`lead.added`).
- A line of `events.jsonl` that cannot be applied is skipped on start and named in the service log. If the module
  cannot start at all, the waitlist and the desk start without it.
- The client is plain files in `team/`, with no build step: `index.html`, `app.css`, `app.js` (the rep's screens and the
  shell), `manager.js`, `hand.js` (the hand, the lenses, the level), `fx.js` (the entrance, the moment box, the small
  rewards), `moments.js`, `ui.js`, `queue.js`, `door.js` (what the app does when the session ends or the account is
  not on the team) and `i18n.js`. Elements are built node by node, never from a string of
  markup; `tests/team-client.test.mjs` checks that, and that both languages carry the same keys.
- Motion has three tiers. The entrance (the lens finds the person and says where they stand) plays on the first open
  of a day and after signing in again. A moment (a full finger or hand, a new step or level, a badge, taking the lead)
  takes the screen once, waits for an open form to close, and at most two play in a row. Everything else is short
  feedback: a number that locks, a ring, points that rise. What deserves which is decided in `team/moments.js`,
  apart from the screens, and tested in `tests/team-moments.test.mjs`. With reduced motion every screen shows its
  final state and the loops are off.
- A log that cannot be sent (no signal, a service that is restarting, a session that ended) waits on the phone (the
  top bar says how many) and goes out again with the same `id`. Only a refusal about the log itself drops it, with the
  reason on screen; a refusal about who is asking (no longer on the team, an origin the service does not allow) keeps
  it waiting, because that can be put right. `team/queue.js` holds that rule. The day cannot be closed while logs wait.
- To look at it on this machine: `node tools/team-dev.mjs 8772`, then open `http://localhost:8772/`. Nobody signs in
  there: where production shows the portal's Google sign-in, the preview lists the people and you choose who to be
  (`tools/team-preview.mjs`; `/dev/como?h=<handle>` does it in one step). Each start writes fictional people and
  businesses to a temp folder and sets the clock to Thursday
  3:00 pm in Panama so the week is half lived (`--day=5` picks another day, `--now` uses the real time). Every screen
  is labeled as sample data. `node tools/team-seed.mjs <empty-folder>` writes the same sample without starting a server.
- To look at it with the actual team instead: write the people in `data-sample/team.json` (the format is at the top of
  `tools/team-roster.mjs`; git ignores that folder, and it must stay out of the repository). The same command then
  shows those people and their photos in real time with no activity, because nothing is made up, and no screen says
  sample. `--sample` brings the fictional sample back.
- To show it from anywhere before it is online: `node tools/team-demo.mjs <out-dir>` packs the app and the team's own
  server code into one page that needs no service (`artifact.html` for an artifact, `index.html` to open locally).
  The server code runs inside the browser on stand-ins for Node (`tools/demo/`), the people come from the same roster
  file, and what a viewer logs stays in that browser. Nobody signs in: a bar on top lets the viewer be any person of the
  team, so this copy is for demonstration only. The page carries the roster's names and photos: keep it out of the repository.
- Writes need `content-type: application/json` and, when the browser sends an `Origin`, one that is this host or in
  `ALLOWED_ORIGINS`. Bodies stop at 16 KB (`PUT leads` at 4 MB). Every answer is `no-store` and `noindex`; the page
  ships with a policy that allows scripts, styles and fonts from this origin only.

### The board's illustrations

A rep's day, week and team are drawn with images made for this app (17 Nov 2026, the third look). They live in `team/art/`, and `team/art.js` says where each one is and what the page must know about it: how much of each frame of a stop is light, where the hand's 21 joints are, where the team stands on the staircase. Both are written by the art pipeline, which is kept beside the approved sample, outside this repository (`sales/team-platform/sample-v3/art/`: the prompts, `process.py`, `export_app.py`). Do not edit `team/art.js` by hand.

- A stop of the day is a strip of four frames (it waits, it starts, it happened, it is celebrated). Which frames play, and where a log lands, is decided in `team/stops.js`, away from the screen (`tests/team-stops.test.mjs`); `team/stage.js` draws it.
- The page names each image once, as a CSS variable (`--art-visit` and so on, set by `app.js`); an element picks one with `data-art` and a frame with `data-f`. The one-page copy (`tools/team-demo.mjs`) swaps `art.js` for one that carries the images inside.
- The images hold no person and no name.

## Tests

`npm test` (no dependencies).
