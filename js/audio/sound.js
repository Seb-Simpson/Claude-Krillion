// Outlier — procedural sound system (Web Audio only, no files, no dependencies).
//
// Public API (see docs/SPEC.md "Sound API"):
//   unlock()                 create/resume the AudioContext (call from a user gesture)
//   play(name, opts?)        fire-and-forget; unknown names are a silent no-op
//   setMuted(bool) / isMuted()
//   setVolume(0..1) / getVolume()
//   startAmbience() / stopAmbience()
//
// Every export is safe to call in Node, before unlock, or when Web Audio is missing.
//
// Signal flow:
//   voices -> sfxBus ----------------\
//          \-> reverbSend -> convolver -> reverbReturn -> mixBus -> compressor
//   ambience voice -> ambBus --------/                                  |
//   destination <- limiter <- masterGain (volume^2 * MASTER_MAX, 0 when muted)
//
// Musical identity: everything is in D major pentatonic (D E F# A B) so any sounds
// that overlap stay consonant. Timbres are sine/triangle bells and soft plucks.

const MASTER_MAX = 0.4; // master gain at volume 1.0 (default 0.8 -> ~0.26 = -12 dBFS)
const DEFAULT_VOLUME = 0.8;
const MAX_VOICES = 96; // oscillator/noise sources alive at once; extra notes are dropped
const TYPE_MIN_GAP = 0.035; // seconds between 'type' ticks (rate limit)

let ctx = null;
let graph = null;
let unlocked = false;
let muted = false;
let volume = DEFAULT_VOLUME;
let voices = 0;
let lastType = -1;
let noiseBuf = null;
let amb = null; // running ambience voice
let wantAmbience = false; // startAmbience() before the context existed

// ---------------------------------------------------------------- context

function audioCtor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function canAutoStart() {
  // Only create a context once the page has seen a user gesture, so we never
  // trigger the browser's "AudioContext was not allowed to start" warning.
  if (unlocked) return true;
  try {
    return !!(typeof navigator !== 'undefined' && navigator.userActivation &&
      navigator.userActivation.hasBeenActive);
  } catch (_) { return false; }
}

function ensureCtx() {
  if (ctx) return ctx;
  const C = audioCtor();
  if (!C) return null;
  try {
    ctx = new C({ latencyHint: 'interactive' });
    buildGraph();
  } catch (_) {
    ctx = null;
    graph = null;
  }
  return ctx;
}

function buildGraph() {
  const mix = ctx.createGain();
  const sfx = ctx.createGain();
  const ambBus = ctx.createGain();
  ambBus.gain.value = 0.55;
  sfx.connect(mix);
  ambBus.connect(mix);

  // Small generated-impulse reverb for tails (obscure/outlier/timeout).
  const reverbSend = ctx.createGain();
  const convolver = ctx.createConvolver();
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.6;
  try { convolver.buffer = makeImpulse(2.2, 3.2); } catch (_) { /* ignore */ }
  reverbSend.connect(convolver);
  convolver.connect(reverbReturn);
  reverbReturn.connect(mix);

  // Gentle glue compressor, then volume, then a brick-wall-ish safety limiter.
  const comp = ctx.createDynamicsCompressor();
  setParam(comp.threshold, -14);
  setParam(comp.knee, 10);
  setParam(comp.ratio, 2.5);
  setParam(comp.attack, 0.004);
  setParam(comp.release, 0.25);

  const master = ctx.createGain();
  master.gain.value = targetMasterGain();

  const limiter = ctx.createDynamicsCompressor();
  setParam(limiter.threshold, -1.5);
  setParam(limiter.knee, 0);
  setParam(limiter.ratio, 20);
  setParam(limiter.attack, 0.001);
  setParam(limiter.release, 0.1);

  const meter = ctx.createAnalyser();
  meter.fftSize = 2048;

  mix.connect(comp);
  comp.connect(master);
  master.connect(limiter);
  limiter.connect(ctx.destination);
  limiter.connect(meter);

  graph = { mix, sfx, ambBus, reverbSend, master, meter, peak: 0 };
}

