import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {Action, Pt} from '../plan';
import {hotelOf, INK} from '../theme';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export function cursorAt(frame: number, fps: number, start: Pt, actions: Action[]): Pt {
  let pos = start;
  for (const a of actions) {
    if (frame < a.start) return pos;
    if (frame < a.start + a.move) {
      const p = spring({frame: frame - a.start, fps, config: {damping: 200}, durationInFrames: a.move});
      return {x: a.from.x + (a.to.x - a.from.x) * p, y: a.from.y + (a.to.y - a.from.y) * p};
    }
    pos = a.to;
  }
  return pos;
}

export const actFrame = (a: Action) => a.start + a.move + a.hover;

// A clean arrow with a soft shadow; presses and ripples on click.
export const Cursor: React.FC<{start: Pt; actions: Action[]; hotel?: string}> = ({start, actions, hotel}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pos = cursorAt(frame, fps, start, actions);
  const accent = hotelOf(hotel).accent;
  let press = 1;
  const ripples: React.ReactNode[] = [];
  actions.forEach((a, i) => {
    if (a.kind !== 'click') return;
    const f = actFrame(a);
    press = Math.min(press, interpolate(frame, [f - 3, f, f + 7], [1, 0.8, 1], clamp));
    const t = frame - f;
    if (t >= 0 && t < 22) {
      const r = interpolate(t, [0, 22], [12, 78]);
      ripples.push(
        <div
          key={i}
          style={{position: 'absolute', left: a.to.x - r, top: a.to.y - r, width: r * 2, height: r * 2, borderRadius: '50%', border: `4px solid ${accent}`, opacity: interpolate(t, [0, 22], [0.75, 0])}}
        />,
      );
    }
  });
  return (
    <>
      {ripples}
      <svg
        width={44}
        height={60}
        viewBox="0 0 22 30"
        style={{position: 'absolute', left: pos.x - 3, top: pos.y - 2, transform: `scale(${press})`, transformOrigin: '3px 2px', filter: 'drop-shadow(0 6px 8px rgba(32,30,29,0.32))'}}
      >
        <path d="M1.5 1.5 L1.5 24 L7.2 18.6 L11 27.5 L15 25.8 L11.3 17 L19 17 Z" fill={INK} stroke="#fffdf8" strokeWidth={1.6} strokeLinejoin="round" />
      </svg>
    </>
  );
};
