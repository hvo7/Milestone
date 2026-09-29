import { useQuestStore, systemGoalIds, systemQuestIds } from '../store';
import type { System } from '../types';

/** Reuses persisted visibility flags: no content, history, or links are deleted. */
export default function ArchivePanel() {
  const questlines = useQuestStore(s => s.questlines);
  const systems = useQuestStore(s => s.systems);
  const restoreQuestline = useQuestStore(s => s.toggleQuestlineHidden);
  const restoreQuest = useQuestStore(s => s.toggleQuestHidden);
  const updateSystem = useQuestStore(s => s.updateSystem);
  const entries = [
    ...systems.filter(s => s.hidden).map(s => ({ id: s.id, title: s.title, kind: 'System', restore: () => updateSystem(s.id, { hidden: false }) })),
    ...questlines.filter(q => q.hidden).map(q => ({ id: q.id, title: q.title, kind: 'Questline', restore: () => restoreQuestline(q.id) })),
    ...questlines.flatMap(ql => ql.quests.filter(q => q.hidden).map(q => ({ id: q.id, title: q.title, kind: `Quest · ${ql.title}${ql.hidden ? ' (questline archived)' : ''}`, restore: () => restoreQuest(ql.id, q.id) }))),
  ];
  return <section data-archive-panel>
    <h3>Archive <span style={{ color: 'var(--page-text-dim)', fontWeight: 400 }}>· {entries.length}</span></h3>
    <p className="settings-intro">Saved for later. Restore a system, quest or questline to bring it back into focus.</p>
    {!entries.length && <div className="settings-empty">No archived items yet.<br />Use Archive on a system or quest to save it here.</div>}
    {questlines.map(ql => {
      const questSystems = (id: string) => systems.filter(s => s.hidden && systemQuestIds(s).includes(id));
      const direct = systems.filter(s => s.hidden && systemGoalIds(s).includes(ql.id) && !ql.quests.some(q => systemQuestIds(s).includes(q.id)));
      const children = ql.quests.filter(q => q.hidden || questSystems(q.id).length);
      if (!ql.hidden && !direct.length && !children.length) return null;
      return <details key={ql.id} className="archive-group">
        <summary>{ql.title}<small>Questline{!ql.hidden && ' · active'}</small></summary>
        {ql.hidden && <button className="btn-ghost" onClick={() => restoreQuestline(ql.id)}>Restore questline</button>}
        {direct.map(systemRow)}
        {children.map(q => <details key={q.id} className="archive-group">
          <summary>{q.title}<small>Quest{!q.hidden && ' · active'}</small></summary>
          {q.hidden && <button className="btn-ghost" onClick={() => restoreQuest(ql.id, q.id)}>Restore quest</button>}
          {questSystems(q.id).map(systemRow)}
        </details>)}
      </details>;
    })}
    {systems.filter(s => s.hidden && !questlines.some(ql => systemGoalIds(s).includes(ql.id) || ql.quests.some(q => systemQuestIds(s).includes(q.id)))).map(systemRow)}
  </section>;

  function systemRow(system: System) {
    return <div className="settings-row" key={system.id}>
      <div><strong>{system.title}</strong><small>System</small></div>
      <button className="btn-ghost" aria-label={`Restore ${system.title}`} onClick={() => updateSystem(system.id, { hidden: false })}>Restore</button>
    </div>;
  }
}
