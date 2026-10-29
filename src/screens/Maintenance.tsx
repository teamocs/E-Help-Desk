import { useState } from 'react';
import { ago, DEPTS, peso } from '../domain/rules';
import { assessWo, completeWo, go, holdWo, reopenWo, setUI, startWo, useApp, useUI } from '../domain/store';
import type { WoStatus } from '../domain/types';
import { Button, DeptChip, Empty, Group, Icon, Pill, Row, Screen, Segmented } from '../ui/kit';

const ORDER: WoStatus[] = ['reported', 'assessed', 'in_progress', 'on_hold', 'done'];
const LABEL: Record<WoStatus, string> = { reported: 'Reported', assessed: 'Assessed', in_progress: 'In progress', on_hold: 'On hold', done: 'Done' };
const FINDINGS = ['Worn part, replace', 'Leak at joint, reseal', 'Needs repainting', 'Vendor repair needed'];

export function Maintenance() {
  const wos = useApp((s) => s.wos);
  const sel = useUI((s) => s.selWo);
  const open = wos.filter((w) => w.status !== 'done').length;
  return (
    <Screen title="Work orders" subtitle={wos.length ? `${open} open · estimated and actual cost tracked` : 'Repairs that need more than a quick fix'}>
      {wos.length === 0 && (
        <Empty icon="wrench" text="No work orders yet. They start from an on-site Engineering or IT item on a ticket: open it and choose Escalate." action="Go to requests" onAction={() => go('requests')} />
      )}
      {ORDER.map((st) => {
        const ws = wos.filter((w) => w.status === st);
        if (!ws.length) return null;
        return (
          <Group key={st} title={LABEL[st]}>
            {ws.map((w) => (
              <button key={w.id} type="button" className="ticket" style={{ gridTemplateColumns: 'auto 1fr auto' }} aria-current={sel === w.id} onClick={() => setUI({ selWo: w.id, selItem: undefined, sheet: null })}>
                <span className="room" style={{ minWidth: '3.4rem', fontSize: '0.8rem' }}>{w.no.replace('WO-', '')}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="t-head ellip" style={{ display: 'block' }}>{w.desc}</span>
                  <span className="t-foot c2 ellip" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{w.loc} <DeptChip dept={w.dept} />{w.srcItemId && <Pill tone="accent">from ticket</Pill>}</span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  {w.priority === 'high' && <Pill tone="bad">High</Pill>}
                  <span className="t-foot c2" style={{ display: 'block', marginTop: 4 }}>{peso(w.actualCost ?? w.estCost)}</span>
                </span>
              </button>
            ))}
          </Group>
        );
      })}
      {wos.length > 0 && <p className="t-foot c2" style={{ padding: '12px 4px' }}>Tickets become work orders from the Escalate button on an on-site Engineering or IT item.</p>}
    </Screen>
  );
}