function setParam(p, v) { try { p.value = v; } catch (_) { /* ignore */ } }

function targetMasterGain() {
  return muted ? 0 : MASTER_MAX * volume * volume; // squared slider -> perceptual taper
}

function applyMaster() {
  if (!ctx || !graph) return;
  try {
    const p = graph.master.gain;
    const t = ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.setTargetAtTime(targetMasterGain(), t, 0.03);
  } catch (_) { /* ignore */ }
}

function makeImpulse(seconds, decayPow) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, decayPow);
      // one-pole lowpass on the noise so the tail is warm, not hissy
      lp += 0.35 * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * env;
    }
  }
  return buf;
}

function getNoise() {
  if (noiseBuf) return noiseBuf;
  const len = ctx.sampleRate; // 1 s of white noise, reused with random offsets
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

// ---------------------------------------------------------------- toolkit

const SEMIS = [0, 2, 4, 7, 9]; // major pentatonic degrees
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
// pent(0) = D4, pent(5) = D5, pent(-5) = D3 ...
const pent = (i) => {
  const oct = Math.floor(i / 5);
  const deg = ((i % 5) + 5) % 5;
  return hz(62 + 12 * oct + SEMIS[deg]);
};
const rand = (a, b) => a + Math.random() * (b - a);

// Attack/decay envelope on an AudioParam: 0 -> peak (linear) -> silence (exponential).
function env(param, t, attack, peak, decay) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  param.setValueAtTime(0, t + attack + decay + 0.01);
}

function track(src, stopAt) {
  voices++;
  src.onended = () => {
    voices = Math.max(0, voices - 1);
    try { src.disconnect(); } catch (_) { /* ignore */ }
  };
  src.start(Math.max(stopAt.start, 0));
  src.stop(stopAt.stop);
}

function withPan(node, pan) {
  if (!pan || !ctx.createStereoPanner) return node;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  node.connect(p);
  return p;
}

// A per-sound output group: dry to the sfx bus, optional send to the reverb.
function group(reverb = 0, level = 1) {
  const g = ctx.createGain();
  g.gain.value = level;
  g.connect(graph.sfx);
  if (reverb > 0) {
    const s = ctx.createGain();
    s.gain.value = reverb;
    g.connect(s);
    s.connect(graph.reverbSend);
  }
  return g;
}

/**
 * tone({ f, type, t, a, d, g, from, glide, to, det, pan, out, lp, q })
 *  f: frequency, from: start frequency gliding to f over `glide` s,
 *  to: frequency reached at the end of the decay, lp: lowpass cutoff.
 */
function tone(o) {
  if (voices >= MAX_VOICES || !o.g) return;
  const t = o.t;
  const a = o.a ?? 0.005;
  const d = o.d ?? 0.3;
  const osc = ctx.createOscillator();
  osc.type = o.type || 'sine';
  const fq = osc.frequency;
  if (o.from) {
    fq.setValueAtTime(o.from, t);
    fq.exponentialRampToValueAtTime(o.f, t + (o.glide ?? 0.06));
  } else {
    fq.setValueAtTime(o.f, t);
  }
  if (o.to) fq.exponentialRampToValueAtTime(o.to, t + a + (o.toTime ?? d));
  if (o.det) osc.detune.value = o.det;

  let node = osc;
  if (o.lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lp;
    f.Q.value = o.q ?? 0.7;
    node.connect(f);
    node = f;
  }
  const v = ctx.createGain();
  env(v.gain, t, a, o.g, d);
  node.connect(v);
  withPan(v, o.pan).connect(o.out);
  track(osc, { start: t, stop: t + a + d + 0.05 });
}

