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
| `TEAM_PUSH_TOKEN` | the board's own bearer token: the CRM bridge, the hours routine and the admin tool; unset, `DESK_PUSH_TOKEN` is used. While both are set, both open the board and every call made with the desk's is named in the log, so its caller can be moved |
| `TEAM_TOKEN_ONLY` | `1`: only `TEAM_PUSH_TOKEN` opens the board's service routes; the desk's key opens nothing there |
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
| A rep | `GET me`, `GET leads?q=`, `GET leads?list=due\|soon\|nonext\|mine\|free&zone=&offset=`, `GET biz/<id>`, `POST biz/<id> {next} or {release} or {reopen}`, `POST log`, `POST close {tomorrow, blocker, preview?}`, `POST goal {k}`, `POST kudos {target, on}`, `POST play {logId, text}`, `POST held {logId}`, `POST lang {lang}` |
| A manager | `GET me?as=<rep id>` (read only), `GET team`, `GET scorecard`, `POST blocker {rep, day}`, `POST stalled {logId, what}`, `POST biz/<id> {owner} or {release} or {reopen}`, `POST confirm {logId, what, undo?}`, `POST void {logId, reason}`, `POST reopen {rep, day}`, `POST reps {email, name, city, ...}`, `POST reps/<id> {patch}`, `POST dayoff {scope, date}`, `POST site {id?, rep, lead}`, `POST site/<id> {what}`, `POST badge {rep, text}` |
| A leader (reads only; anything else answers `403 read_only`) | `GET me`, `GET lead`, `GET scorecard`, `GET docs`, `GET leads?q=` and `?list=`, `GET biz/<id>`, `GET photo/<person id>`, `POST lang {lang}` |
| The bearer token | `POST bootstrap {email, name}`, `PUT leads [...]` (`?force=1`), `GET export?since=<iso>`, `GET scorecard`, `GET sitereports?since=<iso>`, `POST leadmap {pairs}`, `PUT photo/<person id> {type, data}`, `DELETE photo/<person id>` |

- `POST log {id, lead: {id} or {name, zone}, kind, channel?, tag?, note?, contact?, phone?, when?, time?, next?, lost?, voicemail?, clientAt}` answers
  `{repeat, updated, gained, pending, tookLead, streakUp, took, owned, me}`. The `id` is made on the phone, so a retry never counts
  twice; the same result on the same business the same day is a repeat too, and its new details (note, tag, contact,
  date) update the first log (`updated: true`). A business typed as new that has the same name and zone as one already
  in that city is that business. Whether a log is a follow-up is decided when it is made and kept on the log (`prior`),
  so pushing the lead list again never moves points already earned. The time kept is the server's; a phone clock more
  than 10 minutes off marks the log `late` for the manager. After the day is closed it answers `409 day_closed`.
  A conversation (`talk`, `call`, `meeting`, `contract`) keeps `contact` and `phone` (40); a meeting or a contract its
  `when`, a meeting its `time` (`HH:MM`, 24 hours). `next` is `{day, step}` (today to a year ahead, 1 to 140
  characters) or `null`; one that is not a real one is dropped and the log stands, so a log that waited offline is never
  refused. `lost` is a reason of `RULES.lostReasons`, kept only with a lost tag (`not_fit`, `not_interested`,
  `do_not_call`), and `other` when that tag comes with none. A lost tag or `waitlist` clears the next step.
- Who holds a business (`lib/team/biz.mjs`): the rep the overlay names (a take, a gift), else the rep the CRM's Owner
  names. It is free when nobody active holds it (blank, "Libre (correo automático)", a manager, someone who left) or when
  the holder's last contact on it is more than 30 days old (`RULES.ownerLapseDays`) with no next step dated today or
  later. From `Contract sent` on (the CRM's stage, or the app's: a contract whose sending a manager confirmed) it never
  lapses; a manager can still release it or give it. A log with any result but `baddata` on a free business takes it (`took: true`); the holder's log moves its next
  step, Lost and the phone; another rep's log is kept and moves nothing on the business (`owned: {name}`). "Do not call"
  from the CRM or from any rep's log answers `409 do_not_call` and takes the business off every list; voiding that log
  brings it back. A later result opens a Lost or Waitlist business again.
