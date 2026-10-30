import { Button, Pill } from '../../ui/kit';
import { closeInquiry, noteInquiry, reopenInquiry, type Inquiry } from './data';

const TONE = { active: 'accent', noted: 'warn', done: 'ok' } as const;

/** The status as the prototype writes it, plus its green "≤6m" when it was closed within 6 minutes. */
export function StatusPill({ i }: { i: Inquiry }) {
  return (
    <>
      <Pill tone={TONE[i.status]}>{i.status}</Pill>
      {i.status === 'done' && i.quick && <Pill tone="ok"><span aria-hidden="true">≤6m</span><span className="sr">closed within 6 minutes</span></Pill>}
    </>
  );
}

/** Active: Note, Done. Noted: Undo, Done. Done: Undo (the prototype's actions). */
export function InquiryActions({ i }: { i: Inquiry }) {
  const label = `${i.no || i.name}`;
  return (
    <div className="inq-acts">
      {i.status === 'active' && <Button size="sm" variant="tint" aria-label={`Note ${label}`} onClick={() => noteInquiry(i.id)}>Note</Button>}
      {i.status !== 'active' && <Button size="sm" variant="bad" aria-label={`Undo ${label}`} onClick={() => reopenInquiry(i.id)}>Undo</Button>}
      {i.status !== 'done' && <Button size="sm" feel="success" aria-label={`Done ${label}`} onClick={() => closeInquiry(i.id)}>Done</Button>}
    </div>
  );
}
