import type { Questline, Routine, System } from '../types';
import { routineSystemIds } from '../domain/taskState';

export function routineIsArchived(routine: Routine, questlines: Questline[], systems: System[]): boolean {
  if (routine.hidden) return true;
  const parent = questlines.find(ql => ql.id === routine.questlineId);
  if (parent?.hidden || parent?.quests.some(q => q.id === routine.questId && q.hidden)) return true;
  const linked = routineSystemIds(routine).map(id => systems.find(s => s.id === id)).filter((s): s is System => !!s);
  return linked.length > 0 && linked.every(s => s.hidden);
}
