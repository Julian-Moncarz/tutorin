let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Helper: schedule one note (additive sine + optional triangle partial) with ADSR.
function scheduleNote(
  ac: AudioContext,
  freq: number,
  start: number,
  dur: number,
  gain: number,
  opts: { type?: OscillatorType; partial?: boolean; filterHz?: number } = {}
) {
  const type = opts.type ?? 'sine';
  const end = start + dur;

  const bus = opts.filterHz ? ac.createBiquadFilter() : null;
  if (bus) {
    bus.type = 'lowpass';
    bus.frequency.value = opts.filterHz!;
    bus.Q.value = 0.4;
    bus.connect(ac.destination);
  }
  const dest: AudioNode = bus ?? ac.destination;

  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + Math.min(0.04, dur * 0.15));
  g.gain.linearRampToValueAtTime(gain * 0.55, start + dur * 0.55);
  g.gain.exponentialRampToValueAtTime(0.001, end);
  o.connect(g).connect(dest);
  o.start(start);
  o.stop(end + 0.02);

  if (opts.partial) {
    const p = ac.createOscillator();
    p.type = 'triangle';
    p.frequency.value = freq * 2;
    const pg = ac.createGain();
    pg.gain.setValueAtTime(0, start);
    pg.gain.linearRampToValueAtTime(gain * 0.2, start + 0.03);
    pg.gain.exponentialRampToValueAtTime(0.001, start + dur * 0.7);
    p.connect(pg).connect(dest);
    p.start(start);
    p.stop(start + dur * 0.75);
  }
}

function noiseBuffer(ac: AudioContext, duration: number): AudioBuffer {
  const buffer = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * duration)), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Warm major-triad arpeggio when ✅ appears in the tutor's reply.
// Sine waves through a gentle lowpass, ~900ms total. Nice, not piercing.
export function playCorrectChime(): void {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;

  // C major triad ascending: C5, E5, G5, C6
  const notes: [number, number][] = [
    [523.25, 0.0],
    [659.25, 0.1],
    [783.99, 0.2],
    [1046.5, 0.32],
  ];

  // Shared soft lowpass keeps the tone mellow
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  lp.Q.value = 0.6;
  lp.connect(ac.destination);

  notes.forEach(([freq, delay], i) => {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;

    // A quieter triangle partial an octave up for a touch of shimmer
    const p = ac.createOscillator();
    p.type = 'triangle';
    p.frequency.value = freq * 2;

    const g = ac.createGain();
    const t0 = now + delay;
    const peak = 0.11 - i * 0.012; // slightly softer as we ascend
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.025);
    g.gain.linearRampToValueAtTime(peak * 0.55, t0 + 0.18);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);

    const pg = ac.createGain();
    pg.gain.setValueAtTime(0, t0);
    pg.gain.linearRampToValueAtTime(peak * 0.18, t0 + 0.03);
    pg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);

    o.connect(g).connect(lp);
    p.connect(pg).connect(lp);
    o.start(t0);
    p.start(t0);
    o.stop(t0 + 0.65);
    p.stop(t0 + 0.45);
  });
}

// Rising pitch sweep synced to the bar fill animation (~900ms).
// Bigger jump on correct → starts higher, louder. Small nudge on wrong → softer.
export function playBarRise(correct: boolean): void {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;
  const duration = correct ? 0.9 : 0.75;
  const peakGain = correct ? 0.09 : 0.085;
  const startFreq = correct ? 440 : 520;
  const endFreq = correct ? 880 : 660;

  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(startFreq, now);
  o.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

  const g = ac.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(peakGain, now + 0.1);
  g.gain.linearRampToValueAtTime(peakGain * 0.7, now + duration * 0.75);
  g.gain.exponentialRampToValueAtTime(0.001, now + duration);

  // Slight lowpass to keep it soft, not piercing
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;

  o.connect(lp).connect(g).connect(ac.destination);
  o.start(now);
  o.stop(now + duration + 0.02);

  if (correct) {
    // Add a perfect fifth harmonic, quieter, for body
    const h = ac.createOscillator();
    h.type = 'sine';
    h.frequency.setValueAtTime(startFreq * 1.5, now);
    h.frequency.exponentialRampToValueAtTime(endFreq * 1.5, now + duration);
    const hg = ac.createGain();
    hg.gain.setValueAtTime(0, now);
    hg.gain.linearRampToValueAtTime(peakGain * 0.5, now + 0.12);
    hg.gain.exponentialRampToValueAtTime(0.001, now + duration);
    h.connect(hg).connect(ac.destination);
    h.start(now);
    h.stop(now + duration + 0.02);
  }
}

