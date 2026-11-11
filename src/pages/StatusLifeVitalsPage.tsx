import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import NavBar from '../components/NavBar';
import VitalChecklist from '../components/VitalChecklist';
import { paceLabels, type Pace } from '../lib/lifeVitals';
import { attentionReason, choosePriority, historyEntries, latestEntry, loadStatusVitals, newStatusVital, saveCheckIn, statusPace, statusVitalsKey,
  validStatusVitals, type StatusVital, type VitalEntry, type VitalStatus } from '../lib/statusVitals';
import './lifeVitals.css';
import './statusVitals.css';

const isTesting = import.meta.env.MODE === 'testing';
const STORAGE_KEY = statusVitalsKey(isTesting);
const dateLabel = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
function PaceBadge({ pace }: { pace: Pace }) {
  return <span className={`lv-badge lv-${pace}`}><span aria-hidden="true">&bull;</span>{paceLabels[pace]}</span>;
}

export function StatusAreaEditor({ area, isNew, onClose, onSave, onArchive }: {
  area: StatusVital; isNew: boolean; onClose: () => void; onSave: (area: StatusVital) => boolean; onArchive: () => boolean;
}) {
  const [draft, setDraft] = useState(area);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = dialogRef.current; d?.showModal(); return () => d?.close(); }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = { ...draft, name: draft.name.trim(), onPace: draft.onPace.trim() };
    if (!validStatusVitals([clean])) { setError('Enter an area name.'); return; }
    if (!onSave(clean)) setError('Could not save. Try again.');
  };
  return <dialog ref={dialogRef} className="lv-dialog lv-status-editor" aria-labelledby="status-editor-title" onCancel={onClose}>
    <form onSubmit={submit}>
      <div className="lv-editor-heading"><h2 id="status-editor-title">{isNew ? 'Add life area' : 'Edit life area'}</h2><button type="button" className="lv-close" onClick={onClose} aria-label="Close editor">&times;</button></div>
      <label>Area name<input autoFocus required maxLength={40} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>On pace means <span className="lv-optional">(optional)</span><textarea rows={3} maxLength={300} value={draft.onPace} onChange={e => setDraft({ ...draft, onPace: e.target.value })} /></label>
      <div className="lv-editor-footer">
        {!isNew ? <button type="button" className="lv-text-button" onClick={() => { if (!onArchive()) setError('Could not archive. Try again.'); }}>Archive area</button> : <span />}
        <button className="lv-primary" type="submit">{isNew ? 'Create area' : 'Save changes'}</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  </dialog>;
}

type RegionBounds = { left: number; top: number; width: number; height: number };
function useFocusDialog(origin: RegionBounds, onClose: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const backdropDownRef = useRef(false);
  const originalTransform = useRef('scale(.96)');
  const animation = useRef<Animation | null>(null);
  const reduceMotion = useRef(false);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const panel = panelRef.current;
    if (!dialog || !panel) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    const rect = panel.getBoundingClientRect();
    originalTransform.current = `translate(${origin.left + origin.width / 2 - rect.left - rect.width / 2}px, ${origin.top + origin.height / 2 - rect.top - rect.height / 2}px) scale(${origin.width / rect.width}, ${origin.height / rect.height})`;
    reduceMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduceMotion.current) {
      animation.current = panel.animate([
        { transform: originalTransform.current, opacity: .65 }, { transform: 'none', opacity: 1 },
      ], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    return () => { animation.current?.cancel(); dialog.close(); document.body.style.overflow = previousOverflow; };
  }, [origin]);
  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    animation.current?.cancel();
    if (reduceMotion.current || !panelRef.current) { onClose(); return; }
    dialogRef.current?.classList.add('lv-focus-closing');
    animation.current = panelRef.current.animate([
      { transform: 'none', opacity: 1 }, { transform: originalTransform.current, opacity: .35 },
    ], { duration: 220, easing: 'cubic-bezier(.4,0,.8,.2)', fill: 'forwards' });
    animation.current.onfinish = onClose;
  };

  return { dialogRef, panelRef, backdropDownRef, close };
}