export function WoDetail({ id }: { id: string }) {
  const wo = useApp((s) => s.wos.find((w) => w.id === id));
  const staff = useApp((s) => s.staff);
  const now = useApp((s) => s.now);
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<'inhouse' | 'outsource'>('inhouse');
  const [who, setWho] = useState('');
  const [est, setEst] = useState('');
  const [actual, setActual] = useState('');
  if (!wo) return <p className="c2">This work order is no longer available.</p>;
  const step = wo.status === 'on_hold' ? 2 : ORDER.indexOf(wo.status);
  const name = (i: string) => staff.find((p) => p.id === i)?.name ?? i;
  const max = Math.max(wo.estCost ?? 0, wo.actualCost ?? 0, 1);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 className="t-title2">{wo.no}</h2>
        <Pill tone={wo.status === 'done' ? 'ok' : wo.status === 'on_hold' ? 'warn' : 'accent'}>{LABEL[wo.status]}</Pill>
        {wo.priority === 'high' && <Pill tone="bad">High priority</Pill>}
      </div>
      <p className="t-body" style={{ margin: '6px 0 12px' }}>{wo.desc}</p>
      <div className="stepper" role="img" aria-label={`Stage ${Math.min(step, 3) + 1} of 4: ${LABEL[wo.status]}`}>
        {[0, 1, 2, 3].map((i) => <span key={i} className={i <= Math.min(step, 3) ? 'on' : ''} />)}
      </div>
      <p className="t-cap c2" style={{ display: 'flex', justifyContent: 'space-between', margin: '6px 0 0' }}><span>Reported</span><span>Assessed</span><span>In progress</span><span>Done</span></p>

      <Group title="Details">
        <Row icon="home" title={wo.loc} sub={wo.area} />
        <Row icon="user" title={`Reported by ${name(wo.reportedBy)}`} sub={`Entered by ${name(wo.encodedBy)} · ${ago(now - wo.createdAt)} ago`} />
        {wo.assignType && <Row icon="wrench" title={wo.assignType === 'outsource' ? `Outsourced to ${wo.contractor ?? 'contractor'}` : 'Done in-house'} sub={`${DEPTS[wo.dept].label}`} />}
        {wo.assessment && <Row icon="clip" title={wo.assessment} sub="Assessment" />}
      </Group>

      {(wo.estCost != null || wo.actualCost != null) && (
        <Group title="Cost: estimated vs actual">
          <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
            {([['Estimated', wo.estCost], ['Actual', wo.actualCost]] as const).map(([l, v]) => (
              <div key={l} className="barline" style={{ gridTemplateColumns: '5.5rem 1fr 5rem' }}>
                <span className="t-sub c2">{l}</span>
                <span className="track"><i style={{ width: `${((v ?? 0) / max) * 100}%`, background: l === 'Actual' ? ((v ?? 0) > (wo.estCost ?? 0) ? 'var(--bad)' : 'var(--ok)') : 'var(--fg-3)' }} /></span>
                <span className="t-sub" style={{ textAlign: 'right' }}>{v == null ? 'Pending' : peso(v)}</span>
              </div>
            ))}
          </div>
        </Group>
      )}

      {wo.status === 'reported' && (
        <Group title="Assess">
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {FINDINGS.map((f) => <button key={f} type="button" className="chip" aria-pressed={note === f} onClick={() => setNote(f)}>{f}</button>)}
          </div>
          <div className="row"><input className="field" placeholder="Findings" aria-label="Findings" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <div className="row"><Segmented label="Who does the work" value={kind} onChange={setKind} options={[{ value: 'inhouse', label: 'In-house' }, { value: 'outsource', label: 'Outsource' }]} /></div>
          {kind === 'outsource' && <div className="row"><input className="field" placeholder="Contractor" aria-label="Contractor" value={who} onChange={(e) => setWho(e.target.value)} /></div>}
          <div className="row"><input className="field" inputMode="numeric" placeholder="Estimated cost (₱)" aria-label="Estimated cost in pesos" value={est} onChange={(e) => setEst(e.target.value.replace(/\D/g, ''))} /></div>
          <div className="row"><Button block feel="success" disabled={!note || !est} onClick={() => assessWo(wo.id, { assessment: note, assignType: kind, contractor: kind === 'outsource' ? who || 'Contractor' : undefined, estCost: Number(est) })}>Save assessment</Button></div>
        </Group>
      )}
      {(wo.status === 'assessed' || wo.status === 'on_hold') && (
        <div style={{ marginTop: 14 }}><Button block size="lg" feel="medium" onClick={() => startWo(wo.id)}>{wo.status === 'on_hold' ? 'Resume work' : 'Start work'}</Button></div>
      )}
      {wo.status === 'in_progress' && (
        <Group title="Finish">
          <div className="row"><input className="field" inputMode="numeric" placeholder="Actual cost (₱)" aria-label="Actual cost in pesos" value={actual} onChange={(e) => setActual(e.target.value.replace(/\D/g, ''))} /></div>
          <div className="row" style={{ gap: 8 }}>
            <Button variant="gray" onClick={() => holdWo(wo.id)}>Put on hold</Button>
            <Button block feel="success" disabled={!actual} onClick={() => completeWo(wo.id, Number(actual))}>Complete{wo.srcItemId ? ' and close ticket' : ''}</Button>
          </div>
        </Group>
      )}
      {wo.status === 'done' && <div style={{ marginTop: 14 }}><Button variant="gray" block icon="undo" onClick={() => reopenWo(wo.id)}>Reopen</Button></div>}

      <Group title="History">
        <ol className="timeline" style={{ padding: '10px 16px 10px 40px' }}>
          {wo.audit.map((a, i) => <li key={i} className="t-foot"><span className="c2">{new Date(a.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span> · {a.what} <span className="c3">· {name(a.by).split(' ')[0]}</span></li>)}
        </ol>
      </Group>
      {wo.srcItemId && <p className="t-foot c2" style={{ padding: '10px 16px' }}><Icon name="info" size={14} /> Linked to a request item. Completing this work order closes it.</p>}
    </div>
  );
}
