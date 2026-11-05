// Replay a journal of office lines into a StateStore. feed.js uses the same roster rule
// (newest list by timestamp wins; everyone else is dropped and stays dropped).
import { StateStore, botIdFor } from './state.js';
import { mergeReadings, readingFrom } from './usage.js';

/** Drop per-bot usage names that the current roster does not include. No roster: leave the history alone. */
export function filterRosterReadings(hist, roster) {
  if (!roster) return hist || [];
  return (hist || []).map((r) => ({
    ...r,
    bots: Object.fromEntries(Object.entries(r.bots || {}).filter(([name]) => roster.ids.has(botIdFor(name)))),
  }));
}

export function pruneRoutines(routines, roster) {
  if (!roster) return;
  for (const id of [...routines.keys()]) if (!roster.ids.has(id)) routines.delete(id);
}

/**
 * Play records in the order given (not sorted). Each record is a JSON object with `t`,
 * or `{ message, time }` like a cached ntfy line. `nowMs` is the page clock.
 */
export function playLines(lines, nowMs = Date.now()) {
  const store = new StateStore({ now: () => nowMs, tz: 'UTC', hasAvatar: () => false });
  const routines = new Map();
  const cfg = {};
  let usageHist = [];
  for (const line of lines || []) {
    const rec = line && typeof line.message === 'string' ? JSON.parse(line.message) : line;
    if (!rec || typeof rec !== 'object') continue;
    const time = Number(line.time) || (Number.isFinite(Date.parse(rec.t)) ? Date.parse(rec.t) / 1000 : nowMs / 1000);
    const t = typeof rec.t === 'string' ? rec.t : new Date(time * 1000).toISOString();
    usageHist = applyJournalRecord({ store, routines, cfg, usageHist }, { ...rec, t }, time);
  }
  store.commit();
  const state = store.snapshot();
  const allow = store.roster && store.roster.ids;
  state.routines = [...routines].flatMap(([bot, { name, items }]) => (items || []).map((r) => ({
    bot, name, routine: r.routine || r.name, schedule: r.schedule || '', next_run: r.next_run || null,
  }))).filter((r) => r.routine && (!allow || allow.has(r.bot)));
  state.usageReadings = filterRosterReadings(usageHist, store.roster);
  state.finished = [];
  return state;
}

function applyJournalRecord(ctx, rec, time) {
  const { store, routines, cfg } = ctx;
  let { usageHist } = ctx;
  if (Array.isArray(rec.roster)) {
    const ms = Number.isFinite(Date.parse(rec.t)) ? Date.parse(rec.t) : time * 1000;
    store.setRoster(rec.roster, ms);
    pruneRoutines(routines, store.roster);
    return usageHist;
  }
  if (rec.looks && typeof rec.looks === 'object' && !Array.isArray(rec.looks)) {
    for (const [name, look] of Object.entries(rec.looks)) (cfg[name] ||= {}).look = look;
    store.setBotsConfig(cfg);
    return usageHist;
  }
  if (rec.groups && typeof rec.groups === 'object' && !Array.isArray(rec.groups)) {
    for (const [name, team] of Object.entries(rec.groups)) if (typeof team === 'string' && team.trim()) (cfg[name] ||= {}).floor = team.trim();
    store.setBotsConfig(cfg);
    return usageHist;
  }
  if (rec.chat && typeof rec.chat === 'object' && !Array.isArray(rec.chat)) {
    for (const [name, url] of Object.entries(rec.chat)) if (typeof url === 'string') (cfg[name] ||= {}).chat_url = url;
    store.setBotsConfig(cfg);
    return usageHist;
  }
  if (rec.routines && typeof rec.routines === 'object' && !Array.isArray(rec.routines)) {
    const name = typeof rec.routines.bot === 'string' ? rec.routines.bot.trim() : '';
    if (!name || !Array.isArray(rec.routines.items)) return usageHist;
    const id = botIdFor(name);
    if (store.roster && !store.roster.ids.has(id)) return usageHist;
    const items = rec.routines.items.filter((r) => r && (r.name || r.routine)).map((r) => ({
      routine: String(r.name ?? r.routine ?? ''), schedule: String(r.schedule ?? ''), next_run: r.next_run ?? null,
    }));
    routines.set(id, { name, items });
    return usageHist;
  }
  if (String(rec.type || '').toLowerCase() === 'usage') {
    const reading = readingFrom(rec, time);
    if (reading) usageHist = mergeReadings(usageHist, reading);
  }
  store.apply(rec);
  return usageHist;
}
