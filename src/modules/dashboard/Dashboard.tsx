import { useEffect, useMemo, useRef, useState } from 'react';
import { ago } from '../../domain/rules';
import { finishItem, go, myStaff, onSite, openComposer, relay, setUI, useApp, useUI } from '../../domain/store';
import { haptic } from '../../lib/haptics';
import { HandoverPanel } from '../../screens/Handover';
import { Button, DeptChip, Empty, Icon, Screen } from '../../ui/kit';
import { LABELS } from '../access';
import { layoutFor, lines, type Line } from '../requests/logic';
import { StatusBadge, hotelTime } from '../requests/ui';
import { visibleModules } from '../registry';
import { QUICK_ACTIONS, buildCards, computeStats, dashActions, responseCards, type Card } from './model';
import './dashboard.css';

const STEP = { relay: 'Relay', onSite: 'On Site', done: 'Done' } as const;

/** The module ids this viewer may see (the server's matrix, as the sidebar uses it). */
function useCan(): (module: string) => boolean {
  const role = useUI((s) => s.account.role);
  const accountModules = useUI((s) => s.account.modules);
  const access = useUI((s) => s.access);
  const me = useApp(myStaff);
  const catalog = useApp((s) => s.catalog);
  return useMemo(() => {
    const ids = new Set(visibleModules({ role, accountModules, access, me, catalog }).map((m) => m.id));
    return (id: string) => ids.has(id);
  }, [role, accountModules, access, me, catalog]);
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1024);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function CountCard({ c }: { c: Card }) {
  return (
    <button type="button" className={`db-card db-tap ${c.icon ? 'db-tile' : ''}`} onClick={() => { haptic('select'); go(c.module); }} aria-label={`${c.label}: ${c.value}. ${c.sub}. Open ${LABELS[c.module]}`}>
      <span className="db-label">{c.icon && <Icon name={c.icon} size={18} />}{c.label}</span>
      <span className={`db-n tnum ${c.tone}`}>{c.value}</span>
      <span className={`db-sub ${c.tone}`}>{c.sub}</span>
    </button>
  );
}

const sourceOf = (l: Line) => (l.req.source === 'staff_request' ? 'staff request' : 'guest');

