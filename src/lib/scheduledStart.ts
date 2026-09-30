import type { Schedule } from '../types';

/** Anchor an interval's open cycle to the date chosen in a creation form.
 * Keep this separate from one-off deadlines, which do not advance on reset. */
export function scheduledStart(schedule: Schedule, date: string): Schedule {
  if (!date || schedule.monthlyRule || (!schedule.recurring && !schedule.intervalDays)) return schedule;
  const due = new Date(`${date}T12:00:00`);
  if (!Number.isFinite(due.getTime())) return schedule;
  const days = schedule.intervalDays || (schedule.recurring === 'weekly' ? 7 : schedule.recurring === 'monthly' ? 30 : 1);
  due.setDate(due.getDate() - days + 1);
  due.setHours(2, 0, 0, 0);
  return { ...schedule, intervalDays: days, lastResetAt: due.toISOString() };
}
