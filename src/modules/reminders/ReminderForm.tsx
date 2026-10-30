import { useId, useMemo, useState } from 'react';
import { myStaff, toast, useApp, useUI } from '../../domain/store';
import { haptic } from '../../lib/haptics';
import { Button } from '../../ui/kit';
import { Sheet } from '../../ui/sheet';
import { Field, aria } from '../inquiries/fields';
import { fromInput } from '../inquiries/hotelTime';
import { ALL_HD, addReminder, assignable, linkOptions } from './data';

const DESC_MAX = 200;
const NOTES_MAX = 2000;

function Body({ onClose }: { onClose: () => void }) {
  const base = useId();
  const state = useApp((s) => s);
  const me = useApp(myStaff);
  const shared = useUI((s) => s.account.role === 'device');
  // A help-desk officer on a shared phone sets reminders for themselves or All HD Staff only (the server enforces it).
  const restricted = shared && me?.role === 'hdo';
  const people = restricted && me ? [me] : assignable(state.staff);
  const links = useMemo(() => linkOptions(state), [state]);
  const [desc, setDesc] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [link, setLink] = useState('');
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);
  const id = (k: string) => `${base}-${k}`;
  const errors = { desc: !desc.trim() ? 'Describe what needs following up' : '', due: due && fromInput(due) == null ? 'Choose a valid date and time' : '' };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (errors.desc || errors.due) {
      document.getElementById(id(errors.desc ? 'desc' : 'due'))?.focus();
      return;
    }
    addReminder({ desc, assignee, dueAt: fromInput(due), link: links.find((l) => l.key === link) ?? null, notes });
    haptic('success');
    toast('Reminder created', 'success');
    onClose();
  };

  return (
    <form className="mod-form" onSubmit={submit} noValidate>
      <Field id={id('desc')} label="Description" error={tried ? errors.desc : ''}>
        <input className="field" {...aria(id('desc'), tried ? errors.desc : '')} data-autofocus value={desc} maxLength={DESC_MAX} autoComplete="off" onChange={(e) => setDesc(e.target.value)} />
      </Field>
      <div className="mod-pair">
        <Field id={id('to')} label="Assigned">
          <select className="field" {...aria(id('to'))} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">{ALL_HD}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field id={id('due')} label="Scheduled" optional error={tried ? errors.due : ''} hint="In hotel time (Manila).">
          <input type="datetime-local" className="field" {...aria(id('due'), tried ? errors.due : '', true)} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
      <Field id={id('link')} label="Link to" optional>
        <select className="field" {...aria(id('link'))} value={link} onChange={(e) => setLink(e.target.value)}>
          <option value="">— None —</option>
          {links.map((l) => <option key={l.key} value={l.key}>{l.text}</option>)}
        </select>
      </Field>
      <Field id={id('notes')} label="Notes" optional>
        <textarea className="field" {...aria(id('notes'))} rows={3} value={notes} maxLength={NOTES_MAX} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="mod-actions">
        <Button variant="gray" onClick={onClose}>Cancel</Button>
        <button type="submit" className="btn btn-fill" onClick={() => haptic('medium')}>Create</button>
      </div>
    </form>
  );
}

export function ReminderForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} title="New Reminder" onClose={onClose}>
      <Body onClose={onClose} />
    </Sheet>
  );
}
