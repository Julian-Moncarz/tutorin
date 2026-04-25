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

// Crinkle / rip / snap when the user swipes the peel card off. ~500ms.
export function playPeel(): void {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;

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

// Skill-retired fanfare — bright arpeggio flourish, ~2s. Same one every retire.
export function playSkillRetired(): void {
  const ac = getCtx();
  if (!ac) return;
  const now = ac.currentTime;

  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
  notes.forEach((f, i) => {
    scheduleNote(ac, f, now + i * 0.09, 0.55, 0.1, { type: 'sine', partial: true, filterHz: 4000 });
  });

  [261.63, 329.63, 392.0].forEach((f) => {
    scheduleNote(ac, f, now + 0.12, 1.6, 0.055, { type: 'triangle', filterHz: 2200 });
  });

  scheduleNote(ac, 2093, now + 0.5, 1.4, 0.05, { type: 'sine' });

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
