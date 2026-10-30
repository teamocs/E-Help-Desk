import { useId, useState } from 'react';
import { myStaff, toast, useApp } from '../../domain/store';
import { haptic } from '../../lib/haptics';
import { Button } from '../../ui/kit';
import { Sheet } from '../../ui/sheet';
import { logInquiry, TYPE_LABEL, type InquiryType } from './data';
import { Field, aria } from './fields';

const TYPES = Object.keys(TYPE_LABEL) as InquiryType[];
const NAME_MAX = 120;
const ROOM_MAX = 40;
const DESC_MAX = 2000;

function Body({ onClose }: { onClose: () => void }) {
  const base = useId();
  const staff = useApp((s) => s.staff);
  const me = useApp(myStaff);
  const officers = staff.filter((p) => p.role === 'hdo');
  const [type, setType] = useState<InquiryType>('in_house');
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  // The prototype defaults to the first officer; the person logging it comes first when they are one.
  const [hdo, setHdo] = useState(officers.find((p) => p.id === me?.id)?.id ?? officers[0]?.id ?? '');
  const [desc, setDesc] = useState('');
  const [tried, setTried] = useState(false);
  const errors = {
    name: !name.trim() ? 'Enter the name of who is asking' : '',
    desc: !desc.trim() ? 'Describe the inquiry' : '',
  };
  const id = (k: string) => `${base}-${k}`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (errors.name || errors.desc) {
      document.getElementById(id(errors.name ? 'name' : 'desc'))?.focus();
      return;
    }
    logInquiry({ type, name, room, hdo, desc });
    haptic('success');
    toast('Inquiry logged', 'success');
    onClose();
  };

  return (
    <form className="mod-form" onSubmit={submit} noValidate>
      <div className="mod-pair">
        <Field id={id('type')} label="Type">
          <select className="field" {...aria(id('type'))} value={type} onChange={(e) => setType(e.target.value as InquiryType)}>
            {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field id={id('name')} label="Name" error={tried ? errors.name : ''}>
          <input className="field" {...aria(id('name'), tried ? errors.name : '')} data-autofocus value={name} maxLength={NAME_MAX} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <div className="mod-pair">
        <Field id={id('room')} label="Room" optional>
          <input className="field" {...aria(id('room'))} value={room} maxLength={ROOM_MAX} inputMode="text" autoComplete="off" onChange={(e) => setRoom(e.target.value)} />
        </Field>
        <Field id={id('hdo')} label="HDO">
          <select className="field" {...aria(id('hdo'))} value={hdo} onChange={(e) => setHdo(e.target.value)}>
            {officers.length === 0 && <option value="">No help desk officers yet</option>}
            {officers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <Field id={id('desc')} label="Description" error={tried ? errors.desc : ''}>
        <textarea className="field" {...aria(id('desc'), tried ? errors.desc : '')} rows={4} value={desc} maxLength={DESC_MAX} onChange={(e) => setDesc(e.target.value)} />
      </Field>
      <div className="mod-actions">
        <Button variant="gray" onClick={onClose}>Cancel</Button>
        <button type="submit" className="btn btn-fill" onClick={() => haptic('medium')}>Submit</button>
      </div>
    </form>
  );
}

export function InquiryForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} title="New Inquiry" onClose={onClose}>
      <Body onClose={onClose} />
    </Sheet>
  );
}
