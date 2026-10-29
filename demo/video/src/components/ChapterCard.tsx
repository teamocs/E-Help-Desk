import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {ChapterItem} from '../plan';
import {BODY_FONT, GOLD, hotelOf, INK, MUTED, TITLE_FONT} from '../theme';
import {Background, ProgressDots, RoleBadge} from './Chrome';

export const useRise = (delay = 0) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = spring({frame: frame - delay, fps, config: {damping: 200}, durationInFrames: 18});
  return {opacity: p, transform: `translateY(${(1 - p) * 18}px)`};
};

export const ChapterCard: React.FC<{item: ChapterItem; chapters: string[]}> = ({item, chapters}) => {
  const frame = useCurrentFrame();
  const h = hotelOf(item.hotel);
  const [r0, r1, r2] = [useRise(0), useRise(4), useRise(9)];
  const rule = interpolate(frame, [6, 24], [0, 72], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill>
      <Background hotel={item.hotel} />
      <div style={{position: 'absolute', left: 232, right: 232, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 22, ...r0}}>
          <div style={{width: 76, height: 76, borderRadius: 76, border: `3px solid ${h.accent}`, display: 'grid', placeItems: 'center', font: `400 38px ${TITLE_FONT}`, color: h.strong}}>
            {item.index + 1}
          </div>
          <div style={{font: `600 26px ${BODY_FONT}`, color: MUTED, letterSpacing: '0.04em'}}>
            Part {item.index + 1} of {chapters.length}
          </div>
          {item.perUser ? <RoleBadge role={item.role} prefix={item.role === 'device' ? 'On the' : 'As the'} size={28} /> : null}
        </div>
        <div style={{font: `400 112px/1.02 ${TITLE_FONT}`, color: h.strong, marginTop: 34, ...r1}}>{item.name}</div>
        <div style={{width: rule, height: 3, background: GOLD, margin: '30px 0 28px'}} />
        {item.summary ? (
          <div style={{font: `400 42px/1.3 ${BODY_FONT}`, color: INK, maxWidth: 1300, textWrap: 'balance', ...r2}}>{item.summary}</div>
        ) : null}
      </div>
      <ProgressDots count={chapters.length} current={item.index} hotel={item.hotel} />
    </AbsoluteFill>
  );
};
