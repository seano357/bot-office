// Weekly usage history for the burn-rate card. Pure: no DOM, no storage.
//
// Bots post one usage line about four times a day:
//   {"type":"usage","total_used_pct":18.9,"resets_at":"…","bots":{"Ruby":95}}
// resets_at is the instant the weekly limit resets. The same instant shows up as an offset
// ("2026-11-09T20:33:00-05:00") or as Z ("2026-11-10T01:33:00Z"); both parse to one moment.
// `bots` is a share of that usage. On the live channel the numbers add up to about 100
// (Ruby 95 means 95% of what was used). Older lines used absolute percent-of-limit instead
// (Bot A 4.1 of a 37 total). Either way the share is this bot's number divided by the sum.
//
// The page keeps every reading it has seen, deduped, and drops anything older than the
// current reset window plus the one before it. ntfy itself only retains 12 hours.

import { parseTime } from './util.js';

export const WEEK_MS = 7 * 24 * 3600 * 1000;
const SAME_RESET_MS = 3 * 3600 * 1000;     // one reset instant, allowing a small clock wobble
const PRUNE_SLACK_MS = 36 * 3600 * 1000;   // previous window still counts across a DST shift
const DEDUPE_MS = 2 * 60 * 1000;
const RECENT_MS = 30 * 3600 * 1000;        // the burn rate is the last day or so, not the whole week
const MIN_SPAN_MS = 20 * 60 * 1000;        // two readings a minute apart are not a pace yet
export const JUMP_POINTS = 10;
export const JUMP_WINDOW_MS = 6 * 3600 * 1000; // "a few hours": the daytime gap between readings
export const HEAVY_SHARE = 0.7;

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EMPTY = Object.freeze({
  show: false,
  points: [],
  start: null,
  end: null,
  latest: null,
  pace: Object.freeze({ kind: 'empty', text: '', hit: null, finishPct: null, ratePerHour: 0 }),
  proj: null,
  jump: null,
  shares: [],
  heavy: null,
});

function num(v, max) {
  if (typeof v === 'boolean' || v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

function msOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  if (typeof v === 'string' && v) return parseTime(v);
  return null;
}

/** A stored reading, or null when the object is not one. */
export function normalizeReading(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const t = msOf(r.t);
  const total = num(r.total != null ? r.total : r.total_used_pct, 1000);
  const resets = msOf(r.resets != null ? r.resets : r.resets_at);
  if (t == null || total == null || resets == null) return null;
  const bots = Object.create(null);
  const src = r.bots && typeof r.bots === 'object' && !Array.isArray(r.bots) ? r.bots : null;
  if (src) {
    for (const [k, v] of Object.entries(src).slice(0, 40)) {
      const name = String(k).trim().slice(0, 80);
      const n = num(v, 100000);
      if (!name || name === '__proto__' || name === 'constructor' || name === 'prototype' || n == null) continue;
      bots[name] = n;
    }
  }
  return { t, total, resets, bots };
}

/** One ntfy usage line -> a reading. `timeSec` is the message time (unix seconds) when the line has no t. */
export function readingFrom(rec, timeSec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  const type = typeof rec.type === 'string' ? rec.type.toLowerCase() : '';
  if (type !== 'usage') return null;
  let t = parseTime(rec.t);
  if (t == null && timeSec != null) {
    const s = Number(timeSec);
    if (Number.isFinite(s)) t = s < 1e11 ? s * 1000 : s;
  }
  if (t == null) return null;
  return normalizeReading({ t, total: rec.total_used_pct, resets: rec.resets_at, bots: rec.bots });
}

function near(a, b) {
  return Math.abs(a.t - b.t) <= DEDUPE_MS
    && Math.abs(a.total - b.total) < 0.051
    && Math.abs(a.resets - b.resets) <= 60 * 1000;
}

function richer(a, b) {
  const ka = Object.keys(a.bots).length, kb = Object.keys(b.bots).length;
  if (kb !== ka) return kb > ka ? b : a;
  return b.t >= a.t ? b : a;
}

function readingSig(r) {
  const bots = Object.keys(r.bots).sort().map((k) => k + '=' + r.bots[k]).join(',');
  return r.t + '|' + r.total + '|' + r.resets + '|' + bots;
}

/** Collapse readings that are the same snapshot seen twice (replay, reconnect, a double post). */
export function dedupeReadings(list) {
  const sorted = (list || []).map(normalizeReading).filter(Boolean).sort((a, b) => a.t - b.t || a.total - b.total);
  const out = [];
  for (const r of sorted) {
    let i = -1;
    for (let k = out.length - 1; k >= 0; k--) { if (near(out[k], r)) { i = k; break; } }
    if (i === -1) out.push(r);
    else out[i] = richer(out[i], r);
  }
  return out;
}

/**
 * Keep the current reset window and the previous one.
 * The newest reading's resets_at is the end of the current window; a window is a week.
 */
export function pruneReadings(list) {
  const clean = dedupeReadings(list);
  if (!clean.length) return [];
  const end = clean[clean.length - 1].resets;
  const minReset = end - WEEK_MS - PRUNE_SLACK_MS;
  const minT = end - 2 * WEEK_MS - PRUNE_SLACK_MS;
  return clean.filter((r) => r.resets >= minReset && r.t >= minT).slice(-400);
}

/** Add one reading. Returns the same array when nothing changed, so the caller can skip a write. */
export function mergeReadings(prev, reading) {
  const base = Array.isArray(prev) ? prev : [];
  const add = normalizeReading(reading);
  if (!add) return base;
  const pruned = pruneReadings(base.concat([add]));
  if (pruned.length === base.length && pruned.every((r, i) => readingSig(r) === readingSig(base[i]))) return base;
  return pruned;
}

/** "Sat around 3 PM" in the viewer's local time, rounded to the nearest hour. */
export function formatHit(ms) {
  const rounded = new Date(ms);
  if (rounded.getMinutes() >= 30) rounded.setHours(rounded.getHours() + 1);
  rounded.setMinutes(0, 0, 0);
  let h = rounded.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return WEEKDAY[rounded.getDay()] + ' around ' + h + ' ' + ap;
}

function slopePerHour(points) {
  const t0 = points[0].t;
  const n = points.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) {
    const x = (p.t - t0) / 3600000;
    sx += x;
    sy += p.total;
    sxx += x * x;
    sxy += x * p.total;
  }
  const den = n * sxx - sx * sx;
  if (den === 0) return 0;
  return (n * sxy - sx * sy) / den;
}

