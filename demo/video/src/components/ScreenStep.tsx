import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Action, StepItem, stageFor} from '../plan';
import {BODY_FONT, hotelOf, INK, TITLE_FONT} from '../theme';
import {Caption} from './Caption';
import {Background, HotelMark, ProgressDots, RoleBadge, TitleChip} from './Chrome';
import {actFrame, Cursor} from './Cursor';
import {PhoneFrame} from './PhoneFrame';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ZOOM = 1.18;

// Everything drawn on top of the screenshot, in screenshot-local pixels (so it follows the camera zoom).
const Overlays: React.FC<{actions: Action[]; scale: number; accent: string; strong: string; frame: number}> = ({actions, scale, accent, strong, frame}) => (
  <>
    {actions.map((a, i) => {
      const f = actFrame(a);
      const b = {left: a.box.x * scale, top: a.box.y * scale, width: a.box.w * scale, height: a.box.h * scale};
      const pad = 8;
      const until = f + a.dwell + (a.kind === 'click' ? 4 : 8);
      const vis = interpolate(frame, [f - a.hover - 2, f, until - 6, until], [0, 1, 1, 0], clamp);
      const pulse = a.kind === 'look' ? 0.5 + 0.5 * Math.sin((frame - f) / 4.5) : 0;
      const labelAbove = b.top > 52;
      const nodes: React.ReactNode[] = [];
      if (a.kind === 'type' && frame >= f) {
        const n = Math.floor(interpolate(frame, [f + 4, f + a.dwell - 6], [0, (a.typed ?? '').length], clamp));
        const raw = (a.typed ?? '').slice(0, n);
        const shown = /\b(pin|password)\b/i.test(a.label) ? '•'.repeat(raw.length) : raw;
        const tall = a.box.h > 80;
        const fs = Math.min(28, a.box.h * 0.4) * scale;
        const caretOn = frame < f + a.dwell && (frame < f + a.dwell - 8 || Math.floor(frame / 6) % 2 === 0);
        nodes.push(
          <div
            key="type"
            style={{
              position: 'absolute', left: b.left + 3, top: b.top + 3, width: b.width - 6, height: b.height - 6, borderRadius: 10 * scale,
              background: '#ffffff', display: 'flex', alignItems: tall ? 'flex-start' : 'center', padding: `${tall ? 16 * scale : 0}px ${20 * scale}px`,
              font: `500 ${fs}px ${BODY_FONT}`, color: INK, boxSizing: 'border-box', whiteSpace: 'pre',
            }}
          >
            {shown}
            <span style={{display: 'inline-block', width: 2.5, height: fs * 1.15, marginLeft: 2, background: strong, opacity: caretOn ? 1 : 0}} />
          </div>,
        );
      }
      if (vis > 0) {
        if (a.kind === 'look') {
          nodes.push(
            <div
              key="spot"
              style={{
                position: 'absolute', left: b.left - pad, top: b.top - pad, width: b.width + pad * 2, height: b.height + pad * 2, borderRadius: 14,
                boxShadow: `0 0 0 3000px rgba(32,30,29,${0.2 * vis})`, outline: `${4 + pulse * 2}px solid ${accent}`, outlineOffset: 0, opacity: vis,
              }}
            />,
          );
        } else {
          const flash = a.kind === 'click' ? interpolate(frame, [f, f + 3, f + 14], [0, 0.32, 0], clamp) : 0;
          nodes.push(
            <div
              key="ring"
              style={{
                position: 'absolute', left: b.left - 6, top: b.top - 6, width: b.width + 12, height: b.height + 12, borderRadius: 14,
                outline: `4px solid ${accent}`, background: `rgba(255,255,255,0)`, boxShadow: `inset 0 0 0 999px ${hexA(accent, flash)}`, opacity: vis,
              }}
            />,
          );
        }
        // Name what is highlighted (not colour alone). Only for "look": a tap speaks for itself and the tag would hide nearby text.
        if (a.kind === 'look') {
          nodes.push(
            <div
              key="label"
              style={{
                position: 'absolute', left: Math.max(4, b.left - pad), top: labelAbove ? b.top - pad - 38 : b.top + b.height + pad + 6,
                padding: '4px 12px', borderRadius: 8, background: strong, color: '#fffdf8', font: `600 20px ${BODY_FONT}`, whiteSpace: 'nowrap', opacity: vis,
              }}
            >
              {a.label}
            </div>,
          );
        }
      }
      return <div key={i}>{nodes}</div>;
    })}
  </>
);

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function zoomAt(frame: number, actions: Action[]) {
  for (const a of actions) {
    if (!a.zoom) continue;
    const f = actFrame(a);
    if (frame >= f - 2 && frame <= f + a.dwell + 4) {
      const z = interpolate(frame, [f - 2, f + 12, f + a.dwell - 8, f + a.dwell + 4], [1, ZOOM, ZOOM, 1], clamp);
      return {z, ox: a.box.x + a.box.w / 2, oy: a.box.y + a.box.h / 2};
    }
  }
  return {z: 1, ox: 0, oy: 0};
}

