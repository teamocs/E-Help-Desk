import { ROLE_LABEL } from '../domain/rules';
import { app, canEditLists, lock, setPref, useApp, useUI, type AccountRole } from '../domain/store';
import { staffApi } from '../domain/staffApi';
import { haptic } from '../lib/haptics';
import { Avatar, Button, Icon, Switch } from '../ui/kit';
import type { Prefs } from '../domain/types';

// The pieces of the Configuration page that belong to this device and the person using it (src/modules/config).

const SIZES = [0.9, 1, 1.12, 1.28, 1.48];
const SIZE_NAMES = ['Small', 'Default', 'Large', 'Larger', 'Largest'];

/** The lists editors: owners and managers on their own account (not while acting as a PIN person). */
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

/** Who is signed in, with Switch person (the user menu has it too) and the way back to one's own account. */
export function SignedIn() {
  const me = useApp((s) => s.staff.find((p) => p.id === s.me));
  const deviceOnly = useUI((s) => s.deviceOnly);
  if (!me) return null;
  const asAccount = me.id === 'member';
  return (
    <div className="group cfg-who">
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
    </div>
  );
}

/** Text size, contrast and motion, for this device. */
export function DisplayPrefs() {
  const prefs = useApp((s) => s.prefs);
  const idx = Math.max(0, SIZES.findIndex((x) => x >= prefs.textScale));
  return (
    <div className="group">
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
    </div>
  );
}

/** Vibration, sounds and keyboard shortcuts, for this device. */
export function FeelPrefs() {
  return (
    <>
      <div className="group">
        <Toggle k="haptics" icon="device" title="Vibration" sub="A short buzz on taps, a strong one for safety" />
        <Toggle k="sound" icon="bell" title="Sounds" sub="Only safety alerts and finished items make a sound" />
        <Toggle k="shortcuts" icon="list" title="Keyboard shortcuts" sub="N for a new request, 1 to 9 for the first nine screens. Turn off if you use voice control or a screen reader." />
      </div>
      <p className="t-foot c2" style={{ padding: '8px 4px 0', margin: 0 }}>Phones with a vibration motor buzz. Computers stay silent apart from the sounds.</p>
    </>
  );
}
