export type Haptic = 'select' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

export const hapticsConfig = { enabled: true, sound: true };

const PATTERN: Record<Haptic, number | number[]> = {
  select: 8,
  light: 12,
  medium: 22,
  heavy: 36,
  success: [12, 40, 18],
  warning: [26, 60, 26],
  error: [44, 50, 44, 50, 70],
};

/** Vibration where the platform allows it (Android phones). Silent everywhere else. */
export function haptic(kind: Haptic): void {
  if (!hapticsConfig.enabled) return;
  try {
    // Browsers refuse (and log an error) until the person has tapped the page.
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate(PATTERN[kind]);
  } catch {
    /* unsupported or blocked */
  }
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function beep(c: AudioContext, freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

/** Routine items stay silent. Only the safety alert and the success tick make sound. */
export function tone(kind: 'tick' | 'success' | 'alert'): void {
  if (!hapticsConfig.sound) return;
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  if (kind === 'tick') beep(c, 1200, t, 0.05, 0.04);
  if (kind === 'success') {
    beep(c, 660, t, 0.12, 0.05);
    beep(c, 880, t + 0.1, 0.18, 0.05);
  }
  if (kind === 'alert') for (let i = 0; i < 4; i++) beep(c, i % 2 ? 660 : 880, t + i * 0.32, 0.28, 0.12, 'square');
}