/** noise({ t, d, g, a, type, f, fTo, q, pan, panTo, out }) — filtered noise burst. */
function noise(o) {
  if (voices >= MAX_VOICES || !o.g) return;
  const t = o.t;
  const a = o.a ?? 0.005;
  const d = o.d ?? 0.1;
  const src = ctx.createBufferSource();
  src.buffer = getNoise();
  const filt = ctx.createBiquadFilter();
  filt.type = o.type || 'bandpass';
  filt.Q.value = o.q ?? 1;
  filt.frequency.setValueAtTime(o.f ?? 1000, t);
  if (o.fTo) filt.frequency.exponentialRampToValueAtTime(o.fTo, t + a + d);
  const v = ctx.createGain();
  env(v.gain, t, a, o.g, d);
  src.connect(filt);
  filt.connect(v);
  let out = v;
  if ((o.pan || o.panTo) && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(o.pan || 0, t);
    if (o.panTo !== undefined) p.pan.linearRampToValueAtTime(o.panTo, t + a + d);
    v.connect(p);
    out = p;
  }
  out.connect(o.out);
  voices++;
  src.onended = () => {
    voices = Math.max(0, voices - 1);
    try { src.disconnect(); } catch (_) { /* ignore */ }
  };
  src.start(t, Math.random() * 0.5);
  src.stop(t + a + d + 0.05);
}

/** Warm bell: fundamental + soft harmonic partials that die faster. */
function bell(f, t, g, out, d = 0.9, pan = 0) {
  tone({ f, t, a: 0.004, d, g, out, pan });
  tone({ f: f * 2, t, a: 0.003, d: d * 0.5, g: g * 0.28, out, pan });
  tone({ f: f * 3.01, t, a: 0.002, d: d * 0.28, g: g * 0.1, out, pan });
  tone({ f: f * 4.2, t, a: 0.001, d: 0.05, g: g * 0.05, out, pan }); // strike
}

/** Soft pluck: triangle body + quiet octave sine, quick decay. */
function pluck(f, t, g, out, d = 0.35, pan = 0) {
  tone({ f, type: 'triangle', t, a: 0.003, d, g, out, pan, lp: Math.min(f * 6, 9000) });
  tone({ f: f * 2, t, a: 0.002, d: d * 0.45, g: g * 0.3, out, pan });
}

/** Tiny high pings in the top pentatonic octave, scattered in time and stereo. */
function sparkles(t, n, span, g, out) {
  for (let i = 0; i < n; i++) {
    const f = pent(10 + Math.floor(Math.random() * 6)); // D6..D7
    tone({ f, t: t + Math.random() * span, a: 0.002, d: rand(0.12, 0.3), g: g * rand(0.6, 1), out, pan: rand(-0.75, 0.75) });
  }
}

/** Short low pitch-drop "thump" for weight. */
function thump(t, g, out) {
  tone({ f: 140, to: 42, toTime: 0.2, t, a: 0.004, d: 0.26, g, out });
  noise({ t, d: 0.05, g: g * 0.25, type: 'lowpass', f: 260, q: 0.7, out });
}

// ---------------------------------------------------------------- sounds

