import test from 'node:test';
import assert from 'node:assert/strict';
import { StateStore, botIdFor } from './state.js';
import { playLines } from './journal.js';

const NOW = Date.parse('2026-11-04T19:00:00Z');
const OLD = ['Ruby', 'Finance Bot', 'Stock Trade Automater', 'Roughwire Marketing', 'Office Manager'];
const NEXT = ['Ruby', 'Finance', 'Trading', 'Roughwire Marketing', 'Office Manager'];

test('without a roster, bots stay additive', () => {
  const store = new StateStore({ now: () => NOW, tz: 'UTC' });
  store.apply({ t: '2026-11-04T09:00:00Z', bot: 'Finance Bot', status: 'idle', step: 'waiting' });
  store.apply({ t: '2026-11-04T09:01:00Z', bot: 'Finance', status: 'idle', step: 'waiting' });
  const names = Object.values(store.snapshot().bots).map((b) => b.name).sort();
  assert.deepEqual(names, ['Finance', 'Finance Bot']);
});

test('the newest roster is who is on the floor after a rename', () => {
  const lines = [
    { t: '2026-11-04T09:00:00Z', bot: 'Finance Bot', status: 'waiting_user', step: 'Need a budget OK' },
    { t: '2026-11-04T09:00:00Z', bot: 'Stock Trade Automater', status: 'idle', step: 'Daily paper check done' },
    { t: '2026-11-04T09:00:00Z', bot: 'Ruby', status: 'waiting_user', step: 'Waiting for Claude retest #11 results' },
    { t: '2026-11-04T09:00:00Z', bot: 'Office Manager', status: 'working', step: 'Building the usage card' },
    { t: '2026-11-04T09:00:00Z', bot: 'Roughwire Marketing', status: 'error', step: 'Market data feed timed out' },
    { t: '2026-11-04T09:30:00Z', groups: { 'Finance Bot': 'Finance', 'Stock Trade Automater': 'Finance', Finance: 'Finance', Trading: 'Finance', Ruby: 'Ops', 'Office Manager': 'Ops', 'Roughwire Marketing': 'Roughwire' } },
    { t: '2026-11-04T10:05:00Z', roster: OLD },
    { t: '2026-11-04T10:06:00Z', routines: { bot: 'Finance Bot', items: [{ name: 'Old close', schedule: 'Fridays', next_run: '2026-11-06T16:00:00Z' }] } },
    { t: '2026-11-04T10:06:00Z', routines: { bot: 'Stock Trade Automater', items: [{ name: 'Old paper', schedule: 'daily', next_run: '2026-11-05T07:30:00Z' }] } },
    // The new roster is not the last record. An older roster and a late status line follow it.
    { t: '2026-11-04T16:00:00Z', roster: NEXT },
    { t: '2026-11-04T16:03:00Z', routines: { bot: 'Finance', items: [{ name: 'Weekly close', schedule: 'Fridays', next_run: '2026-11-06T16:00:00Z' }] } },
    { t: '2026-11-04T16:03:30Z', routines: { bot: 'Trading', items: [{ name: 'Daily paper', schedule: 'weekdays 07:30', next_run: '2026-11-05T07:30:00Z' }] } },
    { t: '2026-11-04T16:05:00Z', bot: 'Finance', status: 'idle', step: 'Waiting for next request' },
    { t: '2026-11-04T16:06:00Z', bot: 'Trading', status: 'idle', step: 'Daily paper check done' },
    { t: '2026-11-04T16:30:00Z', type: 'usage', total_used_pct: 19, period: 'week', resets_at: '2026-11-10T00:00:00Z', bots: { 'Finance Bot': 10, Finance: 9, Trading: 4, Ruby: 6 } },
    { t: '2026-11-04T18:00:00Z', bot: 'Finance Bot', status: 'waiting_user', step: 'Need a budget OK' },
    { t: '2026-11-04T10:05:00Z', roster: OLD },
  ];
  const state = playLines(lines, NOW);
  const names = Object.values(state.bots).map((b) => b.name).sort();
  assert.deepEqual(names, ['Finance', 'Office Manager', 'Roughwire Marketing', 'Ruby', 'Trading']);

  const financeFloor = state.floors.find((f) => f.name === 'Finance');
  assert.deepEqual(financeFloor.bots.map((id) => state.bots[id].name).sort(), ['Finance', 'Trading']);
  assert.equal(state.feed.some((f) => f.name === 'Finance Bot' || f.name === 'Stock Trade Automater'), false);
  assert.equal(state.bots[botIdFor('Finance')].usage_pct, 9);
  assert.equal(state.bots[botIdFor('Trading')].usage_pct, 4);
  assert.ok(state.meta.skipped >= 1);

  const routineBots = [...new Set(state.routines.map((r) => r.name))].sort();
  assert.deepEqual(routineBots, ['Finance', 'Trading']);
  const shareNames = Object.keys(state.usageReadings.at(-1).bots).sort();
  assert.deepEqual(shareNames, ['Finance', 'Ruby', 'Trading']);

  const waiting = Object.values(state.bots).filter((b) => b.effective_status === 'waiting_user').map((b) => b.name);
  assert.deepEqual(waiting, ['Ruby']);
});
