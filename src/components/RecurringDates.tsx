import type { Schedule } from '../types';
import { recurringDates } from '../lib/recurringDates';

export default function RecurringDates({ task, now }: { task: Schedule & { completed?: boolean }; now?: Date }) {
  const dates = recurringDates(task, now);
  const format = (key: string | null) => key
    ? new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'None';
  return <span data-recurring-dates style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11, color: 'var(--page-text-dim)' }}>
    <span>Current due: {format(dates.current)}</span>
    <span>Next due: {format(dates.next)}</span>
  </span>;
}
