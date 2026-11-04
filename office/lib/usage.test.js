import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readingFrom, mergeReadings, pruneReadings, analyzeUsage, formatHit, WEEK_MS,
} from './usage.js';

const RESET_Z = '2026-11-10T01:33:00.000Z';
const RESET_OFFSET = '2026-11-09T20:33:00-05:00';
const RESET_MS = Date.parse(RESET_Z);
const PREV_MS = RESET_MS - WEEK_MS;
const OLD_MS = RESET_MS - 2 * WEEK_MS;

function at(iso, total, bots, resets = RESET_Z) {
  return readingFrom({ type: 'usage', total_used_pct: total, resets_at: resets, bots }, Date.parse(iso) / 1000);
}

test('offset and Z resets are the same instant', () => {
  const a = readingFrom({ type: 'usage', total_used_pct: 11.1, resets_at: RESET_OFFSET, bots: { Ruby: 97 } }, 1793711006);
  const b = readingFrom({ type: 'usage', total_used_pct: 18.9, resets_at: RESET_Z, bots: { Ruby: 95 } }, 1793743423);
  assert.equal(a.resets, Date.parse(RESET_Z));
  assert.equal(b.resets, a.resets);
  assert.equal(a.t, 1793711006 * 1000);
});

test('non-usage lines and broken readings are dropped', () => {
  assert.equal(readingFrom({ bot: 'Ruby', status: 'idle' }, 1793711006), null);
  assert.equal(readingFrom({ type: 'usage', total_used_pct: 'nope', resets_at: RESET_Z }, 1793711006), null);
  assert.equal(readingFrom({ type: 'usage', total_used_pct: 10, resets_at: 'soon' }, 1793711006), null);
  assert.equal(readingFrom({ type: 'Usage', total_used_pct: '12.5', resets_at: RESET_OFFSET, bots: { Ruby: '95' } }, 1793711006).total, 12.5);
});

test('dedupes a replay and keeps both ends of a real gap', () => {
  const first = at('2026-11-04T13:00:00Z', 11.1, { Ruby: 97 });
  const replay = { ...first, bots: { Ruby: 97, 'Stock Trade Automater': 3 } };
  const later = at('2026-11-04T18:00:00Z', 15.5, { Ruby: 96 });
  let h = mergeReadings([], first);
  h = mergeReadings(h, replay);
  h = mergeReadings(h, later);
  assert.equal(h.length, 2);
  assert.deepEqual(Object.keys(h[0].bots).sort(), ['Ruby', 'Stock Trade Automater']);
  const again = mergeReadings(h, first);
  assert.equal(again, h);
});

test('prunes to this reset window plus the previous one', () => {
  const cur = at('2026-11-04T18:00:00Z', 19, { Ruby: 95 }, RESET_Z);
  const prev = at('2026-10-29T18:00:00Z', 80, { Ruby: 40 }, new Date(PREV_MS).toISOString());
  const older = at('2026-10-22T18:00:00Z', 70, { Ruby: 40 }, new Date(OLD_MS).toISOString());
  const kept = pruneReadings([older, prev, cur]);
  assert.deepEqual(kept.map((r) => r.total), [80, 19]);
});

test('one reading asks for another', () => {
  const view = analyzeUsage([at('2026-11-04T13:00:00Z', 11.1, { Ruby: 97 })], Date.parse('2026-11-04T14:00:00Z'));
  assert.equal(view.pace.kind, 'need-more');
  assert.equal(view.pace.text, 'Need a couple more readings');
  assert.equal(view.proj, null);
});

test('two readings a minute apart are not a pace yet', () => {
  const a = at('2026-11-04T13:00:00Z', 11, { Ruby: 90 });
  const b = at('2026-11-04T13:05:00Z', 14, { Ruby: 90 });
  const view = analyzeUsage([a, b], Date.parse('2026-11-04T13:06:00Z'));
  assert.equal(view.pace.kind, 'need-more');
});

test('a steep recent pace names the hour it runs out', () => {
  const a = at('2026-11-04T13:00:00Z', 20, { Ruby: 50 });
  const b = at('2026-11-04T23:00:00Z', 60, { Ruby: 50 });
  const now = Date.parse('2026-11-04T23:30:00Z');
  const view = analyzeUsage([a, b], now);
  assert.equal(view.pace.kind, 'hit');
  assert.ok(view.pace.hit < RESET_MS);
  assert.equal(view.pace.text, 'At this pace you hit 100% ' + formatHit(view.pace.hit));
  assert.equal(view.proj.total, 100);
});

