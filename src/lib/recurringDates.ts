import type { Schedule } from '../types';
import { dateKey, dueOnDay, logicalDayStart, repeats } from '../domain/schedule';

/** Display-only dates from the existing recurrence engine, not new deadlines.
 * Current means the open cycle's due date; completing it leaves current blank.
 * Calendar rules have no current occurrence between their scheduled days. */
export function recurringDates(task: Schedule & { completed?: boolean }, now = new Date()): { current: string | null; next: string | null } {
  if (!repeats(task)) return { current: null, next: null };
  const today = logicalDayStart(now);
  // Daily/weekly/calendar rules can be resolved without an interval anchor.
  if (!task.monthlyRule && (task.intervalDays || task.recurring === 'monthly') && (!task.lastResetAt || !Number.isFinite(Date.parse(task.lastResetAt)))) {
    return { current: null, next: null };
  }
  const find = (schedule: Schedule, from: Date): Date | null => {
    const day = new Date(from);
    // Bound malformed or extremely distant schedules instead of locking the UI.
    for (let i = 0; i < 3660; i++, day.setDate(day.getDate() + 1)) {
      if (dueOnDay(schedule, day)) return new Date(day);
    }
    return null;
  };
  const due = find(task, today);
  if (!due) return { current: null, next: null };
  if (task.monthlyRule && dateKey(due) !== dateKey(today)) return { current: null, next: dateKey(due) };
  const after = new Date(due);
  after.setDate(after.getDate() + 1);
  let nextSchedule = task;
  if (!task.monthlyRule && (task.intervalDays || task.recurring === 'monthly')) {
    // These cycles restart after the current due day; use the same engine to
    // calculate the following cycle, including its local-day boundary.
    const reset = task.intervalDays ? new Date(after) : new Date(Date.parse(task.lastResetAt!) + 30 * 86_400_000);
    if (task.intervalDays) reset.setHours(2);
    nextSchedule = { ...task, lastResetAt: reset.toISOString() };
  }
  const next = find(nextSchedule, after);
  return { current: task.completed ? null : dateKey(due), next: next ? dateKey(next) : null };
}
