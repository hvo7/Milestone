import type { Questline, System } from '../types';
import { questlineProgress } from '../domain/taskState';
import { systemServesQuestline, type QuestlineSelection } from '../lib/questlineNavigation';
import QuestIcon from './QuestIcon';

export default function QuestlineSidebar({ questlines, systems, selection, onSelect, mode }: {
  questlines: Questline[];
  systems: System[];
  selection: QuestlineSelection;
  onSelect: (selection: QuestlineSelection) => void;
  mode: 'quests' | 'systems';
}) {
  return (
    <nav className="questline-sidebar" aria-label="Questline navigation">
      <label className="questline-mobile-filter">
        <span>{mode === 'systems' ? 'Show systems for' : 'Show quests for'}</span>
        <select value={selection.kind === 'questline' ? `questline:${selection.id}` : selection.kind}
          onChange={event => {
            const value = event.target.value;
            onSelect(value.startsWith('questline:') ? { kind: 'questline', id: value.slice(10) } : value === 'all' ? { kind: 'all' } : { kind: 'general' });
          }}>
          {mode === 'systems' && <option value="all">All systems</option>}
          {questlines.map(ql => <option key={ql.id} value={`questline:${ql.id}`}>{ql.title}</option>)}
          <option value="general">General</option>
        </select>
      </label>
      <div className="questline-desktop-nav">
      {mode === 'systems' && <button type="button" className="questline-nav-item" aria-pressed={selection.kind === 'all'} onClick={() => onSelect({ kind: 'all' })}>All systems</button>}
      <div className="questline-nav-label">Questlines</div>
      {questlines.map(ql => {
        const progress = questlineProgress(ql);
        const count = systems.filter(s => !s.hidden && systemServesQuestline(s, ql)).length;
        return (
          <button type="button" key={ql.id} className="questline-nav-item" aria-pressed={selection.kind === 'questline' && selection.id === ql.id} onClick={() => onSelect({ kind: 'questline', id: ql.id })}>
            <QuestIcon icon={ql.icon} size={18} />
            <span className="questline-nav-copy"><span>{ql.title}</span><small>{ql.hidden ? 'Hidden · edit to restore' : mode === 'quests' ? `${progress.done} / ${progress.total} quests complete` : `${count} supporting system${count === 1 ? '' : 's'}`}</small></span>
          </button>
        );
      })}
      {!questlines.length && <p className="questline-empty-nav">No questlines yet.</p>}
      <div className="questline-nav-separator" />
      <button type="button" className="questline-nav-item" aria-pressed={selection.kind === 'general'} onClick={() => onSelect({ kind: 'general' })}>
        <span className="questline-nav-copy"><span>General</span><small>{mode === 'quests' ? 'Tasks & commitments' : 'Systems without a questline'}</small></span>
      </button>
      </div>
    </nav>
  );
}