export function playPeel(correct: boolean): void {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;

  // 1. Crinkle: filtered noise during the pull (0 – 320ms)
  const crinkle = ac.createBufferSource();
  crinkle.buffer = noiseBuffer(ac, 0.32);
  const crinkleFilter = ac.createBiquadFilter();
  crinkleFilter.type = 'bandpass';
  crinkleFilter.frequency.value = 3200;
  crinkleFilter.Q.value = 0.9;
  const crinkleGain = ac.createGain();
  crinkleGain.gain.setValueAtTime(0, now);
  crinkleGain.gain.linearRampToValueAtTime(0.06, now + 0.04);
  crinkleGain.gain.linearRampToValueAtTime(0.025, now + 0.32);
  crinkle.connect(crinkleFilter).connect(crinkleGain).connect(ac.destination);
  crinkle.start(now);
  crinkle.stop(now + 0.32);

  // 2. Rip: filter sweep noise, the tear (180 – 400ms)
  const rip = ac.createBufferSource();
  rip.buffer = noiseBuffer(ac, 0.22);
  const ripFilter = ac.createBiquadFilter();
  ripFilter.type = 'bandpass';
  ripFilter.frequency.setValueAtTime(700, now + 0.18);
  ripFilter.frequency.exponentialRampToValueAtTime(3800, now + 0.38);
  ripFilter.Q.value = 1.8;
  const ripGain = ac.createGain();
  ripGain.gain.setValueAtTime(0, now + 0.18);
  ripGain.gain.linearRampToValueAtTime(0.18, now + 0.24);
  ripGain.gain.linearRampToValueAtTime(0, now + 0.4);
  rip.connect(ripFilter).connect(ripGain).connect(ac.destination);
  rip.start(now + 0.18);
  rip.stop(now + 0.4);

  // 3. Snap: low sine thunk (400 – 500ms)
  const snap = ac.createOscillator();
  snap.type = 'sine';
  snap.frequency.setValueAtTime(150, now + 0.4);
  snap.frequency.exponentialRampToValueAtTime(55, now + 0.48);
  const snapGain = ac.createGain();
  snapGain.gain.setValueAtTime(0.28, now + 0.4);
  snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  snap.connect(snapGain).connect(ac.destination);
  snap.start(now + 0.4);
  snap.stop(now + 0.52);

}

// ─────────────────────────────────────────────────────────────────────────────
// Tier-complete celebration sounds. Scale up in grandeur from 1 → 3.
// ─────────────────────────────────────────────────────────────────────────────

// Tier 1 complete — bright arpeggio flourish, ~2s.
// C major up + a ringing bell top note.
export function playTier1Complete(): void {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;

  // Ascending run: C5, E5, G5, C6, E6
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
  notes.forEach((f, i) => {
    scheduleNote(ac, f, now + i * 0.09, 0.55, 0.1, { type: 'sine', partial: true, filterHz: 4000 });
  });

  // Sustained C-major triad pad underneath for body
  [261.63, 329.63, 392.0].forEach((f) => {
    scheduleNote(ac, f, now + 0.12, 1.6, 0.055, { type: 'triangle', filterHz: 2200 });
  });

  // Ringing bell on the top
  scheduleNote(ac, 2093, now + 0.5, 1.4, 0.05, { type: 'sine' });

  // Subtle high sparkle sweep
  const spk = ac.createOscillator();
  spk.type = 'sine';
  spk.frequency.setValueAtTime(2400, now);
  spk.frequency.exponentialRampToValueAtTime(4200, now + 0.35);
  const sg = ac.createGain();
  sg.gain.setValueAtTime(0, now);
  sg.gain.linearRampToValueAtTime(0.03, now + 0.04);
  sg.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  spk.connect(sg).connect(ac.destination);
  spk.start(now);
  spk.stop(now + 0.55);
}

