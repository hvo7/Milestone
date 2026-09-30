import type { Schedule } from '../types';
import { repeats } from '../domain/schedule';
import { recurringDates } from '../lib/recurringDates';
import Field from './Field';

export default function ScheduleDueField({ schedule, value, onChange, editableRepeat = false }: {
  schedule: Schedule; value: string; onChange: (value: string) => void; editableRepeat?: boolean;
}) {
  const repeating = repeats(schedule);
  const dates = recurringDates(schedule, editableRepeat && value ? new Date(`${value}T12:00:00`) : new Date());
  return <Field label={repeating ? 'Current due date' : 'Due date · optional'}>
    <input aria-label={repeating ? 'Current due date' : 'Due date'} type={repeating && !editableRepeat && !dates.current ? 'text' : 'date'}
      readOnly={repeating && !editableRepeat} value={repeating ? (editableRepeat ? value || dates.current || '' : dates.current ?? 'None') : value}
      onChange={e => onChange(e.target.value)} className="rune-input"
      style={{ fontSize: 14, padding: '9px 12px', minHeight: 40 }} />
    <small style={{ minHeight: 18, fontSize: 11, color: 'var(--page-text-dim)' }}>
      {repeating ? `Next due: ${dates.next ? new Date(`${dates.next}T12:00:00`).toLocaleDateString() : 'None'} · Calculated from repeat schedule` : 'No date required'}
    </small>
  </Field>;
}