export function Dashboard() {
  const snap = useApp((s) => s);
  const can = useCan();
  const [listRef, width] = useWidth();
  const shortcuts = useApp((s) => s.prefs.shortcuts);

  const stats = useMemo(() => computeStats(snap), [snap]);
  const { stats: counts, tiles } = buildCards(stats, can);
  const quick = QUICK_ACTIONS.filter((a) => can(a.module));
  const rows = useMemo(() => lines(snap.requests, snap.items).filter((l) => l.it).slice(0, 10), [snap.requests, snap.items]);
  const items = snap.items;
  const now = snap.now;

  // The prototype's Alt+R, Alt+I, Alt+M and Alt+C, while the Dashboard is open and nobody is typing.
  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [role="dialog"]')) return;
      const a = quick.find((q) => q.keys.toLowerCase() === e.key.toLowerCase());
      if (a) { e.preventDefault(); a.run(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts, quick]);

  const step = (a: keyof typeof STEP, id: string) => {
    haptic(a === 'done' ? 'success' : 'medium');
    if (a === 'relay') relay(id); else if (a === 'onSite') onSite(id); else finishItem(id);
  };
  const open = (l: Line) => { haptic('select'); setUI({ tab: 'requests', selItem: l.req.id, selWo: undefined, sheet: null }); };
  const actions = (l: Line) => dashActions(l.it!, items).map((a) => (
    <Button key={a} size="sm" variant={a === 'done' ? 'fill' : 'tint'} feel={a === 'done' ? 'success' : 'medium'} aria-label={`${STEP[a]}: ${l.code} ${l.it!.name}`} onClick={() => step(a, l.it!.id)}>{STEP[a]}</Button>
  ));

  return (
    <Screen title="Dashboard" subtitle="Command center">
      {quick.length > 0 && (
        <div className="db-quick" role="group" aria-label="Quick actions">
          {quick.map((a, n) => (
            <Button key={a.key} icon="plus" variant={n === 0 ? 'fill' : 'tint'} feel="medium" aria-keyshortcuts={shortcuts ? `Alt+${a.keys}` : undefined} onClick={a.run}>
              {a.label}<span className="db-keys" aria-hidden="true"> Alt+{a.keys}</span>
            </Button>
          ))}
        </div>
      )}

      {counts.length > 0 && (
        <>
          <h2 className="sr">Right now</h2>
          <div className="db-grid">{counts.map((c) => <CountCard key={c.key} c={c} />)}</div>
        </>
      )}

      {can('requests') && (
        <section aria-labelledby="db-resp" className="db-sec">
          <h2 id="db-resp" className="dash-h">Response times</h2>
          <p className="t-sub c2 db-note">Targets differ by request type. Each item is timed against its own target, from acknowledgement, with hold time taken out.</p>
          <div className="db-grid db-resp">
            {responseCards(stats.response).map((c) => (
              <div key={c.key} className="db-card" role="group" aria-label={`${c.label}: ${c.value}. ${c.sub}`}>
                <span className="db-label">{c.label}</span>
                <span className={`db-n tnum ${c.tone}`}>{c.value}</span>
                <span className={`db-sub ${c.tone}`}>{c.sub}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {tiles.length > 0 && (
        <>
          <h2 className="sr">Crisis, transport and work orders</h2>
          <div className="db-grid db-tiles">{tiles.map((c) => <CountCard key={c.key} c={c} />)}</div>
        </>
      )}

      {can('requests') && (
        <section aria-labelledby="recent-title" className="dash-panel">
          <div className="dash-head">
            <h2 id="recent-title" className="dash-h">Recent Tickets</h2>
            <Button size="sm" variant="plain" onClick={() => go('requests')}>View all</Button>
          </div>
          <div className="db-list" ref={listRef}>
            {rows.length === 0 ? (
              <Empty icon="clip" text="No tickets yet. A new request shows here the moment it is logged." action="New Request" onAction={() => openComposer()} />
            ) : layoutFor(width) === 'table' ? (
              <div className="rq-table-wrap">
                <table className="rq-table" aria-label="Recent tickets">
                  <thead>
                    <tr>
                      <th scope="col">Code</th><th scope="col">Room</th><th scope="col">Item</th><th scope="col" className="rq-c3 rq-num">Qty</th><th scope="col">Dept</th>
                      <th scope="col" className="rq-c2">Source</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col" className="rq-num"><span className="sr">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l) => (
                      <tr key={l.key} onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a')) open(l); }}>
                        <td><button type="button" className="rq-code" onClick={() => open(l)} aria-label={`Open ${l.code}, room ${l.req.room}`}>{l.code}</button></td>
                        <td className="rq-room">{l.req.room}</td>
                        <td className="rq-item">{l.it!.name}{l.it!.qty > 1 && <span className="rq-narrow-qty">&nbsp;×{l.it!.qty}</span>}</td>
                        <td className="rq-c3 rq-num">{l.it!.qty}</td>
                        <td><DeptChip dept={l.it!.dept} /></td>
                        <td className="rq-c2">{sourceOf(l)}</td>
                        <td><StatusBadge status={l.it!.status} /></td>
                        <td className="nowrap">{hotelTime(l.req.createdAt)}</td>
                        <td><div className="rq-acts">{actions(l)}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="rq-cards" aria-label="Recent tickets">
                {rows.map((l) => (
                  <li key={l.key} className="rq-card">
                    <button type="button" className="rq-card-main" onClick={() => open(l)}>
                      <span className="room" aria-hidden="true">{l.req.room}</span>
                      <span className="rq-card-title"><span className="sr">Room {l.req.room}. </span>{l.it!.name}{l.it!.qty > 1 ? ` ×${l.it!.qty}` : ''}</span>
                      <StatusBadge status={l.it!.status} />
                      <span className="rq-card-meta"><span>{l.code}</span><DeptChip dept={l.it!.dept} /><span>{sourceOf(l)}</span><span>{ago(now - l.req.createdAt)} ago</span></span>
                    </button>
                    {dashActions(l.it!, items).length > 0 && <div className="rq-card-acts">{actions(l)}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <HandoverPanel />
    </Screen>
  );
}
