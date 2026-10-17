const STORAGE_KEY = "classdex:shuffle-sound-muted";

let sharedAudioContext = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioCtx();
  }
  return sharedAudioContext;
}

export function getSavedShuffleMuted() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveShuffleMuted(muted) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Boolean(muted)));
  } catch {
    // Ignore storage write errors in restricted browsing modes.
  }
}

export function unlockShuffleAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  } catch {
    return null;
  }
}

export function playShuffleTick(progress = 0) {
  try {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== "running") return;

    const now = ctx.currentTime;
    const clamped = Math.max(0, Math.min(1, progress));

    // Card-flip click oscillator that subtly deepens as the deck slows down
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";

    const startFreq = 680 - clamped * 160;
    const endFreq = 210 - clamped * 40;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(80, endFreq), now + 0.028);

    const peakGain = 0.14 * (1 - clamped * 0.25);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.035);
  } catch {
    // Audio playback is non-critical; never interrupt recitation selection.
  }
}

export function playShuffleReveal() {
  try {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== "running") return;

    const now = ctx.currentTime;
    const notes = [
      { freq: 523.25, delay: 0, duration: 0.18, peak: 0.14 },    // C5
      { freq: 659.25, delay: 0.07, duration: 0.22, peak: 0.15 }, // E5
      { freq: 783.99, delay: 0.14, duration: 0.26, peak: 0.16 }, // G5
      { freq: 1046.5, delay: 0.22, duration: 0.45, peak: 0.18 }, // C6
    ];

    notes.forEach(({ freq, delay, duration, peak }) => {
      const start = now + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + duration + 0.02);
    });
  } catch {
    // Audio playback is non-critical; never interrupt recitation selection.
  }
}
