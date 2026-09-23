import { useState } from 'react';
import type { Questline, System } from '../types';
import { useQuestStore } from '../store';
import { questlineProgress } from '../domain/taskState';
import { systemServesQuestline, type QuestlineSelection } from '../lib/questlineNavigation';
import QuestArtwork from './QuestArtwork';

export default function QuestlineSidebar({ questlines, systems, selection, onSelect, mode }: {
  questlines: Questline[];
  systems: System[];
  selection: QuestlineSelection;
  onSelect: (selection: QuestlineSelection) => void;
  mode: 'quests' | 'systems';
}) {
  const reorder = useQuestStore(s => s.reorderQuestlines);
  const [editing, setEditing] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  function move(id: string, targetId: string, after: boolean) {
    if (id === targetId) return;
    const ids = questlines.map(q => q.id);
    if (!ids.includes(id) || !ids.includes(targetId)) return;
    const next = ids.filter(key => key !== id);
    next.splice(next.indexOf(targetId) + (after ? 1 : 0), 0, id);
    reorder(next);
    setAnnouncement(`${questlines.find(q => q.id === id)?.title} moved to position ${next.indexOf(id) + 1}.`);
  }
  return (
    <nav className="questline-sidebar" aria-label="Questline navigation">
      <div className="questline-order-toolbar">
        <span>Questlines</span>
        <button type="button" className="btn-ghost" aria-pressed={editing} disabled={questlines.length < 2 && !editing}
          onClick={() => {
            // Preserve the current detail pane when its default first row moves.
            if (!editing) onSelect(selection);
            setEditing(!editing); setDragged(null); setDrop(null);
          }}>{editing ? 'Done' : 'Edit order'}</button>
      </div>
      {editing && <p className="questline-order-help">Drag the handles to reorder, or use the arrows. Changes save automatically across Quests and Systems.</p>}
      <span className="questline-order-announcement" role="status">{announcement}</span>
      <label className="questline-mobile-filter">
        <span>{mode === 'systems' ? 'Show systems for' : 'Show quests for'}</span>
        <select value={selection.kind === 'questline' ? `questline:${selection.id}` : selection.kind}
          onChange={event => {
            const value = event.target.value;
            onSelect(value.startsWith('questline:') ? { kind: 'questline', id: value.slice(10) } : value === 'all' ? { kind: 'all' } : { kind: 'general' });
          }}>
          <option value="general">General</option>
          {mode === 'systems' && <option value="all">All systems</option>}
          {questlines.map(ql => <option key={ql.id} value={`questline:${ql.id}`}>{ql.title}</option>)}
        </select>
      </label>
      <div className={`questline-desktop-nav${editing ? ' questline-order-editing' : ''}`}>
      <button type="button" className="questline-nav-item" aria-pressed={selection.kind === 'general'} onClick={() => onSelect({ kind: 'general' })}>
        <span className="questline-nav-copy"><span>General</span><small>{mode === 'quests' ? 'Tasks & commitments' : 'Systems without a questline'}</small></span>
      </button>
      <div className="questline-nav-separator" />
      {mode === 'systems' && <button type="button" className="questline-nav-item" aria-pressed={selection.kind === 'all'} onClick={() => onSelect({ kind: 'all' })}>All systems</button>}
      {questlines.map((ql, index) => {
        const progress = questlineProgress(ql);
        const count = systems.filter(s => !s.hidden && systemServesQuestline(s, ql)).length;
        return (
          <div key={ql.id} className="questline-order-row" data-dragging={dragged === ql.id || undefined}
            data-drop={drop?.id === ql.id ? (drop.after ? 'after' : 'before') : undefined}
            data-questline-order-id={ql.id}>
          {editing && <button type="button" className="questline-drag-handle" aria-label={`Drag to reorder ${ql.title}`} title="Drag to reorder; use Up or Down arrow keys"
            onPointerDown={e => {
              if (e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragged(ql.id); setDrop(null);
            }}
            onPointerMove={e => {
              if (dragged !== ql.id) return;
              const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-questline-order-id]');
              const id = row?.dataset.questlineOrderId;
              if (!row || !id || id === ql.id) { setDrop(null); return; }
              const rect = row.getBoundingClientRect();
              setDrop({ id, after: e.clientY > rect.top + rect.height / 2 });
            }}
            onPointerUp={e => {
              if (dragged === ql.id && drop) move(ql.id, drop.id, drop.after);
              setDragged(null); setDrop(null);
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => { setDragged(null); setDrop(null); }}
            onLostPointerCapture={() => { setDragged(null); setDrop(null); }}
            onKeyDown={e => {
              if (e.key === 'Escape') { setDragged(null); setDrop(null); }
              if (e.key === 'ArrowUp' && index > 0) { e.preventDefault(); move(ql.id, questlines[index - 1].id, false); }
              if (e.key === 'ArrowDown' && index < questlines.length - 1) { e.preventDefault(); move(ql.id, questlines[index + 1].id, true); }
            }}>⠿</button>}
          <button type="button" className="questline-nav-item" aria-pressed={selection.kind === 'questline' && selection.id === ql.id} onClick={() => onSelect({ kind: 'questline', id: ql.id })}>
            <QuestArtwork kind="questline" title={ql.title} id={ql.id} icon={ql.icon} size={18} />
            <span className="questline-nav-copy"><span>{ql.title}</span><small>{ql.hidden ? 'Hidden · edit to restore' : mode === 'quests' ? `${progress.done} / ${progress.total} quests complete` : `${count} supporting system${count === 1 ? '' : 's'}`}</small></span>
          </button>
          {editing && <div className="questline-order-arrows">
            <button type="button" aria-label={`Move ${ql.title} up`} disabled={index === 0} onClick={() => move(ql.id, questlines[index - 1].id, false)}>↑</button>
            <button type="button" aria-label={`Move ${ql.title} down`} disabled={index === questlines.length - 1} onClick={() => move(ql.id, questlines[index + 1].id, true)}>↓</button>
          </div>}
          </div>
        );
      })}
      {!questlines.length && <p className="questline-empty-nav">{mode === 'systems' ? 'Questlines appear here when you link a system.' : 'No questlines yet.'}</p>}
      </div>
    </nav>
  );
}