- `GET leads?q=` answers rows `{id, name, zone, known, stage, free, owner: null | {name, mine}, next, lost, lastDay,
  lastKind, workers, walkin}`. `GET leads?list=` answers the same rows, 30 a page, with `{total, offset}`: `due`
  (theirs, due today or overdue, oldest first), `soon` (the next 7 days), `nonext`, `mine` and `free` (the free
  businesses of their city, their two zones first, then the highest walk-in score). `list` wins over `q`; another list
  answers `400 list`. A leader searches every city.
- `GET biz/<id>` answers the card: the row, what the CRM knows (contact, title, phone, email, address, maps, website,
  rating, reviews, notes), the last 15 contacts by anyone, the route and `can: {next, release, assign}`. A rep reads the
  businesses of their city; anything else answers `404 not_found`. `POST biz/<id>` takes one of `{next}` (the holder;
  `400 next`, `403 not_yours`), `{release: true}` (the holder, a manager or an admin; `409 free`), `{owner: <rep id>}` (a
  manager or an admin; `400 rep`) and `{reopen: true}` (on a Lost or Waitlist business; `409 open`).
- `GET me` gains `agenda: {due, soon, meetings, counts}`, and `GET team` each rep's `book: {owned, overdue, today,
  nonext}` and `needs.overdue`, the reps with overdue follow-ups, the oldest first.
- `POST close` writes the day's report in the agreed Spanish template and locks the day. `preview: true` returns the
  report without closing, with `empty: true` when nothing is logged yet: such a day answers `409 nothing_to_close`.
  A manager opens a closed day again with `POST reopen {rep, day}`; the points for closing go with it.
- `POST confirm` takes `what` as `meeting_held`, `contract_sent` or `contract_signed`; `undo: true` takes one back. A
  meeting waits for its confirmation from the day of the meeting, not from the day it was booked. Once the wait is
  over the part earns nothing and a late confirmation answers `409 expired`.
- A contract wait nobody confirmed in time shows on the route as expired, with its date: the rep logs the contract
  again, and the manager's "sitios en camino" says so instead of waiting on the manager. "Sent" pays once per rep and
  business: a contract logged again earns only its signature.
- The daily site report ("Reporte del día", `lib/team/report.mjs`, form in `team/report.js`): `GET site/<id>/report`
  answers the site's local day, what the app prefills (people and iPhones working tonight = workers holding a phone on
  the site; the site; the sender's name as City Lead) and today's report if sent. `POST site/<id>/report` takes
  `{people, delivered, accepted, phones|headsets|batteries|cords: {out, back, broken, working}, surge: {working, broken},
  sets, allOk, missing, need, notes}`. Its rep or a manager or an admin, on a site that is installed or legacy and not
  voided (`409 not_live` otherwise); a leader is refused. One per site and local day: a second one the same day is a new
  event that replaces the first. Hours are optional (empty stays empty, never 0), from 0 to 24 per person, accepted no
  more than delivered. Hoy reminds a rep from 5 pm local time while a live site has no report today.
- `GET sitereports?since=<iso>` (bearer token) answers `{ok, since, until, headers, rows, ids}` for the ops lead's sheet:
  `headers` is the sheet's 31 column names, each row the newest report of a site and day written since `since` (a report
  changed later comes back), `ids[i]` is `<site id>|<day>|<event id>`. Practice sites never appear.
- `POST site` records a signed site. The form makes the `id` (`s_...`), so sending it twice is one site.
  `POST site/<id>` takes `what` as `installed`, `first_hour` or `void`; a voided site pays nothing.
- Wave 2 (what the company needs to know), one line per route or event:
  - `POST log` takes `q: {workers?, wifi?, lead?}` on `talk`, `call`, `meeting` and `contract` (event `log`, and `log.update` patches, carry `q`); the business keeps the latest known answer per row ("unknown" never replaces yes or no). The card answers `q` and `qual: {state: 'yes'|'no'|'missing', missing}`.
  - `GET export` `biz` rows add `workers` (the range's lower bound), `qual` and `qualNote` (`Qualification: ...`), with `workers` and `qual` in `fields` until a push shows the CRM holds them (`biz.synced`).
  - `POST log` on a meeting takes `demo: true` ("Pide demo"); `GET me` agenda meetings and `GET team` `needs.meetings` (today to today + 6) carry it.
  - Event `site.request {siteId, count}` (1 to 500): opening a site (`POST site`, `POST route/site`) takes `request`; `POST route/request {lead, count}` (the site's rep), `POST site/<id> {what: 'request'|'arrived', count}` (a manager).
  - Event `site.phones.added {siteId, count}`: a shipment adds to the phones that arrived; `site.phones` stays the correction of the total. `GET team` sites add `requested` and `owed` (0 on a legacy or practice site, so the list's sum is "Pedidos y no entregados"); the route's site adds `requested`.
  - Event `site.advance {siteId, asked, paid, by}`: the business's advance, as a manager marks it (`POST site/<id> {what: 'advance', asked, paid}`, a manager or an admin, never on a practice or voided site; `400 day` on a day that is not a calendar day or is after today, `400 fields` on paid without asked or before it). The whole mark each time; both null clears it. No amount, name or bank detail is stored. `GET team` sites add `advance` and `needs.advances` (asked, not paid, oldest first, with the days waiting); the route's site adds `advance`.
  - A document may carry a text (`body: {es, en}`, plain text, 2,400 characters per language): a card read in the app. It needs an address or a text; with neither the answer is `doc_url`.
  - `GET team` `needs.blockers` (today's closes with a real blocker, yesterday's until seen; active reps only); `POST blocker {rep, day}` (a manager) appends `blocker.seen`.
  - `GET team` `needs.stalled` ("Trabados"); `POST stalled {logId, what: 'missed'|'alive'}` (a manager) appends `meeting.missed {logId, rep?, next?}` (the holder gets "Reagendar la reunión" for today) or `stalled.alive {logId}` (hidden 7 days). Only what the app made, and only while a manager can still confirm it.
  - After `meeting.missed` the business goes back a stage (Contacted at least) while the CRM still says the stage that log raised it to; `GET export` `biz` rows carry `lower: {from, to}` (else `null`), with `lower` last in `fields`, until a push shows another stage (`biz.synced` with `lower`). `to` is only `Contacted`, `Intro call booked` or `Intro call done`: at any other stage there is no `lower`. On replay `meeting.missed` is ignored for a meeting confirmed held or a contract confirmed signed. A lowering from `Intro call booked` does not stand while a `crm.log` row (not voided) with the outcome `Meeting booked` is dated after the missed log's day: the meeting was booked again in the sheet.
  - `GET scorecard?week=&rep=&cell=` (a manager, an admin, a leader, or the bearer token): the Rep Scorecard's twenty columns per rep and for the team, each cell with the list behind it (`lib/team/scorecard.mjs`). Its `owned` and `overdue` are the rep's book (`bookOf`), as in `GET me` agenda and `GET team` `book` and `needs.overdue`: Lost and "do not call" are out; a Waitlist business counts in `owned`, and in `overdue`, `today` or `soon` (lists `due`, `soon`, `mine`) when it has a next step, never in `nonext`.
  - `GET leads?similar=<text>` answers the city's near twins of a typed name, each row with `pick`. A new business's zone takes the list's spelling. `install/<id>/workers` and `worker/<id>/edit` take `noEmail: true` ("No tiene correo").
- `POST pay {cents, from?}` (admin) sets the rate per accepted hour from a Monday on, this week by default. "This week"
  is the latest current week among the active reps' time zones. Once a rate was in force, a week already shown keeps
  what it paid: a new rate from an earlier week answers `409 week_shown`.
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
- The nightly CRM routine pushes the lead list with `PUT leads` (up to 12 MB; per business `id`, `company`, `type`,
  `stage`, `owner`, `nextDay`, `nextStep`, `lastContact`, `contact`, `title`, `phone`, `email`, `industry`, `category`,
  `city`, `zone`, `address`, `website`, `maps`, `walkin`, `rating`, `reviews`, `workers`, `doNotCall`, `notes`; anything
  else is dropped, text is trimmed and capped, links are kept only as `http(s)://`, days only as real days, numbers only
  as numbers), reads the day with `GET export` (`logs` with the CRM's channel and outcome, each with its `next` and
  `time`, `stages`, `newLeads`, `doNotCall`, `biz`) and answers each business added in the app with its CRM id through
  `POST leadmap`. `biz` holds, for each real business whose overlay changed since `since`, `{lead, owner, next, stage,
  reopen, reason, workers, contact, phone, qual, qualNote, lower, at, fields}`, in that order: only the keys in `fields`
  mean "write", and a row with none is left out. `fields` holds some of `owner`, `next`, `stage`, `contact`, `phone`,
  `workers`, `qual`, `lower`, always in that order. `reopen: true` (with `stage: null` and `stage` in `fields`) is a business the CRM says is Lost that the app
  opened again. The app's value wins until a push carries the same value back (a value said again after that wins
  again); `PUT leads` then appends `biz.synced` for those fields, and from then on the CRM's
  cell wins, so a correction typed in the sheet shows in the app and is never written over. `stages` holds the highest stage the
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
  not on the team) and `i18n.js`; the later screens, each drawn by its own module: `book.js` (Mis negocios), `biz.js`
  (a business's card), `docs.js` (Documentos, the Guion and the cards), `scorecard.js` (the manager's Scorecard),
  `install.js`, `ladder.js`, `route.js`, `sites.js`, `report.js`, `leader.js` and `art-lead.js` (the illustration beside
  a screen's headline and an empty list's picture). What they decide lives apart in the `*-steps.js` modules
  (`back-steps`, `biz-steps`, `craft-steps`, `docs-steps`, `install-steps`, `ladder-steps`, `leader-steps`,
  `manager-steps`, `newlead-steps`, `next-steps`, `practice-steps`, `qual-steps`, `report-steps`, `route-steps`,
  `scorecard-steps`, `sites-steps`, `toast-steps`), tested under `tests/` with `node --test`. Elements are built node by node, never from a string of
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
  When a log made on an earlier day goes out, the toast says it counts for today (the server dates a log on arrival);
  a log the server answered as a repeat added nothing and is not announced.
