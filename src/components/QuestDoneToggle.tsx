import type { Quest } from '../types';
import { isQuestComplete, useQuestStore } from '../store';

interface Props {
  questlineId: string;
  quest: Quest;
  /** A sequential gate that hasn't opened yet — show a padlock, not a checkbox. */
  locked?: boolean;
  /** Small variant, sized for the compact quest rows on the Quests tab. */
  small?: boolean;
}

/**
 * Spells out the cascade before the click. `setQuestComplete` has always written
 * straight through to every task, which stayed invisible while Today was its
 * only caller — there the quest is one pinned line and its tasks aren't on
 * screen. On a quest that owns tasks, an unlabelled box would silently tick, or
 * clear, all of them.
 */
function toggleTitle(quest: Quest, complete: boolean): string {
  const n = quest.actions.filter(a => !a.hidden).length;
  if (n === 0) return complete ? 'Mark this quest not done' : 'Mark this quest done';
  const tasks = `${n} task${n === 1 ? '' : 's'}`;
  return complete ? `Uncheck all ${tasks}` : `Mark all ${tasks} done`;
}

/**
 * Marks a whole quest done in place — the direct alternative to pinning it to
 * Today and ticking it there, which used to be the only route: Today's toggle
 * was the sole caller of `setQuestComplete`, so a quest with no sub-tasks had no
 * completion affordance on any quest surface.
 */
export default function QuestDoneToggle({ questlineId, quest, locked = false, small = false }: Props) {
  const setQuestComplete = useQuestStore(s => s.setQuestComplete);
  const complete = isQuestComplete(quest);

  if (locked) {
    return (
      <span
        title="Complete the previous quest to unlock"
        style={{
          fontSize: small ? 12 : 13, width: small ? 15 : 19,
          textAlign: 'center', flexShrink: 0, opacity: 0.6,
        }}
      >
        🔒
      </span>
    );
  }

  return (
    <input
      type="checkbox"
      className={small ? 'rune-check rune-check-sm' : 'rune-check'}
      checked={complete}
      title={toggleTitle(quest, complete)}
      // Quest rows expand when clicked, so the checkbox must not bubble.
      onClick={e => e.stopPropagation()}
      onChange={() => setQuestComplete(questlineId, quest.id, !complete)}
    />
  );
}
