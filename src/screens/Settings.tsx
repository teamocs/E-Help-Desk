import { ROLE_LABEL } from '../domain/rules';
import { app, lock, resetApp, setPref, toast, useApp, useUI } from '../domain/store';
import { staffApi } from '../domain/staffApi';
import { haptic } from '../lib/haptics';
import { Avatar, Button, Group, Icon, Row, Screen, Segmented, Switch } from '../ui/kit';
import { StaffAdmin } from './StaffAdmin';
import type { Prefs } from '../domain/types';

const SIZES = [0.9, 1, 1.12, 1.28, 1.48];
const SIZE_NAMES = ['Small', 'Default', 'Large', 'Larger', 'Largest'];

function Toggle({ icon, title, sub, k }: { icon: string; title: string; sub?: string; k: 'contrast' | 'haptics' | 'sound' | 'showHaptics' | 'shadow' | 'shortcuts' }) {
  const v = useApp((s) => s.prefs[k]);
  return (
    <div className="row">
      <span className="lead" style={{ background: 'var(--fill)', color: 'var(--fg-2)' }}><Icon name={icon} /></span>
      <span className="grow"><span style={{ display: 'block' }}>{title}</span>{sub && <span className="t-foot c2" style={{ display: 'block' }}>{sub}</span>}</span>
      <Switch checked={v} onChange={(x) => setPref(k, x as Prefs[typeof k])} label={title} />
    </div>
  );
}

export function Settings() {
  const prefs = useApp((s) => s.prefs);
  const me = useApp((s) => s.staff.find((p) => p.id === s.me));
  const isRemote = useUI((s) => s.remote);
  const deviceOnly = useUI((s) => s.deviceOnly);
  const idx = Math.max(0, SIZES.findIndex((x) => x >= prefs.textScale));
  return (
    <Screen title="Settings" subtitle="Made to be comfortable at 3 a.m. on a shared phone.">
      {me && (
        <Group title="Signed in">
          <div className="row">
            <Avatar staff={me} large />
            <span className="grow"><span className="t-head" style={{ display: 'block' }}>{me.name}</span><span className="t-foot c2">{me.title}{me.title.toLowerCase().includes(ROLE_LABEL[me.role].toLowerCase()) ? '' : ` · ${ROLE_LABEL[me.role]}`}</span></span>
            <Button size="sm" variant="gray" icon="user" onClick={async () => { if (isRemote && deviceOnly) { await staffApi.current?.signOut(); app.set((s) => ({ ...s, me: null })); } lock(); }}>Switch</Button>
          </div>
          {isRemote && !deviceOnly && me.id !== 'member' && (
            <div className="row">
              <Button variant="gray" block onClick={async () => { await staffApi.current?.signOut(); app.set((s) => ({ ...s, me: 'member' })); }}>Back to the manager account</Button>
            </div>
          )}
        </Group>
      )}

      {isRemote && me?.id === 'member' && <StaffAdmin />}

      <Group title="Appearance">
        <div className="row"><Segmented<Prefs['theme']> label="Appearance" value={prefs.theme} onChange={(v) => setPref('theme', v)} options={[{ value: 'auto', label: 'Automatic' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} /></div>
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Text size</span><span className="c2">{SIZE_NAMES[idx]}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="t-sub" aria-hidden="true">A</span>
            <input type="range" min={0} max={4} step={1} value={idx} aria-label="Text size" aria-valuetext={SIZE_NAMES[idx]} style={{ flex: 1, accentColor: 'var(--accent)', height: '2.75rem' }} onChange={(e) => { haptic('select'); setPref('textScale', SIZES[Number(e.target.value)]); }} />
            <span className="t-title2" aria-hidden="true">A</span>
          </div>
        </div>
        <Toggle k="contrast" icon="sun" title="Increase contrast" sub="Stronger text and separators" />
        <div className="row">
          <span className="lead" style={{ background: 'var(--fill)', color: 'var(--fg-2)' }}><Icon name="waves" /></span>
          <span className="grow"><span style={{ display: 'block' }}>Reduce motion</span><span className="t-foot c2">Follows your device setting unless switched on here</span></span>
          <Switch checked={prefs.motion === 'reduce'} onChange={(v) => setPref('motion', v ? 'reduce' : 'auto')} label="Reduce motion" />
        </div>
      </Group>

      <Group title="Feel" note="Phones with a vibration motor buzz. On a computer, the indicator shows what the phone would feel.">
        <Toggle k="haptics" icon="device" title="Haptics" sub="Light taps, a success pulse, a hard buzz for safety" />
        <Toggle k="showHaptics" icon="sparkle" title="Show haptic indicator" />
        <Toggle k="sound" icon="bell" title="Sounds" sub="Silent for routine items. Only safety and success tones" />
      </Group>

      <Group title="Keyboard" note="Single-key shortcuts: N for a new request, 1 to 7 to switch screens.">
        <Toggle k="shortcuts" icon="list" title="Keyboard shortcuts" sub="Turn off if you use voice control or a screen reader" />
      </Group>

      <Group title="Management view" note="While a pilot runs alongside radio and paper, timers and scorecards stay hidden from management.">
        <Toggle k="shadow" icon="hourglass" title="Shadow mode" sub="Hide timers from the duty manager and owner" />
      </Group>

      {!isRemote && <Group title="About this prototype">
        <Row icon="info" title="Synthetic data" sub="Every ticket, name and cost is made up. Nothing here is a real guest or staff record." />
        <div className="row"><Button variant="gray" block onClick={() => { resetApp(); toast('Demo data reset.', 'info'); }}>Reset demo data</Button></div>
      </Group>}
    </Screen>
  );
}