test('a gentle pace finishes the week under the limit', () => {
  // 0.2 points an hour, 90 hours left: 12 + 18 = 30.
  const resets = '2026-11-08T04:00:00.000Z';
  const a = at('2026-11-04T00:00:00Z', 10, { A: 1, B: 1 }, resets);
  const b = at('2026-11-04T10:00:00Z', 12, { A: 1, B: 1 }, resets);
  const view = analyzeUsage([a, b], Date.parse('2026-11-04T11:00:00Z'));
  assert.equal(view.pace.kind, 'finish');
  assert.equal(view.pace.text, 'On pace to finish the week at 30%');
  assert.ok(view.proj.total < 100);
});

test('a flat week stays at the current percent', () => {
  const a = at('2026-11-03T12:00:00Z', 19, { Ruby: 50 });
  const b = at('2026-11-04T12:00:00Z', 19, { Ruby: 50 });
  const view = analyzeUsage([a, b], Date.parse('2026-11-04T13:00:00Z'));
  assert.equal(view.pace.text, 'On pace to finish the week at 19%');
});

test('already at the limit, and a week that has reset', () => {
  const full = analyzeUsage([
    at('2026-11-04T08:00:00Z', 90, {}),
    at('2026-11-04T14:00:00Z', 100, {}),
  ], Date.parse('2026-11-04T15:00:00Z'));
  assert.equal(full.pace.text, 'Already at 100%');

  const over = analyzeUsage([
    at('2026-11-08T12:00:00Z', 40, {}),
  ], RESET_MS + 60 * 1000);
  assert.equal(over.pace.text, 'Finished the week at 40%');
});

test('the real Wednesday readings project from the recent slope', () => {
  // The three lines on the live channel, 4 Nov 2026: 11.1 → 15.5 → 18.9, Ruby ~95.
  const lines = [
    [{ total_used_pct: 11.1, bots: { Ruby: 97, 'Stock Trade Automater': 3 } }, 1793711006],
    [{ total_used_pct: 15.5, bots: { Ruby: 97, 'Stock Trade Automater': 3 } }, 1793728928],
    [{ total_used_pct: 18.9, bots: { Ruby: 95, 'Stock Trade Automater': 3, 'Roughwire Marketing': 2 }, resets_at: RESET_Z }, 1793743423],
  ].map(([body, t]) => readingFrom({ type: 'usage', resets_at: RESET_OFFSET, ...body }, t));
  const view = analyzeUsage(lines, lines[2].t + 5 * 60 * 1000);
  assert.equal(view.points.length, 3);
  assert.equal(view.heavy.name, 'Ruby');
  assert.equal(view.heavy.pct, 95);
  assert.equal(view.jump, null);
  assert.ok(view.pace.kind === 'hit' || view.pace.kind === 'finish');
  if (view.pace.kind === 'hit') {
    assert.equal(view.pace.text, 'At this pace you hit 100% ' + formatHit(view.pace.hit));
    assert.ok(view.pace.hit > lines[2].t && view.pace.hit <= RESET_MS);
  }
});

test('a 10 point jump inside a few hours is an alert, a slow one is not', () => {
  const base = at('2026-11-04T14:00:00Z', 15, { Ruby: 95, Other: 5 });
  const sharp = analyzeUsage([base, at('2026-11-04T18:00:00Z', 27, { Ruby: 95, Other: 5 })], Date.parse('2026-11-04T18:10:00Z'));
  assert.ok(sharp.jump);
  assert.ok(sharp.jump.points >= 10);
  assert.ok(sharp.jump.ms <= 6 * 3600 * 1000);

  const overnight = analyzeUsage([base, at('2026-11-05T02:00:00Z', 27, { Ruby: 95, Other: 5 })], Date.parse('2026-11-05T02:10:00Z'));
  assert.equal(overnight.jump, null);

  const small = analyzeUsage([base, at('2026-11-04T16:00:00Z', 24.9, { Ruby: 95, Other: 5 })], Date.parse('2026-11-04T16:10:00Z'));
  assert.equal(small.jump, null);
});

test('per-bot share treats weights and absolute percents the same way', () => {
  const shares = analyzeUsage([
    at('2026-11-04T12:00:00Z', 11, { Ruby: 90 }),
    at('2026-11-04T18:00:00Z', 37, { 'Bot A': 9.5, 'Bot B': 27.5 }),
  ], Date.parse('2026-11-04T19:00:00Z'));
  const b = shares.shares.find((s) => s.name === 'Bot B');
  assert.equal(b.pct, 74);
  assert.equal(shares.heavy.name, 'Bot B');
  assert.ok(shares.shares.every((s) => s.share < 1));
});

test('formatHit rounds to the local hour', () => {
  const almost = new Date(2026, 10, 7, 14, 29, 0).getTime();
  const next = new Date(2026, 10, 7, 14, 30, 0).getTime();
  const late = new Date(2026, 10, 7, 23, 40, 0).getTime();
  assert.equal(formatHit(almost), 'Sat around 2 PM');
  assert.equal(formatHit(next), 'Sat around 3 PM');
  assert.equal(formatHit(late), 'Sun around 12 AM');
});
