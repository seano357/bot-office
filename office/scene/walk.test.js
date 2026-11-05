import test from 'node:test';
import assert from 'node:assert/strict';
import { writeRoute, segmentClear, crowdScale, smoothRamp, frontPose, lingerPose, LINGER_COUNT } from './walk.js';

function pts() {
  return Array.from({ length: 16 }, () => ({ x: 0, z: 0, y: 0, yaw: 0 }));
}

test('a route stays out of the tables', () => {
  const buf = pts();
  const n = writeRoute(buf, 1.5, 1.85, { x: -3.8, z: -5.15, y: 0, yaw: 0 });
  assert.ok(n >= 2);
  for (let i = 0; i < n - 1; i++) {
    assert.equal(segmentClear(buf[i].x, buf[i].z, buf[i + 1].x, buf[i + 1].z), true, `leg ${i}`);
  }
  assert.equal(buf[n - 1].x, -3.8);
  assert.equal(buf[n - 1].z, -5.15);
});

test('a route from a desk seat reaches the front edge without a jump', () => {
  const buf = pts();
  const goal = { x: 0, z: 0, y: 0, yaw: 0 };
  frontPose(1, goal);
  const n = writeRoute(buf, -5.7, -2.35, goal);
  assert.ok(n >= 2);
  let length = 0;
  for (let i = 0; i < n - 1; i++) {
    const d = Math.hypot(buf[i + 1].x - buf[i].x, buf[i + 1].z - buf[i].z);
    assert.ok(d < 8, `leg ${i} is ${d.toFixed(2)} m`);
    assert.equal(segmentClear(buf[i].x, buf[i].z, buf[i + 1].x, buf[i + 1].z), true);
    length += d;
  }
  assert.ok(length > 2 && length < 20);
});

test('someone ahead slows the walker; someone behind does not', () => {
  const blocked = crowdScale(0, 0, 0, 1, [{ x: 0.1, z: 0.3 }]);
  assert.ok(blocked < 0.6);
  const behind = crowdScale(0, 0, 0, 1, [{ x: 0, z: -0.3 }]);
  assert.equal(behind, 1);
});

test('speed eases off at the ends of a leg', () => {
  assert.ok(smoothRamp(0.02, 2) < 0.2);
  assert.equal(smoothRamp(1, 2), 1);
  assert.ok(smoothRamp(1.95, 2) < 0.3);
});

test('linger and front poses stay on the floor', () => {
  const p = { x: 0, z: 0, y: 0, yaw: 0 };
  for (let i = 0; i < LINGER_COUNT; i++) {
    lingerPose(i, p);
    assert.ok(p.x > -7.6 && p.x < 7.6 && p.z > -5.6 && p.z < 5.2);
  }
  for (let i = 0; i < 8; i++) {
    frontPose(i, p);
    assert.ok(p.z > 2 && p.z < 5.2);
    assert.equal(p.yaw, Math.PI / 4);
  }
});
