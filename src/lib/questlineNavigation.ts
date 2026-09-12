import type { Questline, Routine, System } from '../types';
import { routineSystemIds, systemGoalIds, systemQuestIds } from '../domain/taskState';

/** Links are a view over existing records, never a new owner or a migration. */
export function systemServesQuestline(system: System, questline: Questline): boolean {
  return systemGoalIds(system).includes(questline.id)
    || systemQuestIds(system).some(id => questline.quests.some(q => q.id === id));
}

/** Hidden or unresolved links still count as links. Do not silently refile them. */
export function isUnlinkedSystem(system: System): boolean {
  return systemGoalIds(system).length === 0 && systemQuestIds(system).length === 0;
}

export function routineServesQuestline(routine: Routine, questline: Questline): boolean {
  return routine.questlineId === questline.id
    || !!routine.questId && questline.quests.some(q => q.id === routine.questId);
}

/** A dangling/hidden membership must not make a saved habit disappear. */
export function hasVisibleSystem(routine: Routine, systems: System[]): boolean {
  return routineSystemIds(routine).some(id => systems.some(s => s.id === id && !s.hidden));
}

export type QuestlineSelection = { kind: 'questline'; id: string } | { kind: 'general' } | { kind: 'all' };

export function readQuestlineSelection(params: URLSearchParams, questlines: Questline[], allowAll = false): QuestlineSelection {
  const id = params.get('questline');
  if (id && questlines.some(q => q.id === id)) return { kind: 'questline', id };
  if (params.get('view') === 'general') return { kind: 'general' };
  if (allowAll) return { kind: 'all' };
  return questlines[0] ? { kind: 'questline', id: questlines[0].id } : { kind: 'general' };
}

export function selectionParams(selection: QuestlineSelection): URLSearchParams {
  return new URLSearchParams(selection.kind === 'questline' ? { questline: selection.id } : { view: selection.kind });
}

export function questlineHref(page: 'quests' | 'systems', id: string): string {
  return `/${page}?${selectionParams({ kind: 'questline', id })}`;
}
