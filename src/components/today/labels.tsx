/** The small captions under a Today row's title — due dates, "3/5 this cycle",
 *  recurrence hints. One component so they all sit on the same line consistently. */
import { getTaskDueInfo } from '../../vynuesStore';

export const Caption = ({ color = 'var(--page-text-dim)', children }: { color?: string; children: React.ReactNode }) =>
  <span style={{ fontSize: 11, fontWeight: 600, color }}>{children}</span>;

/** Compact due-date pill for a one-time To-Do row. */
export function DueLabel({ dueDate, todayKey }: { dueDate: string; todayKey: string }) {
  const date = dueDate.slice(0, 10);
  const overdue = date < todayKey;
  const today = date === todayKey;
  const text = overdue ? 'Overdue' : today ? 'Due today'
    : `Due ${new Date(`${date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  return <Caption color={overdue ? 'var(--danger)' : today ? 'var(--accent)' : 'var(--text-dim)'}>{text}</Caption>;
}

/** Due pill for a Vynues task, whose due dates can carry a time of day. */
export function VynuesDueLabel({ dueDate }: { dueDate: string }) {
  const { text, urgency } = getTaskDueInfo(dueDate);
  return (
    <Caption color={urgency === 'overdue' ? 'var(--danger)' : urgency === 'urgent' ? 'var(--accent)' : 'var(--text-dim)'}>
      {text}
    </Caption>
  );
}
