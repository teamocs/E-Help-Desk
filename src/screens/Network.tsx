import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ago, hubUp } from '../domain/rules';
import { openComposer, paperMode, resetApp, setNet, setUI, useApp } from '../domain/store';
import { springs } from '../lib/motion';
import { Button, Group, Icon, NetPill, Pill, Row, Screen, Segmented, Switch } from '../ui/kit';

type Cmd = 'sync' | 'interfaces' | 'logging';
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });

function Console({ cmd }: { cmd: Cmd }) {
  const s = useApp((x) => x);
  const lan = s.net.power || s.net.ups > 0;
  const wan = s.net.internet && s.net.power;
  const hub = hubUp(s.net);
  const pend = s.ops.filter((o) => !o.synced).length;
  const up = (b: boolean): ReactNode => <span className={b ? 'p' : 'e'}>{b ? 'up' : 'down'}</span>;
  const prompt = (c: string) => <><span className="d">azalea-edge# </span>{c}{'\n'}</>;

  if (cmd === 'sync')
    return (
      <>
        {prompt('show sync status')}
        {`Tier               ${s.net.tier === 'resilient' ? 'resilient (edge node on LAN)' : 'standard (cloud)'}\n`}
        {'Hub reachable      '}{up(hub)}{'\n'}
        {'Device wifi        '}{up(s.net.deviceWifi)}{'\n'}
        {`Queue              ${pend} pending, 0 failed\n`}
        {`Clock source       hybrid logical clock + server receipt\n`}
        {`Station B          ${hubUp(s.net, false) ? 'in sync' : 'isolated'}, last ${ago(s.now - s.stationB.lastSync)} ago\n`}
      </>
    );
  if (cmd === 'interfaces')
    return (
      <>
        {prompt('show ip interface brief')}
        <span className="d">{'Interface          IP-Address       Status   Protocol\n'}</span>
        {'Gi0/0 uplink      203.0.113.10     '}{up(s.net.internet)}{'     '}{up(wan)}{'\n'}
        {'Gi0/1 edge-lan    192.0.2.1        '}{up(lan)}{'     '}{up(lan)}{'\n'}
        {'Vlan20 staff-wifi 192.0.2.33       '}{up(lan && s.net.deviceWifi)}{'     '}{up(lan && s.net.deviceWifi)}{'\n'}
        {'Vlan30 guest-wifi 198.51.100.1     '}{up(wan)}{'     '}{up(wan)}{'\n'}
        {'Ups0 battery      '}<span className={s.net.ups > 25 ? 'p' : s.net.ups > 0 ? 'w' : 'e'}>{`${Math.round(s.net.ups)}%`}</span>{`${s.net.power ? '  on mains' : '  on battery'}\n`}
        <span className="d">{'! read-only view. Staff and guest networks are separate VLANs.\n'}</span>
      </>
    );
  return (
    <>
      {prompt('show logging')}
      {s.netlog.slice(0, 8).map((l, i) => <span key={i}><span className="d">{clock(l.at)}</span>{`  ${l.text}\n`}</span>)}
    </>
  );
}