export function StatusAreaFocus({ area, origin, onClose, onEdit, onSave }: {
  area: StatusVital; origin: RegionBounds; onClose: () => void; onEdit: () => void; onSave: (area: StatusVital) => boolean;
}) {
  const { dialogRef, panelRef, backdropDownRef, close } = useFocusDialog(origin, onClose);
  const [status, setStatus] = useState<VitalStatus | null>(null);
  const [reason, setReason] = useState('');
  const [next, setNext] = useState('');
  const [editId, setEditId] = useState<string>();
  const [error, setError] = useState('');
  const [historyCount, setHistoryCount] = useState(5);
  const [showLastCheckIn, setShowLastCheckIn] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const savedRef = useRef(false);
  const entries = historyEntries(area);
  const lastCheckIn = entries[0];
  const reset = () => { setEditId(undefined); setStatus(null); setReason(''); setNext(''); setError(''); };
  const editEntry = (entry: VitalEntry) => {
    setEditId(entry.id); setStatus(entry.status); setReason(entry.reason); setNext(entry.next); setError('');
    dialogRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (savedRef.current) return;
    if (!status) { setError('Choose a status.'); return; }
    try {
      const updated = saveCheckIn(area, { status, reason, next }, editId);
      if (onSave(updated)) { savedRef.current = true; close(); }
      else setError('Could not save. Try again.');
    } catch { setError('Could not save this check-in. Try again.'); }
  };
  return <dialog ref={dialogRef} className="lv-focus-shell" aria-labelledby="status-focus-title"
    onCancel={e => { e.preventDefault(); close(); }}
    onPointerDown={e => { backdropDownRef.current = e.target === e.currentTarget; }}
    onPointerCancel={() => { backdropDownRef.current = false; }}
    onClick={e => { if (backdropDownRef.current && e.target === e.currentTarget) close(); backdropDownRef.current = false; }}>
    <div ref={panelRef} className={`lv-focus-panel lv-status-focus lv-${statusPace(area)}`}>
      <div className="lv-focus-top"><button type="button" className="lv-close" onClick={close} aria-label="Close life area">&times;</button></div>
      <h2 id="status-focus-title">{area.name}</h2>
          <fieldset className="lv-status-options"><legend>Status</legend>
            {(['behind', 'on-pace', 'ahead'] as const).map(value => <label key={value} className={`lv-status-option lv-${value}`}>
              <input type="radio" name="vital-status" form="vital-check-in-form" value={value} checked={status === value} onChange={() => { setStatus(value); setError(''); }} />
              <span>{paceLabels[value]}</span>
            </label>)}
          </fieldset>
        {(status === 'behind' || status === 'on-pace') && <VitalChecklist key={status} kind={status === 'behind' ? 'catchUp' : 'maintenance'} area={area} onSave={onSave} />}
      <button type="button" className="lv-text-button lv-last-check-toggle" aria-expanded={showLastCheckIn} aria-controls="lv-last-check-in" onClick={() => setShowLastCheckIn(show => !show)}>
        {showLastCheckIn ? 'Hide last check-in' : 'Show last check-in'}
      </button>
      <section id="lv-last-check-in" className={`lv-last-check-in lv-${lastCheckIn?.status ?? 'unrated'}`} hidden={!showLastCheckIn} aria-label="Last check-in">
        {lastCheckIn ? <>
          <div className="lv-history-heading"><PaceBadge pace={lastCheckIn.status} /><time dateTime={lastCheckIn.createdAt}>{dateLabel(lastCheckIn.createdAt)}</time></div>
          {lastCheckIn.reason && <p>{lastCheckIn.reason}</p>}
          {lastCheckIn.next && <p><strong>Next step:</strong> {lastCheckIn.next}</p>}
        </> : <p>No check-ins yet.</p>}
      </section>
      {area.onPace && <section className="lv-personal-definition"><h3>On pace means</h3><p>{area.onPace}</p></section>}
      <div className="lv-focus-body">
        <form id="vital-check-in-form" ref={formRef} onSubmit={save} className="lv-status-form">
          <h3>{editId ? 'Edit check-in' : 'New check-in'}</h3>

          <label>{status === 'behind' ? 'What’s holding you back?' : status === 'ahead' ? 'What’s going well?' : 'What’s going on?'} <span className="lv-optional">(optional)</span>
            <textarea rows={3} maxLength={600} value={reason} onChange={e => setReason(e.target.value)} />
          </label>
          <label>Next step <span className="lv-optional">(optional)</span><input maxLength={200} value={next} onChange={e => setNext(e.target.value)} /></label>
          {error && <p role="alert">{error}</p>}
          <div className="lv-focus-actions">
            {editId ? <button type="button" className="lv-secondary" onClick={reset}>Cancel edit</button> : <button type="button" className="lv-secondary" onClick={onEdit}>Edit area</button>}
            <button type="submit" className="lv-primary">{editId ? 'Save changes' : 'Save check-in'}</button>
          </div>
        </form>

        {entries.length > 0 && <details className="lv-status-history"><summary>Check-in history ({entries.length})</summary>
          <ol>{entries.slice(0, historyCount).map(entry => <li key={entry.id}>
            <div className="lv-history-heading"><PaceBadge pace={entry.status} /><time dateTime={entry.createdAt}>{dateLabel(entry.createdAt)}</time></div>
            {entry.reason && <p>{entry.reason}</p>}
            {entry.next && <p><strong>Next:</strong> {entry.next}</p>}
            {entry.onPace && entry.onPace !== area.onPace && <p><strong>On pace meant:</strong> {entry.onPace}</p>}
            <button type="button" className="lv-text-button" aria-label={`Edit check-in from ${dateLabel(entry.createdAt)}`} onClick={() => editEntry(entry)}>Edit</button>
          </li>)}</ol>
          {entries.length > historyCount && <button type="button" className="lv-secondary" onClick={() => setHistoryCount(n => n + 5)}>Show older check-ins</button>}
        </details>}
      </div>
    </div>
  </dialog>;
}

