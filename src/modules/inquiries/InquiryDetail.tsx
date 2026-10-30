import { useApp } from '../../domain/store';
import { Group } from '../../ui/kit';
import { InquiryActions, StatusPill } from './InquiryActions';
import { TYPE_LABEL, inquiriesOf } from './data';
import { when } from './hotelTime';
import './modules.css';

/** One inquiry in full: who asked, what, who took it, and what happened to it. Beside the list on wide screens, a sheet on phones. */
export function InquiryDetail({ id }: { id: string }) {
  const i = useApp((s) => inquiriesOf(s).find((x) => x.id === id));
  const now = useApp((s) => s.now);
  const staff = useApp((s) => s.staff);
  if (!i) return <p className="c2">This inquiry is no longer in the list. Inquiries closed more than 14 days ago are kept on the server only.</p>;
  const name = (by: string) => staff.find((p) => p.id === by)?.name ?? 'System';
  return (
    <div className="mod-detail">
      <div>
        <h2 className="t-title2">{i.no || 'New inquiry'}</h2>
        <p className="t-sub c2" style={{ margin: '4px 0 0', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>{TYPE_LABEL[i.type]} <StatusPill i={i} /></p>
      </div>
      <Group>
        <dl className="mod-dl">
          <dt>Name</dt><dd>{i.name}</dd>
          <dt>Room</dt><dd>{i.room ?? '—'}</dd>
          <dt>HDO</dt><dd>{staff.find((p) => p.id === i.hdo)?.name ?? '—'}</dd>
          <dt>Logged</dt><dd>{when(i.createdAt, now)}</dd>
          {i.closedAt != null && <><dt>Closed</dt><dd>{when(i.closedAt, now)}</dd></>}
          <dt>Description</dt><dd style={{ whiteSpace: 'pre-line' }}>{i.desc}</dd>
        </dl>
      </Group>
      <div style={{ margin: '0 -16px' }}><InquiryActions i={i} /></div>
      <Group title="History">
        <ol className="timeline" aria-label="History">
          {i.history.map((h, n) => (
            <li key={n} className="t-foot"><span className="c2">{when(h.at, now)}</span> · {h.what} <span className="c3">· {name(h.by)}</span></li>
          ))}
        </ol>
      </Group>
    </div>
  );
}