function botShares(reading) {
  const entries = Object.entries(reading.bots).filter(([, v]) => v > 0);
  const sum = entries.reduce((s, [, v]) => s + v, 0);
  if (!(sum > 0)) return [];
  return entries
    .map(([name, v]) => {
      const share = v / sum;
      return { name, share, pct: Math.round(share * 100) };
    })
    .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
}

function paceOf(current, latest, now) {
  const blank = { hit: null, finishPct: null, ratePerHour: 0 };
  if (latest.total >= 100) return { kind: 'full', text: 'Already at 100%', ...blank, finishPct: 100 };
  if (latest.t >= latest.resets || now >= latest.resets) {
    const pct = Math.round(latest.total);
    return { kind: 'done', text: 'Finished the week at ' + pct + '%', ...blank, finishPct: pct };
  }
  if (current.length < 2) return { kind: 'need-more', text: 'Need a couple more readings', ...blank };
  const last = current[current.length - 1];
  let recent = current.filter((r) => r.t >= last.t - RECENT_MS);
  if (recent.length < 2) recent = current.slice(-2);
  if (recent[recent.length - 1].t - recent[0].t < MIN_SPAN_MS) {
    return { kind: 'need-more', text: 'Need a couple more readings', ...blank };
  }
  const rate = slopePerHour(recent);
  if (!(rate > 0)) {
    const pct = Math.round(last.total);
    return { kind: 'finish', text: 'On pace to finish the week at ' + pct + '%', hit: null, finishPct: pct, ratePerHour: rate };
  }
  const hit = last.t + ((100 - last.total) / rate) * 3600000;
  if (hit <= latest.resets) {
    return { kind: 'hit', text: 'At this pace you hit 100% ' + formatHit(hit), hit, finishPct: 100, ratePerHour: rate };
  }
  const finish = last.total + rate * ((latest.resets - last.t) / 3600000);
  const pct = Math.max(0, Math.min(100, Math.round(finish)));
  return { kind: 'finish', text: 'On pace to finish the week at ' + pct + '%', hit: null, finishPct: pct, ratePerHour: rate };
}

function jumpOf(current) {
  if (current.length < 2) return null;
  const a = current[current.length - 2];
  const b = current[current.length - 1];
  const ms = b.t - a.t;
  const points = b.total - a.total;
  if (points >= JUMP_POINTS && ms > 0 && ms <= JUMP_WINDOW_MS) return { points, ms };
  return null;
}

/**
 * Everything the card draws from the readings it has.
 * `now` is ms (the page clock). Times in the sentence are local.
 */
export function analyzeUsage(readings, now = Date.now()) {
  const clean = pruneReadings(readings || []);
  if (!clean.length) return EMPTY;
  const latest = clean[clean.length - 1];
  const end = latest.resets;
  const start = end - WEEK_MS;
  const current = clean.filter((r) => Math.abs(r.resets - end) <= SAME_RESET_MS && r.t >= start - SAME_RESET_MS);
  const points = current.map((r) => ({ t: r.t, total: r.total }));
  const pace = paceOf(current, latest, now);
  let proj = null;
  if (pace.kind === 'hit' && pace.hit != null) proj = { t: pace.hit, total: 100 };
  else if (pace.kind === 'finish' && pace.ratePerHour > 0) {
    const raw = latest.total + pace.ratePerHour * ((end - latest.t) / 3600000);
    proj = { t: end, total: Math.max(0, raw) };
  } else if (pace.kind === 'finish') proj = { t: end, total: latest.total };
  const shares = botShares(latest);
  const heavy = shares.find((s) => s.share >= HEAVY_SHARE) || null;
  return {
    show: true,
    points,
    start,
    end,
    latest,
    pace,
    proj,
    jump: jumpOf(current),
    shares,
    heavy,
  };
}