- The board opens with no signal too (`team/sw.js`, a service worker scoped to the board's folder). Everything is asked
  of the network first, so a phone with signal always runs what the server has; only when the network fails, or a page
  load hangs past 4 s, does the copy kept from the last visit answer, and a page from the copy reads its files from the
  copy (one version, whole). It never touches `api/`, the sign-in (`auth`), the sign-out (`salir`) or the leadership
  sketches, and the only page it keeps is the board's own (when a session has ended the same address serves the
  portal's sign-in page). The first visit hands it the files already loaded and every illustration, so the next start
  without signal works. Opened from the copy on an earlier day, the app says the view is old and still logs (the log
  waits). `tests/team-sw.test.mjs` pins what it handles and keeps. To retire it, serve a `team/sw.js` that deletes the
  `cancha-` caches and calls `self.registration.unregister()`; phones pick it up on their next page load.
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
  `ALLOWED_ORIGINS`. Bodies stop at 16 KB (`PUT leads` at 12 MB). Every answer is `no-store` and `noindex`; the page
  ships with a policy that allows scripts, styles and fonts from this origin only.

### The board's illustrations

A rep's day, week and team are drawn with images made for this app (17 Nov 2026, the third look). They live in `team/art/`, and `team/art.js` says where each one is and what the page must know about it: how much of each frame of a stop is light, where the hand's 21 joints are, where the team stands on the staircase. Both are written by the art pipeline, which is kept beside the approved sample, outside this repository (`sales/team-platform/sample-v3/art/`: the prompts, `process.py`, `export_app.py`). Do not edit `team/art.js` by hand.

- A stop of the day is a strip of four frames (it waits, it starts, it happened, it is celebrated). Which frames play, and where a log lands, is decided in `team/stops.js`, away from the screen (`tests/team-stops.test.mjs`); `team/stage.js` draws it. The frames are played on a clock by `team/player.js`: one sequence at a time, and whoever waited for a sequence that another one replaces goes on instead of hanging (`tests/team-player.test.mjs`).
- The page names each image once, as a CSS variable (`--art-visit` and so on, set by `app.js`); an element picks one with `data-art` and a frame with `data-f`. The one-page copy (`tools/team-demo.mjs`) swaps `art.js` for one that carries the images inside.
- The images hold no person and no name.

## Tests

`npm test` (no dependencies).
