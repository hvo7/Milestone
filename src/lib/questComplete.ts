/**
 * The quest-complete toast: when a check-off finishes a quest, the undo offer
 * names the quest, shows its questline's art tile and — in a sequential
 * questline — says which quest that unlocked. Undo puts back everything the
 * check-off changed.
 */
import { useQuestStore, isQuestComplete } from '../store';
import { isQuestUnlocked } from '../domain/taskState';
import { useUndoStore } from './undo';
import { cleanQuest } from './ui';
import { questArtwork } from './questArtwork';
import type { Questline, Quest } from '../types';

const IMAGE_ICON = /^(data:|blob:|https?:)/;

/** A questline's art tile: its own picture when it has one, else the illustration. */
export const questlineArt = (ql: Pick<Questline, 'id' | 'title' | 'icon'>): string =>
  ql.icon && IMAGE_ICON.test(ql.icon) ? ql.icon : questArtwork(ql.title, ql.id);

export interface QuestCompleteNotice { label: string; detail?: string; art: string }

/** What the toast says for `quest` having just been finished, given the questline
 *  as it was before and as it is now. */
export function questCompleteNotice(before: Questline, after: Questline, quest: Quest): QuestCompleteNotice {
  const unlocked = after.sequential
    ? after.quests.find(q => !q.hidden && q.id !== quest.id && !isQuestComplete(q)
        && isQuestUnlocked(after, q)
        && !isQuestUnlocked(before, before.quests.find(b => b.id === q.id) ?? q))
    : undefined;
  return {
    label: `Quest complete · ${cleanQuest(quest.title)}`,
    detail: unlocked ? `${cleanQuest(unlocked.title)} unlocked` : undefined,
    art: questlineArt(after),
  };
}

/**
 * Runs a check-off against a quest. If that finished the quest, raises the
 * quest-complete toast, whose Undo restores the quest data, the completion log
 * and the task history exactly as they were.
 */
export function withQuestCompleteToast(qlId: string, qId: string, run: () => void): void {
  const state = useQuestStore.getState();
  const snapshot = { questlines: state.questlines, completionLog: state.completionLog, taskHistory: state.taskHistory };
  const before = state.questlines.find(ql => ql.id === qlId);
  const wasComplete = !!before?.quests.some(q => q.id === qId && isQuestComplete(q));
  run();
  if (!before || wasComplete) return;
  const after = useQuestStore.getState().questlines.find(ql => ql.id === qlId);
  const quest = after?.quests.find(q => q.id === qId);
  if (!after || !quest || !isQuestComplete(quest)) return;
  const notice = questCompleteNotice(before, after, quest);
  useUndoStore.getState().push(notice.label, () => useQuestStore.setState(snapshot), undefined,
    { detail: notice.detail, art: notice.art });
}