const SOUNDS = {
  click(t) {
    const o = group();
    tone({ f: 1250, from: 1700, glide: 0.02, t, a: 0.002, d: 0.045, g: 0.1, out: o });
    noise({ t, d: 0.012, g: 0.05, type: 'highpass', f: 3500, out: o });
  },

  start(t) {
    const o = group(0.25);
    [5, 7, 8, 10].forEach((n, i) => bell(pent(n), t + i * 0.075, 0.15, o, 0.7 + i * 0.12));
  },

  tick(t) {
    const o = group();
    tone({ f: 1150, t, a: 0.001, d: 0.04, g: 0.11, out: o });
    tone({ f: 580, type: 'triangle', t, a: 0.001, d: 0.03, g: 0.07, out: o });
  },

  tickUrgent(t) {
    const o = group();
    tone({ f: pent(12), t, a: 0.001, d: 0.06, g: 0.15, out: o }); // F#6
    tone({ f: pent(12) * 1.5, t, a: 0.001, d: 0.03, g: 0.05, out: o });
    tone({ f: 760, type: 'triangle', t, a: 0.001, d: 0.035, g: 0.08, out: o });
  },

  type(t) {
    if (lastType >= 0 && t - lastType < TYPE_MIN_GAP) return; // rate limit
    lastType = t;
    const o = group();
    const g = rand(0.035, 0.055);
    noise({ t, d: rand(0.012, 0.02), g, type: 'bandpass', f: rand(2600, 4200), q: 1.4, pan: rand(-0.2, 0.2), out: o });
    tone({ f: rand(1500, 2100), t, a: 0.001, d: 0.018, g: g * 0.45, out: o });
  },

  submit(t) {
    const o = group();
    tone({ f: pent(8), from: pent(5), glide: 0.06, type: 'triangle', t, a: 0.004, d: 0.12, g: 0.12, out: o });
    noise({ t, a: 0.02, d: 0.08, g: 0.04, type: 'bandpass', f: 900, fTo: 2800, q: 1.2, out: o });
  },

  near(t) {
    // curious "hmm?": a soft note, then a higher one that bends upward
    const o = group(0.12);
    tone({ f: pent(6), type: 'triangle', t, a: 0.015, d: 0.16, g: 0.14, out: o, lp: 2500 });
    tone({ f: pent(6), t, a: 0.015, d: 0.16, g: 0.06, out: o });
    const t2 = t + 0.15;
    tone({ f: pent(8), from: pent(7), glide: 0.12, type: 'triangle', t: t2, a: 0.02, d: 0.28, g: 0.15, out: o, lp: 2800 });
    tone({ f: pent(8), from: pent(7), glide: 0.12, t: t2, a: 0.02, d: 0.28, g: 0.06, out: o });
  },

  reject(t) {
    // soft, low, muted thud — no buzzer
    const o = group();
    tone({ f: 70, from: 165, glide: 0.09, t, a: 0.003, d: 0.2, g: 0.3, out: o });
    tone({ f: pent(-5), type: 'triangle', t, a: 0.004, d: 0.14, g: 0.12, out: o, lp: 420 });
    noise({ t, d: 0.06, g: 0.08, type: 'lowpass', f: 320, out: o });
  },

  'accept-crowd'(t) {
    const o = group(0.08);
    pluck(pent(5), t, 0.2, o, 0.4);
  },

  'accept-common'(t) {
    const o = group(0.1);
    pluck(pent(3), t, 0.2, o, 0.3, -0.1);
    pluck(pent(5), t + 0.09, 0.26, o, 0.45, 0.1);
  },

  'accept-uncommon'(t) {
    const o = group(0.14);
    [5, 7, 8].forEach((n, i) => pluck(pent(n), t + i * 0.075, 0.22, o, 0.4 + i * 0.1, (i - 1) * 0.15));
    bell(pent(10), t + 0.15, 0.06, o, 0.6);
  },

  'accept-rare'(t) {
    const o = group(0.22);
    [5, 7, 8].forEach((n, i) => pluck(pent(n), t + i * 0.07, 0.21, o, 0.45, (i - 1) * 0.15));
    bell(pent(10), t + 0.21, 0.2, o, 1.0);
    sparkles(t + 0.22, 4, 0.35, 0.05, o);
    noise({ t: t + 0.18, a: 0.08, d: 0.4, g: 0.025, type: 'highpass', f: 6000, out: o }); // shimmer air
  },

  'accept-obscure'(t) {
    const o = group(0.35);
    [5, 6, 7, 8, 9, 10].forEach((n, i) => pluck(pent(n), t + i * 0.055, 0.17, o, 0.4, -0.4 + i * 0.16));
    const t2 = t + 0.33;
    bell(pent(10), t2, 0.15, o, 1.2);
    bell(pent(12), t2 + 0.01, 0.09, o, 1.0, 0.2);
    sparkles(t + 0.25, 7, 0.6, 0.05, o);
    noise({ t: t + 0.2, a: 0.12, d: 0.5, g: 0.03, type: 'highpass', f: 6500, out: o });
  },

  'accept-outlier'(t) {
    // the big one: weight, rising arpeggio, whoosh into a bright bell chord, sparkles
    const o = group(0.4);
    thump(t, 0.4, o);
    [0, 2, 3, 5, 7, 8].forEach((n, i) => pluck(pent(n), t + i * 0.045, 0.15, o, 0.35, -0.5 + i * 0.2));
    noise({ t: t + 0.05, a: 0.22, d: 0.12, g: 0.06, type: 'bandpass', f: 600, fTo: 5000, q: 0.9, out: o });
    const t2 = t + 0.3;
    thump(t2, 0.22, o);
    bell(pent(5), t2, 0.13, o, 1.3, -0.25);
    bell(pent(7), t2 + 0.012, 0.1, o, 1.25, 0.25);
    bell(pent(8), t2 + 0.024, 0.1, o, 1.2, -0.1);
    bell(pent(10), t2 + 0.036, 0.12, o, 1.15, 0.1);
    tone({ f: pent(-5), t: t2, a: 0.02, d: 1.0, g: 0.12, out: o }); // warm D3 floor
    sparkles(t2 + 0.03, 10, 0.75, 0.05, o);
    noise({ t: t2, a: 0.1, d: 0.8, g: 0.03, type: 'highpass', f: 7000, out: o });
  },

  'accept-decoy'(t) {
    // playful deflating "wah-wah": two muted notes, the second sags downward
    const o = group(0.08);
    const wah = (f0, f1, start, dur, g) => {
      if (voices >= MAX_VOICES) return;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(f0, start);
      osc.frequency.exponentialRampToValueAtTime(f1, start + dur);
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = 6;
      filt.frequency.setValueAtTime(350, start);
      filt.frequency.linearRampToValueAtTime(1500, start + dur * 0.3);
      filt.frequency.exponentialRampToValueAtTime(300, start + dur);
      const v = ctx.createGain();
      env(v.gain, start, 0.02, g, dur);
      osc.connect(filt); filt.connect(v); v.connect(o);
      track(osc, { start, stop: start + dur + 0.08 });
    };
    wah(pent(2), pent(2) * 0.985, t, 0.2, 0.09);        // F#4
    wah(pent(0), pent(0) * 0.84, t + 0.24, 0.42, 0.09); // D4 sagging down
  },

  timeout(t) {
    // descending soft gong
    const o = group(0.35);
    bell(pent(3), t, 0.12, o, 0.45);
    bell(pent(1), t + 0.14, 0.12, o, 0.5);
    const t2 = t + 0.3;
    const f = pent(-5); // D3
    tone({ f, to: f * 0.97, t: t2, a: 0.01, d: 1.5, g: 0.22, out: o });
    tone({ f: f * 2.41, t: t2, a: 0.006, d: 0.8, g: 0.06, out: o });
    tone({ f: f * 3.93, t: t2, a: 0.004, d: 0.4, g: 0.03, out: o });
    noise({ t: t2, d: 0.08, g: 0.04, type: 'lowpass', f: 500, out: o });
  },

  pass(t) {
    const o = group();
    noise({ t, a: 0.06, d: 0.18, g: 0.2, type: 'bandpass', f: 1800, fTo: 500, q: 1.1, pan: 0.4, panTo: -0.4, out: o });
  },

  reveal(t) {
    const o = group(0.15);
    noise({ t, a: 0.28, d: 0.12, g: 0.08, type: 'bandpass', f: 400, fTo: 3200, q: 1, out: o });
    tone({ f: pent(5), from: pent(0), glide: 0.3, t, a: 0.25, d: 0.15, g: 0.035, out: o });
  },

  roundNext(t) {
    const o = group();
    noise({ t, a: 0.03, d: 0.11, g: 0.1, type: 'bandpass', f: 2500, fTo: 6000, q: 0.8, pan: -0.3, panTo: 0.3, out: o });
    tone({ f: pent(10), t: t + 0.1, a: 0.002, d: 0.08, g: 0.04, out: o });
  },

  complete(t, opts) {
    const score = Number(opts && opts.score);
    const s = Number.isFinite(score) ? Math.max(0, Math.min(1, score / 700)) : 0.5;
    const o = group(0.25 + s * 0.15);
    const steps = 4 + Math.round(s * 5); // 4..9 arpeggio notes
    const gap = 0.07 - s * 0.02;
    for (let i = 0; i < steps; i++) {
      pluck(pent(i * (s > 0.5 ? 1 : 2) % 12), t + i * gap, 0.14, o, 0.35, -0.4 + (0.8 * i) / steps);
    }
    const t2 = t + steps * gap + 0.04;
    if (s > 0.5) thump(t2, 0.18 + s * 0.15, o);
    bell(pent(5), t2, 0.12, o, 1.0 + s * 0.6, -0.2);
    bell(pent(8), t2 + 0.015, 0.09, o, 0.9 + s * 0.6, 0.2);
    if (s > 0.25) bell(pent(10), t2 + 0.03, 0.08 + s * 0.04, o, 0.9 + s * 0.5);
    if (s > 0.6) bell(pent(12), t2 + 0.045, 0.06, o, 0.9);
    sparkles(t2, Math.round(s * 10), 0.4 + s * 0.6, 0.045, o);
  },

  streak(t, opts) {
    const o = group(0.25);
    const n = Math.max(5, Math.min(9, 5 + Math.floor((Number(opts && opts.count) || 0) / 7)));
    for (let i = 0; i < n; i++) bell(pent(5 + i), t + i * 0.06, 0.1, o, 0.5 + i * 0.05, -0.5 + i / n);
    sparkles(t + n * 0.06, 3, 0.25, 0.04, o);
  },

  share(t) {
    const o = group(0.06);
    tone({ f: 1100, from: 380, glide: 0.035, t, a: 0.002, d: 0.08, g: 0.18, out: o });
    noise({ t, d: 0.01, g: 0.05, type: 'highpass', f: 3000, out: o });
  },
};

