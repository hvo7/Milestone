import { useState } from 'react';
import type { Action } from '../types';
import { useQuestStore, useUIStore } from '../store';
import PinButton from './PinButton';
import EditTitle from './EditTitle';
import Icon from './Icon';
import TaskEditDrawer from './TaskEditDrawer';
import { actionOnToday } from '../domain/schedule';

interface Props { action: Action; questlineId: string; questId: string; locked: boolean; parentRecurring?: boolean; }
export default function ActionItem({ action, questlineId, questId, locked }: Props) {
  const toggle = useQuestStore(s => s.toggleAction);
  const pin = useQuestStore(s => s.toggleTracked);
  const remove = useQuestStore(s => s.deleteAction);
  const restore = useQuestStore(s => s.toggleActionHidden);
  const editMode = useUIStore(s => s.editMode);
  const [editing, setEditing] = useState(false);
  if (action.hidden) return editMode ? <div style={{ padding: 8 }}>{action.title} · Hidden <button className="btn-ghost" onClick={() => restore(questlineId, questId, action.id)}>Restore task</button></div> : null;
  return <>
    <div className="quest-step" data-done={action.completed || undefined}>
      <input type="checkbox" className="rune-check rune-check-sm" aria-label={action.title} checked={action.completed} disabled={locked} onChange={() => toggle(questlineId, questId, action.id)} />
      <span className="quest-step-title"><EditTitle onEdit={() => setEditing(true)}>{action.title}</EditTitle></span>
      {action.recurring && <small style={{ color: 'var(--page-text-dim)' }}>{action.recurring}</small>}
      {!locked && <PinButton state={actionOnToday(action) ? 'all' : 'none'} onClick={() => pin(questlineId, questId, action.id)} title={actionOnToday(action) ? 'Remove from Today' : 'Pin to Today'} />}
      <button type="button" className="icon-btn-round quest-row-delete" aria-label={`Delete ${action.title}`} title="Delete step" onClick={() => remove(questlineId, questId, action.id)}><Icon name="close" size={14} /></button>
    </div>
    {editing && <TaskEditDrawer target={{ kind: 'action', qlId: questlineId, qId: questId, aId: action.id }} onClose={() => setEditing(false)} />}
  </>;
}
