import {AbsoluteFill} from 'remotion';
import {BODY_FONT, GOLD, HOTELS, INK, MUTED, TITLE_FONT} from '../theme';
import {useRise} from './ChapterCard';
import {Background} from './Chrome';

const Hotels: React.FC<{size?: number}> = ({size = 34}) => (
  <div style={{display: 'flex', gap: 48, justifyContent: 'center', font: `500 ${size}px ${BODY_FONT}`, color: INK}}>
    {Object.values(HOTELS).map((h) => (
      <div key={h.name} style={{display: 'flex', alignItems: 'center', gap: 14}}>
        <span style={{width: size * 0.42, height: size * 0.42, borderRadius: 99, background: h.accent}} />
        {h.name}
      </div>
    ))}
  </div>
);

const Center: React.FC<{children: React.ReactNode}> = ({children}) => (
  <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 160px'}}>{children}</AbsoluteFill>
);

export const Intro: React.FC = () => (
  <AbsoluteFill>
    <Background split />
    <Center>
      <div style={{font: `400 140px/1 ${TITLE_FONT}`, color: HOTELS.baguio.strong, ...useRise(0)}}>Azalea e-Helpdesk</div>
      <div style={{font: `400 64px ${TITLE_FONT}`, color: HOTELS.boracay.strong, marginTop: 18, ...useRise(6)}}>a quick tour</div>
      <div style={{width: 72, height: 3, background: GOLD, margin: '44px 0'}} />
      <div style={useRise(12)}>
        <Hotels />
        <div style={{font: `400 32px ${BODY_FONT}`, color: MUTED, marginTop: 22}}>The service desk inside both hotel websites</div>
      </div>
    </Center>
  </AbsoluteFill>
);

const Row: React.FC<{n: number; name: string; i: number}> = ({n, name, i}) => (
  <div style={{display: 'flex', alignItems: 'baseline', gap: 28, ...useRise(6 + i * 4)}}>
    <span style={{font: `600 30px ${BODY_FONT}`, color: MUTED, width: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums'}}>{n}</span>
    <span style={{font: `400 58px/1.25 ${TITLE_FONT}`, color: INK}}>{name}</span>
  </div>
);

export const Agenda: React.FC<{names: string[]; offset: number; page: number; pages: number}> = ({names, offset, page, pages}) => (
  <AbsoluteFill>
    <Background split />
    <div style={{position: 'absolute', left: 232, right: 232, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18}}>
      <div style={{display: 'flex', alignItems: 'baseline', gap: 24, marginBottom: 26, ...useRise(0)}}>
        <span style={{font: `400 76px ${TITLE_FONT}`, color: HOTELS.baguio.strong}}>What you will see</span>
        <span style={{font: `600 26px ${BODY_FONT}`, color: MUTED}}>{page} of {pages}</span>
      </div>
      {names.map((name, i) => (
        <Row key={name} n={offset + i + 1} name={name} i={i} />
      ))}
    </div>
  </AbsoluteFill>
);

export const Outro: React.FC = () => (
  <AbsoluteFill>
    <Background split />
    <Center>
      <div style={{font: `400 130px/1 ${TITLE_FONT}`, color: HOTELS.baguio.strong, ...useRise(0)}}>Thank you</div>
      <div style={{width: 72, height: 3, background: GOLD, margin: '44px 0'}} />
      <div style={{font: `500 50px/1.3 ${BODY_FONT}`, color: INK, ...useRise(8)}}>Need help? Ask your hotel owner or manager.</div>
      <div style={{font: `400 44px/1.3 ${BODY_FONT}`, color: MUTED, marginTop: 14, ...useRise(14)}}>A step-by-step guide is included.</div>
      <div style={{marginTop: 64, ...useRise(20)}}>
        <Hotels size={30} />
      </div>
    </Center>
  </AbsoluteFill>
);
