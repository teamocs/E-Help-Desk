import {interpolate, useCurrentFrame} from 'remotion';
import {BODY_FONT, hotelOf, INK, PAPER} from '../theme';

// Large caption bar. Size steps down for long lines so it stays within two lines at 1456px.
export const Caption: React.FC<{text: string; hotel?: string; style?: React.CSSProperties; size?: number}> = ({text, hotel, style, size}) => {
  const frame = useCurrentFrame();
  const fontSize = size ?? (text.length <= 104 ? 44 : 40);
  const enter = interpolate(frame, [4, 16], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <div
      style={{
        background: PAPER,
        borderRadius: 18,
        borderLeft: `8px solid ${hotelOf(hotel).accent}`,
        padding: '14px 34px 16px 30px',
        color: INK,
        font: `500 ${fontSize}px/1.22 ${BODY_FONT}`,
        letterSpacing: '-0.005em',
        textWrap: 'balance',
        boxShadow: '0 10px 30px -18px rgba(52,70,60,0.35)',
        opacity: enter,
        transform: `translateY(${(1 - enter) * 10}px)`,
        ...style,
      }}
    >
      {text}
    </div>
  );
};
