#!/usr/bin/env node
// alerts-config.mjs: sets the speed-to-lead alerts on the live service without printing any secret.
//
//   node tools/alerts-config.mjs show                 current config (token shown as "set") and the alert list
//   node tools/alerts-config.mjs set test|live|off    push mode, reps and routes
//
// Reads the bot token and Claudio's Slack id from ~/.config/mirentor/slack.env, the admin token (DESK_PUSH_TOKEN) from
// ~/.config/mirentor/desk.env, the reps' Slack ids from desk/routines/sales-checkin/team.json and the routes from
// desk/routines/lead-alerts/routes.json.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const BASE = process.env.WAITLIST_BASE || 'https://mirentor-waitlist.onrender.com';
// The team and the routes stay out of this repo (it is public): both are read from the desk folder.
// The desk is the first folder up from here that holds desk/routines (works from the repo and from a worktree).
const findDesk = (d) => (existsSync(path.join(d, 'desk/routines')) ? path.join(d, 'desk/routines') : d === path.dirname(d) ? null : findDesk(path.dirname(d)));
const DESK = process.env.DESK_DIR || findDesk(import.meta.dirname);
const TEAM = path.join(DESK, 'sales-checkin/team.json');
// routes.json: { "<city as the Cities tab spells it>": ["<rep key in team.json>", ...] }, rotation order, next = backup.
const ROUTES = JSON.parse(readFileSync(path.join(DESK, 'lead-alerts/routes.json'), 'utf8')).routes;

const env = (file) => Object.fromEntries(readFileSync(path.join(homedir(), '.config/mirentor', file), 'utf8').split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; }));

const admin = env('desk.env').DESK_PUSH_TOKEN;
const call = async (p, init = {}) => {
  const r = await fetch(`${BASE}${p}`, { ...init, headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' } });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const [cmd, mode] = process.argv.slice(2);
if (cmd === 'show') {
  console.log(JSON.stringify(await call('/api/alerts/config'), null, 2));
  const list = await call('/api/alerts');
  for (const a of list.body?.alerts || []) console.log(`${a.leadId} ${a.city} ${a.stage} primary=${a.primary} backup=${a.backup} takenBy=${a.takenBy || ''} mode=${a.mode}`);
} else if (cmd === 'set' && ['test', 'live', 'off'].includes(mode)) {
  const slack = env('slack.env');
  const team = JSON.parse(readFileSync(TEAM, 'utf8')).reps;
  const keys = [...new Set(Object.values(ROUTES).flat())];
  const reps = Object.fromEntries(keys.map((k) => [k, { name: team[k].name.split(' ')[0], slack: team[k].slack_id }]));
  const r = await call('/api/alerts/config', { method: 'PUT', body: JSON.stringify({ mode, slackToken: slack.SLACK_BOT_TOKEN, claudio: slack.SLACK_USER_ID, reps, routes: ROUTES }) });
  console.log(r.status, JSON.stringify(r.body));
} else {
  console.log('usage: node tools/alerts-config.mjs show | set test|live|off');
  process.exit(1);
}
