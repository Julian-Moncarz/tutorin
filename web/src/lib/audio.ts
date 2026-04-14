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

function noiseBuffer(ac: AudioContext, duration: number): AudioBuffer {
  const buffer = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * duration)), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
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

  // 4. Bright major-chord overtone ONLY on correct
  if (correct) {
    const chord = [659.25, 830.61, 987.77]; // E5, G#5, B5 — E major
    chord.forEach((freq, i) => {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const g = ac.createGain();
      const start = now + 0.42 + i * 0.025;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.09, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
      o.connect(g).connect(ac.destination);
      o.start(start);
      o.stop(start + 0.34);
    });
  }
}