export default function StatusLifeVitalsPage() {
  const [initial] = useState(() => {
    try { return { areas: loadStatusVitals(localStorage, isTesting), error: false }; }
    catch { return { areas: [] as StatusVital[], error: true }; }
  });
  const [areas, setAreas] = useState(initial.areas);
  const [selected, setSelected] = useState<{ id: string; origin: RegionBounds } | null>(null);
  const [editing, setEditing] = useState<StatusVital | null>(null);
  const [error, setError] = useState(initial.error ? 'Saved Life Vitals could not be loaded. Reload to try again.' : '');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const visible = areas.filter(a => !a.archived);
  const attention = visible.filter(a => attentionReason(a, now));
  const priority = visible.find(a => a.priority);
  const shown = visible.slice().sort((a, b) => Number(!!b.priority) - Number(!!a.priority));
  const selectedArea = areas.find(a => a.id === selected?.id);
  const persist = (next: StatusVital[]) => {
    if (initial.error || !validStatusVitals(next)) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setAreas(next); setError(''); return true;
    } catch { setError('Could not save. Try again.'); return false; }
  };
  const save = (area: StatusVital) => {
    const ok = persist(areas.some(a => a.id === area.id) ? areas.map(a => a.id === area.id ? area : a) : [...areas, area]);
    if (ok) { setEditing(null); setNotice(`${area.name} saved.`); }
    return ok;
  };
  return <div className="page-shell lv-page">
    <NavBar hideCover />
    <main className="lv-main">
      <header className="lv-heading"><h1>Life Vitals</h1><button type="button" className="lv-secondary" disabled={initial.error || areas.length >= 100} onClick={() => setEditing(newStatusVital())}>+ Add area</button></header>
      {visible.length > 0 && <div className="lv-overview-controls">
        <label className="lv-priority-picker">Current priority<select aria-label="Current priority" value={priority?.id ?? ''} onChange={e => { if (persist(choosePriority(areas, e.target.value))) setNotice(e.target.value ? 'Current priority updated.' : 'Current priority cleared.'); }}><option value="">None</option>{visible.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      </div>}
      <div className="lv-overview-layout">
      <div className="lv-grid" aria-label="Life areas">{shown.map((area, index) => {
        const pace = statusPace(area);
        const latest = latestEntry(area);
        return <button type="button" key={area.id} className={`lv-region lv-${pace}`} aria-label={`Open ${area.name}, ${paceLabels[pace]}`} aria-haspopup="dialog"
          onClick={event => { const r = event.currentTarget.getBoundingClientRect(); setSelected({ id: area.id, origin: { left: r.left, top: r.top, width: r.width, height: r.height } }); }}>
          <span className="lv-lane-number">{String(index + 1).padStart(2, '0')}</span>
          <span className="lv-lane-name"><span className="lv-region-title">{area.name}</span>{area.priority && <span className="lv-priority-badge">Current priority</span>}{latest && <time className="lv-last-check" dateTime={latest.createdAt}>Checked {dateLabel(latest.createdAt)}</time>}</span>
          <PaceBadge pace={pace} /><span aria-hidden="true">&rarr;</span>
        </button>;
      })}</div>
      {visible.length > 0 && <aside className="lv-attention-panel" aria-labelledby="lv-attention-title">
        <h2 id="lv-attention-title">Needs attention <span>{attention.length}</span></h2>
        {attention.length === 0 ? <p className="lv-attention-empty">No areas need attention.</p> : <ul>{attention.slice().sort((a, b) => Number(!!b.priority) - Number(!!a.priority)).map(area => <li key={area.id}>
          <button type="button" className="lv-attention-item" aria-label={`Review ${area.name}`} aria-haspopup="dialog" onClick={event => { const r = event.currentTarget.getBoundingClientRect(); setSelected({ id: area.id, origin: { left: r.left, top: r.top, width: r.width, height: r.height } }); }}>
            <span className="lv-attention-name">{area.name}</span><span aria-hidden="true">&rarr;</span>
            <span className="lv-attention-reason">{attentionReason(area, now)}</span>
            {area.priority && <span className="lv-priority-badge">Current priority</span>}
          </button>
        </li>)}</ul>}
      </aside>}
      </div>
      {visible.length === 0 && !initial.error && <div className="lv-empty-state"><button type="button" className="lv-primary" onClick={() => setEditing(newStatusVital())}>Create your first area</button></div>}
      {areas.some(a => a.archived) && <details className="lv-explainer"><summary>Archived areas</summary>{areas.filter(a => a.archived).map(a => <div className="lv-archive-row" key={a.id}><span>{a.name}</span><button type="button" className="lv-secondary" onClick={() => persist(areas.map(x => x.id === a.id ? { ...x, archived: false } : x))}>Restore</button></div>)}</details>}
      {error && <p role="alert">{error}</p>}
      <span className="lv-status-announcement" role="status">{notice}</span>
    </main>
    {selected && selectedArea && <StatusAreaFocus key={selected.id} area={selectedArea} origin={selected.origin} onSave={save} onClose={() => setSelected(null)} onEdit={() => { setEditing(selectedArea); setSelected(null); }} />}
    {editing && <StatusAreaEditor key={editing.id} area={editing} isNew={!areas.some(a => a.id === editing.id)} onSave={save} onClose={() => setEditing(null)} onArchive={() => {
      const ok = persist(areas.map(a => a.id === editing.id ? { ...a, archived: true, priority: false } : a));
      if (ok) { setEditing(null); setNotice('Area archived.'); }
      return ok;
    }} />}
  </div>;
}