// ---------------------------------------------------------------- ambience

function buildAmbience() {
  const t = ctx.currentTime + 0.02;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(1, t + 1.0);
  out.connect(graph.ambBus);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  lp.Q.value = 0.8;
  lp.connect(out);

  // slow filter sweep
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.045;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 260;
  lfo.connect(lfoDepth);
  lfoDepth.connect(lp.frequency);

  // gentle breathing on level
  const breath = ctx.createGain();
  breath.gain.value = 1;
  breath.connect(lp);
  const lfo2 = ctx.createOscillator();
  lfo2.frequency.value = 0.11;
  const lfo2Depth = ctx.createGain();
  lfo2Depth.gain.value = 0.18;
  lfo2.connect(lfo2Depth);
  lfo2Depth.connect(breath.gain);

  const mk = (type, f, det, g) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = det;
    const v = ctx.createGain();
    v.gain.value = g;
    o.connect(v);
    v.connect(breath);
    return o;
  };
  const oscs = [
    mk('sawtooth', pent(-5), -7, 0.03), // D3, detuned pair
    mk('sawtooth', pent(-5), 7, 0.03),
    mk('triangle', pent(-2), 0, 0.04), // A3 — wanders around the pentatonic
  ];
  const all = [lfo, lfo2, ...oscs];
  all.forEach((o) => o.start(t));

  const wander = [pent(-2), pent(-1), pent(-3), pent(-2), pent(0)];
  let step = 0;
  const timer = setInterval(() => {
    try {
      step = (step + 1) % wander.length;
      oscs[2].frequency.setTargetAtTime(wander[step], ctx.currentTime, 1.5);
    } catch (_) { /* ignore */ }
  }, 9000);

  return { out, all, timer };
}

