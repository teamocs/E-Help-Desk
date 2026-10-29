import {AbsoluteFill} from 'remotion';
import {BODY_FONT, GOLD, hotelOf, INK, MUTED, roleOf, TITLE_FONT} from '../theme';

// Warm cream paper with a faint wash of the hotel's colour.
export const Background: React.FC<{hotel?: string; split?: boolean}> = ({hotel, split}) => {
  const h = hotelOf(hotel);
  const wash = split
    ? `radial-gradient(1200px 900px at 0% 0%, ${hotelOf('baguio').tint}, transparent 70%), radial-gradient(1200px 900px at 100% 100%, ${hotelOf('boracay').tint}, transparent 70%)`
    : `radial-gradient(1400px 1000px at 8% -10%, ${h.tint}, transparent 70%), radial-gradient(900px 700px at 105% 110%, ${h.tint}, transparent 70%)`;
  return <AbsoluteFill style={{background: `${wash}, ${h.base}`}} />;
};

export const ProgressDots: React.FC<{count: number; current: number; hotel?: string; name?: string}> = ({count, current, hotel, name}) => {
  const h = hotelOf(hotel);
  return (
    <div style={{position: 'absolute', left: 0, right: 0, bottom: 14, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10}}>
      {Array.from({length: count}, (_, i) => (
        <div
          key={i}
          style={{
            width: i === current ? 26 : 9,
            height: 9,
            borderRadius: 9,
            background: i === current ? h.strong : i < current ? 'rgba(32,30,29,0.38)' : 'rgba(32,30,29,0.14)',
          }}
        />
      ))}
      {name ? <span style={{marginLeft: 12, font: `600 19px ${BODY_FONT}`, color: MUTED}}>{name}</span> : null}
    </div>
  );
};

export const HotelMark: React.FC<{hotel?: string; style?: React.CSSProperties}> = ({hotel, style}) => {
  const h = hotelOf(hotel);
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 10, font: `400 26px ${TITLE_FONT}`, color: h.strong, ...style}}>
      <span style={{width: 8, height: 8, borderRadius: 8, background: GOLD}} />
      {h.name}
    </div>
  );
};

export const RoleBadge: React.FC<{role: string; prefix?: string; size?: number}> = ({role, prefix = 'Seen as', size = 22}) => {
  const r = roleOf(role);
  return (
    <div style={{display: 'inline-flex', alignItems: 'center', gap: 10, padding: `${size * 0.3}px ${size * 0.8}px`, borderRadius: 999, background: r.color, color: '#fffdf8', font: `600 ${size}px ${BODY_FONT}`}}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
      </svg>
      {prefix} {r.label}
    </div>
  );
};

export const TitleChip: React.FC<{text: string; hotel?: string; size?: number}> = ({text, hotel, size = 30}) => {
  const h = hotelOf(hotel);
  return (
    <div style={{display: 'inline-block', padding: `${size * 0.18}px ${size * 0.62}px`, borderRadius: 999, background: h.tint.replace('0.11', '0.14'), color: h.strong, font: `400 ${size}px ${TITLE_FONT}`, whiteSpace: 'nowrap'}}>
      {text}
    </div>
  );
};

export {INK};
