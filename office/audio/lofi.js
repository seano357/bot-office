// A small lo-fi bed made in the browser: soft seventh chords, a dusty hat and kick, vinyl crackle,
// all through one low-pass. Nothing is streamed and nothing is loaded. Off until the listener presses play.
// The choice and the volume live in localStorage. The tab hiding pauses it; coming back resumes only if it was on.

const KEY = 'bothq.lofi';
const BPM = 72;
const BEAT = 60 / BPM;
// Dm9, G7, Cmaj7, Am7. Frequencies in Hz, a low cozy register.
const CHORDS = [
  [146.83, 174.61, 220.0, 261.63, 329.63],
  [196.0, 246.94, 293.66, 349.23],
  [130.81, 164.81, 196.0, 246.94],
  [110.0, 130.81, 164.81, 196.0],
];

let prefs = read();
let ctx = null, master = null, crackle = null;
let playing = false;
let timer = 0;
let next = 0;
let step = 0;
let ui = null;

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    const vol = v == null ? NaN : Number(v.vol);
    return { on: !!(v && v.on), vol: Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0.55 };
  } catch { return { on: false, vol: 0.55 }; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ } }

export function initLofi(slot) {
  if (ui) return;
  ui = build(slot || document.body);
  paint();
  const resume = () => {
    if (!prefs.on) return;
    start();
  };
  // A saved "on" still waits for a gesture. The play button is one; any later tap is another.
  ui.play.addEventListener('click', () => { prefs.on = !playing; save(); if (prefs.on) start(); else stop(); paint(); });
  addEventListener('pointerdown', resume, true);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) {
      if (playing) pauseGraph();
    } else if (prefs.on) {
      start();
    }
  });
}

function boot() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch { return false; }
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2800;
  filter.Q.value = 0.4;
  master = ctx.createGain();
  master.gain.value = prefs.vol * 0.9;
  filter.connect(master);
  master.connect(ctx.destination);
  // The filter is the destination the voices hit, so they all sit under the same low-pass.
  master._in = filter;
  crackle = makeCrackle(filter);
  return true;
}

function start() {
  if (!boot()) return;
  ctx.resume?.();
  if (playing) return;
  playing = true;
  prefs.on = true;
  save();
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(prefs.vol * 0.9, now + 0.6);
  if (crackle) crackle.gain.gain.setValueAtTime(0.018 * prefs.vol, now);
  next = now + 0.08;
  step = 0;
  clearInterval(timer);
  timer = setInterval(pump, 240);
  pump();
  paint();
}

function stop() {
  playing = false;
  prefs.on = false;
  save();
  clearInterval(timer);
  if (ctx && master) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + 0.35);
  }
  paint();
}

function pauseGraph() {
  playing = false;
  clearInterval(timer);
  if (ctx) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + 0.25);
    setTimeout(() => { if (document.hidden) ctx.suspend?.(); }, 300);
  }
  paint();
}

function pump() {
  if (!playing || !ctx) return;
  const dest = master._in;
  while (next < ctx.currentTime + 1.2) {
    const bar = Math.floor(step / 8);
    const chord = CHORDS[bar % CHORDS.length];
    const beat = step % 8;
    if (beat === 0) playChord(dest, next, chord, BEAT * 3.6);
    if (beat % 2 === 0) kick(dest, next);
    hat(dest, next, beat % 2 === 1 ? 0.45 : 0.8);
    next += BEAT / 2;
    step++;
  }
}

function playChord(dest, time, notes, dur) {
  for (const f of notes) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    o.detune.value = (Math.random() - 0.5) * 7;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.028, time + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g);
    g.connect(dest);
    o.start(time);
    o.stop(time + dur + 0.05);
  }
}

function kick(dest, time) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, time);
  o.frequency.exponentialRampToValueAtTime(48, time + 0.12);
  g.gain.setValueAtTime(0.16, time);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
  o.connect(g);
  g.connect(dest);
  o.start(time);
  o.stop(time + 0.2);
}

function hat(dest, time, amp) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 1900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.04 * amp, time);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(time);
  src.stop(time + 0.06);
}

let noiseBuf = null;
function noiseBuffer() {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function makeCrackle(dest) {
  const src = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() < 0.02 ? (Math.random() * 2 - 1) : 0;
  src.buffer = buf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1800;
  f.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start();
  return { gain: g };
}

function setVol(v) {
  prefs.vol = Math.min(1, Math.max(0, v));
  save();
  if (master && ctx) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(playing ? prefs.vol * 0.9 : 0, now + 0.05);
  }
  if (crackle && playing) crackle.gain.gain.setValueAtTime(0.018 * prefs.vol, ctx.currentTime);
  if (ui) ui.vol.setAttribute('aria-valuenow', String(Math.round(prefs.vol * 100)));
}

function paint() {
  if (!ui) return;
  ui.play.textContent = playing ? 'Pause' : 'Play';
  ui.play.setAttribute('aria-pressed', playing ? 'true' : 'false');
  ui.root.classList.toggle('is-on', playing);
}

function build(parent) {
  const root = document.createElement('div');
  root.className = 'lofi';
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'lofi-play';
  play.textContent = 'Play';
  play.setAttribute('aria-pressed', 'false');
  const label = document.createElement('span');
  label.className = 'lofi-name';
  label.textContent = 'Lo-fi';
  const vol = document.createElement('input');
  vol.type = 'range';
  vol.min = '0';
  vol.max = '100';
  vol.value = String(Math.round(prefs.vol * 100));
  vol.className = 'lofi-vol';
  vol.setAttribute('aria-label', 'Lo-fi volume');
  vol.setAttribute('aria-valuemin', '0');
  vol.setAttribute('aria-valuemax', '100');
  vol.setAttribute('aria-valuenow', vol.value);
  vol.addEventListener('input', () => setVol(Number(vol.value) / 100));
  root.append(play, label, vol);
  parent.append(root);
  return { root, play, vol };
}
