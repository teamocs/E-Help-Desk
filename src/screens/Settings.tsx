import { ROLE_LABEL } from '../domain/rules';
import { app, canEditLists, lock, setPref, useApp, useUI, type AccountRole } from '../domain/store';
import { Lists } from './Lists';
import { staffApi } from '../domain/staffApi';
import { haptic } from '../lib/haptics';
import { Avatar, Button, Group, Icon, Screen, Switch } from '../ui/kit';
import { Logins } from './Logins';
import { StaffAdmin } from './StaffAdmin';
import type { Prefs } from '../domain/types';

const SIZES = [0.9, 1, 1.12, 1.28, 1.48];
const SIZE_NAMES = ['Small', 'Default', 'Large', 'Larger', 'Largest'];

/** The Lists section: owners and managers on their own account (not while acting as a PIN person). */
export const showLists = (role: AccountRole, asAccount: boolean) => asAccount && canEditLists(role);

function Toggle({ icon, title, sub, k }: { icon: string; title: string; sub?: string; k: 'contrast' | 'haptics' | 'sound' | 'shortcuts' }) {
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
  const role = useUI((s) => s.account.role);
  const deviceOnly = useUI((s) => s.deviceOnly);
  const idx = Math.max(0, SIZES.findIndex((x) => x >= prefs.textScale));
  const asAccount = me?.id === 'member';
  return (
    <Screen title="Settings" subtitle="Comfortable at 3 a.m. on a shared phone.">
      {me && (
        <Group title="Signed in">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Avatar staff={me} large />
            <span className="grow"><span className="t-head" style={{ display: 'block' }}>{me.name}</span><span className="t-foot c2">{me.title}{me.title.toLowerCase().includes(ROLE_LABEL[me.role].toLowerCase()) ? '' : ` · ${ROLE_LABEL[me.role]}`}</span></span>
            <Button size="sm" variant="gray" icon="user" onClick={async () => { if (deviceOnly) { await staffApi.current?.signOut(); app.set((s) => ({ ...s, me: null })); } lock(); }}>Switch person</Button>
          </div>
          {!deviceOnly && !asAccount && (
            <div className="row">
              <Button variant="gray" block onClick={async () => { await staffApi.current?.signOut(); app.set((s) => ({ ...s, me: 'member' })); }}>Back to my own account</Button>
            </div>
          )}
        </Group>
      )}

      {asAccount && (role === 'owner' || role === 'manager') && <StaffAdmin />}
      {showLists(role, asAccount) && <Lists />}
      {asAccount && role === 'owner' && <Logins />}

      <Group title="Display">
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><label htmlFor="ts">Text size</label><span className="c2">{SIZE_NAMES[idx]}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="t-sub" aria-hidden="true">A</span>
            <input id="ts" type="range" min={0} max={4} step={1} value={idx} aria-valuetext={SIZE_NAMES[idx]} style={{ flex: 1, accentColor: 'var(--accent-strong)', height: '2.75rem' }} onChange={(e) => { haptic('select'); setPref('textScale', SIZES[Number(e.target.value)]); }} />
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

      <Group title="Feel" note="Phones with a vibration motor buzz. Computers stay silent apart from the sounds.">
        <Toggle k="haptics" icon="device" title="Vibration" sub="A short buzz on taps, a strong one for safety" />
        <Toggle k="sound" icon="bell" title="Sounds" sub="Only safety alerts and finished items make a sound" />
      </Group>

      <Group title="Keyboard" note="Single-key shortcuts: N for a new request, 1 to 6 to switch screens.">
        <Toggle k="shortcuts" icon="list" title="Keyboard shortcuts" sub="Turn off if you use voice control or a screen reader" />
      </Group>
    </Screen>
  );
}
