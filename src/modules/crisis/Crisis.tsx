import { HAZARDS } from '../../domain/rules';
import { setUI, useApp } from '../../domain/store';
import { Empty, Icon, Pill, Screen } from '../../ui/kit';
import type { Incident } from '../../domain/types';

const STATUS: Record<Incident['status'], { text: string; tone: 'bad' | 'ok' | '' }> = {
  active: { text: 'Active', tone: 'bad' },
  downgraded: { text: 'False alarm', tone: '' },
  resolved: { text: 'Resolved', tone: 'ok' },
};
const time = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Crisis Mgmt: the safety incidents the desk raised from what was said (smoke, gas, flood, medical, threat, lift).
 * Each card opens the same full-screen alert as before, with its 911 recording and sign-off. Logging a crisis case
 * by radio code arrives in wave 2, in the "Log a case" area.
 */
export function Crisis() {
  const incidents = useApp((s) => s.incidents);
  const open = (id: string) => setUI({ sheet: 'incident', focusSafetyId: id });
  const live = incidents.filter((i) => i.status === 'active').length;

  return (
    <Screen title="Crisis Management" subtitle="Safety alerts and crisis cases">
      <div className="banner bad" role="note">
        <Icon name="siren" weight="fill" />
        <span><b>CALL 911 / RADIO FIRST, THEN LOG.</b> This desk is a logbook and notifier. Radios, the fire panel and written protocols stay primary.</span>
      </div>

      <section aria-labelledby="cases-title" className="dash-panel">
        <div className="dash-head">
          <h2 id="cases-title" className="dash-h">Log a case</h2>
          <Pill tone="accent">Coming next</Pill>
        </div>
        <p className="t-body c2" style={{ margin: 0 }}>
          Crisis cases by radio code (10-9 medical, 10-28 guest complaint, 10-1 fire and the rest), with updates, monitoring and a closing resolution, arrive in the next update.
          A live hazard needs nothing extra: log it as a request with what was said, and the safety alert starts by itself.
        </p>
      </section>

      <section aria-labelledby="alerts-title" className="dash-panel">
        <div className="dash-head">
          <h2 id="alerts-title" className="dash-h">Safety alerts</h2>
          {incidents.length > 0 && <span className="t-sub c2">{live ? `${live} active` : 'None active'}</span>}
        </div>
        {incidents.length === 0 ? (
          <Empty icon="siren" text="No safety alerts in the last 7 days. When a request mentions smoke, gas, flooding, a medical emergency, a threat or someone stuck in a lift, the alert appears here." />
        ) : (
          <ul className="cards" role="list">
            {incidents.map((inc) => {
              const st = STATUS[inc.status];
              const last = inc.log[inc.log.length - 1];
              return (
                <li key={inc.id}>
                  <button type="button" className={`case ${inc.status}`} onClick={() => open(inc.id)} aria-label={`${inc.no}, ${HAZARDS[inc.hazard].label}, ${st.text}. Open the alert`}>
                    <span className="case-top">
                      <span className="t-head">{inc.no} · {HAZARDS[inc.hazard].label}</span>
                      <Pill tone={st.tone}>{st.text}</Pill>
                    </span>
                    <span className="t-sub">{inc.rooms.length > 1 ? `Rooms ${inc.rooms.join(', ')}` : `Room ${inc.rooms[0]}`} · {time(inc.createdAt)}</span>
                    <span className="t-body case-text">“{inc.text}”</span>
                    <span className="t-foot c2">
                      {inc.called911 ? `BFP/911 called by ${inc.called911.by} at ${inc.called911.at}` : 'BFP/911 call not recorded'}
                      {last ? ` · Last: ${last.what}` : ''}
                    </span>
                    <span className="case-open t-sub">{inc.status === 'active' ? 'Open the alert' : 'View'} <Icon name="chev" size={16} /></span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Screen>
  );
}