// ---------------------------------------------------------------- public API

export function unlock() {
  try {
    unlocked = true;
    if (!ensureCtx()) return;
    if (ctx.state !== 'running' && ctx.resume) {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
    // iOS: a silent buffer started inside the gesture fully unlocks output
    const b = ctx.createBufferSource();
    b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    b.connect(ctx.destination);
    b.start(0);
    if (wantAmbience && !amb) startAmbience();
  } catch (_) { /* ignore */ }
}

export function play(name, opts) {
  try {
    const fn = Object.prototype.hasOwnProperty.call(SOUNDS, name) ? SOUNDS[name] : null;
    if (!fn || muted) return;
    if (!ctx) {
      if (!canAutoStart() || !ensureCtx()) return;
    }
    if (ctx.state === 'suspended' && ctx.resume) {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
    fn(ctx.currentTime + 0.01, opts || {});
  } catch (_) { /* never throw from a sound */ }
}

export function setMuted(m) {
  muted = !!m;
  applyMaster();
}

export function isMuted() {
  return muted;
}

export function setVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return;
  volume = Math.max(0, Math.min(1, n));
  applyMaster();
}

export function getVolume() {
  return volume;
}

export function startAmbience() {
  try {
    wantAmbience = true;
    if (amb) return;
    if (!ctx && (!canAutoStart() || !ensureCtx())) return; // starts on unlock()
    amb = buildAmbience();
  } catch (_) { amb = null; }
}

export function stopAmbience() {
  wantAmbience = false;
  const a = amb;
  amb = null;
  if (!a || !ctx) return;
  try {
    clearInterval(a.timer);
    const t = ctx.currentTime;
    a.out.gain.cancelScheduledValues(t);
    a.out.gain.setValueAtTime(a.out.gain.value, t);
    a.out.gain.linearRampToValueAtTime(0, t + 1.0);
    a.all.forEach((o) => { try { o.stop(t + 1.1); } catch (_) { /* ignore */ } });
    setTimeout(() => { try { a.out.disconnect(); } catch (_) { /* ignore */ } }, 1300);
  } catch (_) { /* ignore */ }
}

/** Names of every available sound (handy for tooling such as sound-lab.html). */
export const SOUND_NAMES = Object.freeze(Object.keys(SOUNDS));

/**
 * Debug/metering helper: output peak (linear, 0..1+) since the last call, plus
 * context state. Used by sound-lab.html; not needed by the game.
 */
export function _meter() {
  if (!ctx || !graph) return { state: ctx ? ctx.state : 'none', peak: 0 };
  let peak = 0;
  try {
    const buf = new Float32Array(graph.meter.fftSize);
    graph.meter.getFloatTimeDomainData(buf);
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]);
      if (a > peak) peak = a;
    }
  } catch (_) { /* ignore */ }
  return { state: ctx.state, peak, voices };
}

// Auto-unlock on the first gesture, as a safety net if the app forgets to.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const evts = ['pointerdown', 'keydown', 'touchend'];
  const once = (ev) => {
    // Escape/modifier keys are not user activation in Chrome; wait for a real gesture.
    if (ev && ev.type === 'keydown' && (ev.key === 'Escape' || ev.ctrlKey || ev.metaKey || ev.altKey
      || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(ev.key))) return;
    evts.forEach((e) => window.removeEventListener(e, once, true));
    unlock();
  };
  evts.forEach((e) => window.addEventListener(e, once, { capture: true, passive: true }));
}
