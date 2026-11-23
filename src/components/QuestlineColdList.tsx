/**
 * The Quests tab's left pane: questlines as cards, coldest first.
 *
 * Each card carries the quiet-goal reading — a dot and a few words saying when
 * the goal last moved. Gold once it has gone quiet, leaf when it moved today,
 * plain otherwise. The order comes from `rankByNeglect`; the saved manual order
 * is left alone and still drives the Systems tab.
 */
import type { QuestlineMomentum } from '../lib/momentum';
import { quietSignal, QUIET_TONE_COLOR } from '../lib/momentum';
import { questlineArt } from '../lib/questComplete';
import type { QuestlineSelection } from '../lib/questlineNavigation';

export default function QuestlineColdList({ ranked, selection, generalOpen, onSelect }: {
  /** Questlines with their momentum, already ordered coldest first. */
  ranked: QuestlineMomentum[];
  selection: QuestlineSelection;
  /** Open tasks in the General bucket. */
  generalOpen: number;
  onSelect: (selection: QuestlineSelection) => void;
}) {
  return (
    <nav className="cold-list" aria-label="Questlines, coldest first">
      <h2 className="cold-list-label">Coldest first</h2>
      <ul>
        {ranked.map(m => {
          const ql = m.questline;
          const signal = quietSignal(m);
          const current = selection.kind === 'questline' && selection.id === ql.id;
          return (
            <li key={ql.id}>
              <button type="button" className="cold-card" aria-current={current ? 'true' : undefined}
                onClick={() => onSelect({ kind: 'questline', id: ql.id })}>
                <img className="cold-card-art" src={questlineArt(ql)} alt="" width={44} height={44} />
                <span className="cold-card-copy">
                  <span className="cold-card-name">{ql.title}</span>
                  <span className="cold-card-signal" data-tone={signal.tone} style={{ color: QUIET_TONE_COLOR[signal.tone] }}>
                    <span className="quiet-dot" aria-hidden="true" />{signal.text}
                  </span>
                </span>
                <span className="cold-card-count" aria-label={`${m.progress.done} of ${m.progress.total} quests complete`}>
                  {m.progress.done} / {m.progress.total}
                </span>
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" className="cold-card" aria-current={selection.kind === 'general' ? 'true' : undefined}
            onClick={() => onSelect({ kind: 'general' })}>
            <span className="cold-card-copy">
              <span className="cold-card-name">General</span>
              <span className="cold-card-signal">Tasks and commitments</span>
            </span>
            <span className="cold-card-count" aria-label={`${generalOpen} open`}>{generalOpen}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
