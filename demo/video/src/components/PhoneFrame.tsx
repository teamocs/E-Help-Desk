import {INK} from '../theme';

// A simple phone body around the screen rectangle (frame pixels).
export const PhoneFrame: React.FC<{x: number; y: number; w: number; h: number; children: React.ReactNode}> = ({x, y, w, h, children}) => {
  const bezel = 16;
  return (
    <>
      <div
        style={{
          position: 'absolute', left: x - bezel, top: y - bezel, width: w + bezel * 2, height: h + bezel * 2, borderRadius: 62,
          background: '#2b2826', boxShadow: '0 40px 80px -30px rgba(40,56,48,0.55), inset 0 0 0 2px #46413d',
        }}
      />
      <div style={{position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: 46, overflow: 'hidden', background: '#fff'}}>{children}</div>
      <div style={{position: 'absolute', left: x + w / 2 - 30, top: y - 10, width: 60, height: 4, borderRadius: 4, background: INK, opacity: 0.8}} />
    </>
  );
};
