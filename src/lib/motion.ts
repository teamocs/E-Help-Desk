import { useReducedMotion } from 'motion/react';

export const motionTokens = {
  duration: { instant: 0.08, fast: 0.18, normal: 0.35, slow: 0.6, crawl: 1.0 },
  easing: {
    smooth: [0.22, 1, 0.36, 1] as [number, number, number, number],
    sharp: [0.4, 0, 0.2, 1] as [number, number, number, number],
  },
  distance: { xs: 4, sm: 8, md: 16, lg: 24, xl: 48 },
  scale: { subtle: 0.98, press: 0.97, pop: 1.03 },
};

export const springs = {
  snappy: { type: 'spring' as const, stiffness: 300, damping: 30 },
  gentle: { type: 'spring' as const, stiffness: 120, damping: 14 },
  sheet: { type: 'spring' as const, stiffness: 320, damping: 34 },
  instant: { type: 'spring' as const, stiffness: 600, damping: 35 },
  release: { type: 'spring' as const, stiffness: 200, damping: 20, restDelta: 0.001 },
};

/** Fade-and-lift that drops the transform when the user prefers reduced motion. */
export function useSafeMotion(y: number = motionTokens.distance.md) {
  const reduce = useReducedMotion();
  return {
    initial: { opacity: 0, y: reduce ? 0 : y },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: reduce ? 0 : y / 2 },
    transition: reduce ? { duration: 0.15 } : springs.snappy,
  };
}