export function Network() {
  const net = useApp((s) => s.net);
  const s = useApp((x) => x);
  const ops = useApp((x) => x.ops);
  const b = useApp((x) => x.stationB);
  const now = useApp((x) => x.now);
  const reconciling = useApp((x) => x.reconciling);
  const [cmd, setCmd] = useState<Cmd>('sync');
  const paper = paperMode(s);
  const hub = hubUp(net);
  const lan = net.power || net.ups > 0;
  const pend = ops.filter((o) => !o.synced).length;
  const bReach = hubUp(net, false);

  const layers = [
    { n: 'Internet', d: net.internet && net.power ? 'Cloud backup and remote access' : 'Down. Only off-site features pause', ok: net.internet && net.power, icon: 'cloud' },
    { n: 'Hotel network', d: net.tier === 'resilient' ? (lan ? 'Edge node shares tickets on site' : 'Edge node is off') : 'Not used in the Standard tier', ok: net.tier === 'resilient' ? lan : false, icon: 'cpu', na: net.tier === 'standard' },
    { n: 'This device', d: net.deviceWifi ? 'Connected to Wi-Fi' : 'Out of range. Saving taps on the device', ok: net.deviceWifi, icon: 'device' },
    { n: 'Paper kit', d: paper ? 'In use. Re-enter entries when power returns' : 'Ready in the front office drawer', ok: !paper, icon: 'printer' },
  ];

  return (
    <Screen title="Network" subtitle="Break things on purpose. See what keeps working." trailing={<NetPill />}>
      <Group title="Service level">
        <div className="row"><Segmented label="Service level" value={net.tier} onChange={(tier) => setNet({ tier }, `Tier set to ${tier}`)} options={[{ value: 'standard', label: 'Standard (cloud)' }, { value: 'resilient', label: 'Resilient (edge node)' }]} /></div>
      </Group>

      <Group title="Pull the plug">
        <div className="row"><span className="lead" style={{ background: 'var(--fill)' }}><Icon name="cloud" size={19} /></span><span className="grow">Internet connection</span><Switch checked={net.internet} onChange={(v) => setNet({ internet: v }, v ? 'Internet restored' : 'Internet lost (ISP outage)')} label="Internet connection" /></div>
        <div className="row"><span className="lead" style={{ background: 'var(--fill)' }}><Icon name="wifi" size={19} /></span><span className="grow">This device’s Wi-Fi<span className="t-foot c2" style={{ display: 'block' }}>A stairwell or basement dead zone</span></span><Switch checked={net.deviceWifi} onChange={(v) => setNet({ deviceWifi: v }, v ? 'Device back in Wi-Fi range' : 'Device left Wi-Fi range')} label="This device Wi-Fi" /></div>
        <div className="row"><span className="lead" style={{ background: 'var(--fill)' }}><Icon name="bolt" size={19} /></span><span className="grow">Mains power<span className="t-foot c2" style={{ display: 'block' }}>Battery backup runs the edge node and Wi-Fi</span></span><Switch checked={net.power} onChange={(v) => setNet({ power: v }, v ? 'Mains power restored' : 'Power cut. Running on UPS')} label="Mains power" /></div>
        {(!net.power || net.ups < 100) && (
          <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <span className="t-sub c2">Battery backup {Math.round(net.ups)}%</span>
            <span className="track"><motion.i animate={{ width: `${net.ups}%` }} transition={springs.snappy} style={{ background: net.ups > 25 ? 'var(--ok)' : 'var(--bad)' }} /></span>
          </div>
        )}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button size="sm" variant="tint" icon="plus" onClick={() => openComposer()}>Log a request now</Button>
          <Button size="sm" variant="gray" icon="refresh" onClick={() => { setNet({ internet: true, deviceWifi: true, power: true }, 'All services restored'); }}>Restore everything</Button>
        </div>
      </Group>

      {paper && (
        <div className="banner bad" style={{ marginTop: 14 }} role="alert">
          <Icon name="printer" weight="fill" />
          <span><b>Battery is empty.</b> Switch to the paper kit. <button type="button" className="btn btn-plain" style={{ minHeight: 0, padding: 0, textDecoration: 'underline' }} onClick={() => setUI({ sheet: 'paper' })}>Open the paper kit</button></span>
        </div>
      )}

      <Group title="What this device sees">
        <div className="layers" style={{ padding: 0 }}>
          {layers.map((l, i) => (
            <motion.div key={l.n} className="layer" layout transition={springs.snappy} style={{ borderRadius: 0, background: 'transparent', position: 'relative' }}>
              {i > 0 && <span style={{ position: 'absolute', top: 0, left: 16, right: 0, height: 0.5, background: 'var(--sep)' }} />}
              <span className="lead" style={{ width: '2rem', height: '2rem', borderRadius: 8, display: 'grid', placeItems: 'center', background: l.na ? 'var(--fill)' : l.ok ? 'var(--ok-soft)' : 'var(--bad-soft)', color: l.na ? 'var(--fg-3)' : l.ok ? 'var(--ok)' : 'var(--bad)' }}><Icon name={l.icon} size={19} /></span>
              <span><span className="t-head" style={{ display: 'block' }}>{l.n}</span><span className="t-foot c2">{l.d}</span></span>
              <Pill tone={l.na ? '' : l.ok ? 'ok' : 'bad'}>{l.na ? 'Not used' : l.ok ? 'OK' : 'Down'}</Pill>
            </motion.div>
          ))}
        </div>
      </Group>

      <Group title="Station B: the housekeeping phone" note="Another person’s phone. It sees changes only after this device reaches the hub.">
        <div className="row">
          <span className="lead" style={{ background: bReach ? 'var(--ok-soft)' : 'var(--warn-soft)', color: bReach ? 'var(--ok)' : 'var(--warn)' }}><Icon name="phone" size={19} /></span>
          <span className="grow"><span className="t-head" style={{ display: 'block' }}>{b.requests} tickets · {b.open} open</span><span className="t-foot c2">Last updated {ago(now - b.lastSync)} ago</span></span>
          {pend > 0 ? <Pill tone="warn">{pend} behind</Pill> : <Pill tone="ok">In sync</Pill>}
        </div>
        <Row icon="device" title="This device" sub={hub ? 'Sending changes to the hub as you tap' : `Saving ${pend} change${pend === 1 ? '' : 's'} on the device. Nothing is lost.`} trailing={reconciling ? <Pill tone="warn">Catching up</Pill> : undefined} />
      </Group>

      <Group title="Edge node console" note="Read-only. Addresses are documentation ranges, not a real network.">
        <div className="row"><Segmented<Cmd> label="Command" value={cmd} onChange={setCmd} options={[{ value: 'sync', label: 'sync' }, { value: 'interfaces', label: 'interfaces' }, { value: 'logging', label: 'logging' }]} /></div>
        <div className="console" role="log" aria-label="Read-only console output" tabIndex={0}><Console cmd={cmd} /></div>
      </Group>

      <div style={{ marginTop: 18 }}>
        <Button variant="gray" block onClick={() => resetApp()}>Reset demo data</Button>
      </div>
    </Screen>
  );
}