// Tier 2 complete — brassy triumphant fanfare, ~4.5s.
export function playTier2Complete(): void {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;

  // Fanfare: F4 F4 F4 Bb4 → D5 → F5 held. Sawtooth + soft lowpass = brass.
  const fanfare: [number, number, number][] = [
    // freq, startOffset, duration
    [349.23, 0.0, 0.22],
    [349.23, 0.25, 0.22],
    [349.23, 0.5, 0.22],
    [466.16, 0.75, 0.4],
    [587.33, 1.2, 0.5],
    [698.46, 1.75, 1.8],
  ];
  fanfare.forEach(([f, s, d]) => {
    scheduleNote(ac, f, now + s, d, 0.09, { type: 'sawtooth', filterHz: 1800 });
    // Brass fifth harmonic for richness
    scheduleNote(ac, f * 1.5, now + s, d, 0.04, { type: 'sawtooth', filterHz: 2400 });
  });

  // Sustained pad: F major triad opens up under the held F5
  [174.61, 220.0, 261.63, 349.23].forEach((f) => {
    scheduleNote(ac, f, now + 1.6, 2.6, 0.05, { type: 'triangle', filterHz: 1600 });
  });

  // Bell shimmer on the held note
  [1396.91, 1760.0, 2093.0].forEach((f, i) => {
    scheduleNote(ac, f, now + 1.9 + i * 0.12, 1.8, 0.04, { type: 'sine' });
  });

  // Cymbal-ish swell: filtered noise rising then dropping
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuffer(ac, 1.2);
  const nf = ac.createBiquadFilter();
  nf.type = 'highpass';
  nf.frequency.setValueAtTime(3000, now + 1.5);
  nf.frequency.exponentialRampToValueAtTime(8000, now + 2.2);
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0, now + 1.5);
  ng.gain.linearRampToValueAtTime(0.07, now + 1.9);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 2.7);
  noise.connect(nf).connect(ng).connect(ac.destination);
  noise.start(now + 1.5);
  noise.stop(now + 2.7);
}

// Tier 3 complete — grand mastery fanfare, ~7s.
export function playTier3Complete(): void {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;

  // Low timpani-ish thud to open
  const thud = ac.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(90, now);
  thud.frequency.exponentialRampToValueAtTime(40, now + 0.5);
  const tg = ac.createGain();
  tg.gain.setValueAtTime(0.4, now);
  tg.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  thud.connect(tg).connect(ac.destination);
  thud.start(now);
  thud.stop(now + 0.65);

  // Grand ascending run: C4 E4 G4 C5 E5 G5 C6 E6 G6 C7 — 0.5s total sweep
  const run = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093.0];
  run.forEach((f, i) => {
    scheduleNote(ac, f, now + 0.25 + i * 0.055, 0.4, 0.09, { type: 'sine', partial: true, filterHz: 4500 });
  });

  // Landing chord: big C major (C3, E3, G3, C4, E4, G4, C5) held
  const landingStart = now + 0.95;
  [130.81, 164.81, 196.0, 261.63, 329.63, 392.0, 523.25].forEach((f) => {
    scheduleNote(ac, f, landingStart, 5.5, 0.065, { type: 'triangle', filterHz: 2400 });
    // Saw layer, quieter, for orchestral warmth
    scheduleNote(ac, f, landingStart + 0.02, 5.3, 0.03, { type: 'sawtooth', filterHz: 1500 });
  });

  // Bell tower: sparkling upper notes laddering in
  [1046.5, 1318.51, 1567.98, 2093.0, 2637.02].forEach((f, i) => {
    scheduleNote(ac, f, landingStart + 0.1 + i * 0.18, 4.0, 0.045, { type: 'sine' });
  });

  // Cymbal crash: long filtered-noise swell
  const crash = ac.createBufferSource();
  crash.buffer = noiseBuffer(ac, 3.5);
  const cf = ac.createBiquadFilter();
  cf.type = 'highpass';
  cf.frequency.value = 4000;
  const cg = ac.createGain();
  cg.gain.setValueAtTime(0, landingStart);
  cg.gain.linearRampToValueAtTime(0.12, landingStart + 0.2);
  cg.gain.exponentialRampToValueAtTime(0.001, landingStart + 3.4);
  crash.connect(cf).connect(cg).connect(ac.destination);
  crash.start(landingStart);
  crash.stop(landingStart + 3.5);

  // Choir-ish pad: detuned sines an octave above the chord, swelling slowly
  [523.25, 659.25, 783.99].forEach((f, i) => {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * (i === 1 ? 1.003 : 1); // slight detune
    const g = ac.createGain();
    g.gain.setValueAtTime(0, landingStart + 0.5);
    g.gain.linearRampToValueAtTime(0.05, landingStart + 2.0);
    g.gain.linearRampToValueAtTime(0.04, landingStart + 4.0);
    g.gain.exponentialRampToValueAtTime(0.001, landingStart + 5.5);
    o.connect(g).connect(ac.destination);
    o.start(landingStart + 0.5);
    o.stop(landingStart + 5.6);
  });

  // A second, softer bell echo near the end
  scheduleNote(ac, 2093.0, landingStart + 3.5, 2.0, 0.04, { type: 'sine' });
  scheduleNote(ac, 2637.02, landingStart + 3.7, 2.0, 0.03, { type: 'sine' });
}