export const ScreenStep: React.FC<{item: StepItem; chapters: string[]}> = ({item, chapters}) => {
  const frame = useCurrentFrame();
  const {shot, actions, img} = item;
  const h = hotelOf(shot.hotel);
  const stage = stageFor(shot.viewport, img);
  const {z, ox, oy} = zoomAt(frame, actions);
  const phone = shot.viewport === 'phone';
  const showRole = shot.role !== 'owner';

  const screen = (
    <div style={{position: 'absolute', inset: 0, transform: `scale(${z})`, transformOrigin: `${ox * stage.scale}px ${oy * stage.scale}px`}}>
      <Img src={staticFile(`shots/${shot.file}`)} style={{width: stage.w, height: stage.h, display: 'block'}} />
      <Overlays actions={actions} scale={stage.scale} accent={h.accent} strong={h.strong} frame={frame} />
    </div>
  );

  return (
    <AbsoluteFill>
      <Background hotel={shot.hotel} />
      {phone ? (
        <>
          <PhoneFrame x={stage.x} y={stage.y} w={stage.w} h={stage.h}>{screen}</PhoneFrame>
          <div style={{position: 'absolute', left: 880, top: 0, bottom: 60, width: 900, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28}}>
            <HotelMark hotel={shot.hotel} />
            {showRole ? <div><RoleBadge role={shot.role} /></div> : null}
            <div style={{font: `400 64px/1.08 ${TITLE_FONT}`, color: h.strong}}>{shot.title}</div>
            <Caption text={item.caption} hotel={shot.hotel} size={item.caption.length > 100 ? 44 : 50} />
          </div>
        </>
      ) : (
        <>
          <div style={{position: 'absolute', left: stage.x, top: 18, right: 1920 - stage.x - stage.w, height: 52, display: 'flex', alignItems: 'center', gap: 16}}>
            <TitleChip text={shot.title} hotel={shot.hotel} />
            {showRole ? <RoleBadge role={shot.role} /> : null}
            <div style={{flex: 1}} />
            <HotelMark hotel={shot.hotel} />
          </div>
          <div
            style={{
              position: 'absolute', left: stage.x, top: stage.y, width: stage.w, height: stage.h, borderRadius: 16, overflow: 'hidden',
              boxShadow: `0 30px 70px -28px ${hexA(h.strong, 0.45)}, 0 2px 8px rgba(32,30,29,0.08)`, background: '#fff',
            }}
          >
            {screen}
          </div>
          <Caption text={item.caption} hotel={shot.hotel} style={{position: 'absolute', left: stage.x, width: stage.w, top: stage.y + stage.h + 14, boxSizing: 'border-box'}} />
        </>
      )}
      <ProgressDots count={chapters.length} current={item.chapterIndex} hotel={shot.hotel} />
      <Cursor start={item.cursorStart} actions={actions} hotel={shot.hotel} />
    </AbsoluteFill>
  );
};
