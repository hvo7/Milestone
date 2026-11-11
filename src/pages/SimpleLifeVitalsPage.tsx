import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import NavBar from '../components/NavBar';
import { paceLabels, type Pace } from '../lib/lifeVitals';
import { loadSimpleVitals, newVital, simplePace, simpleVitalsKey, validSimpleVitals, type SimpleVital } from '../lib/simpleVitals';
import './lifeVitals.css';
import './simpleVitals.css';

const isTesting = import.meta.env.MODE === 'testing';
const STORAGE_KEY = simpleVitalsKey(isTesting);
function PaceBadge({ pace }: { pace: Pace }) {
  return <span className={`lv-badge lv-${pace}`}><span aria-hidden="true">&bull;</span>{paceLabels[pace]}</span>;
}

export function AreaEditor({ area, isNew, onClose, onSave, onArchive }: {
  area: SimpleVital; isNew: boolean; onClose: () => void;
  onSave: (area: SimpleVital) => boolean; onArchive: () => boolean;
}) {
  const [draft, setDraft] = useState(() => ({ ...area, checks: area.checks.map(c => ({ ...c })) }));
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = { ...draft, name: draft.name.trim(), checks: draft.checks.map(c => ({ ...c, label: c.label.trim() })) };
    if (!validSimpleVitals([clean])) { setError('Enter an area name and a label for each check.'); return; }
    const changedChecks = JSON.stringify(clean.checks.map(c => [c.id, c.label])) !== JSON.stringify(area.checks.map(c => [c.id, c.label]));
    const saved = onSave(changedChecks ? { ...clean, checks: clean.checks.map(c => ({ ...c, done: false })), extra: false, checkedAt: null } : clean);
    if (!saved) setError('Couldn’t save. Try again.');
  };
  return <dialog ref={dialogRef} className="lv-dialog lv-simple-editor" aria-labelledby="simple-editor-title" onCancel={onClose}>
    <form onSubmit={submit}>
      <div className="lv-editor-heading"><h2 id="simple-editor-title">{isNew ? 'Add life area' : 'Edit life area'}</h2><button className="lv-close" type="button" onClick={onClose} aria-label="Close editor">&times;</button></div>
      <label>Area name<input autoFocus required maxLength={40} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Gym, School, Work…" /></label>
      <fieldset className="lv-simple-basics"><legend>On pace checklist</legend>
        {draft.checks.map((check, index) => <div className="lv-simple-edit-row" key={check.id}>
          <input required aria-label={`Checklist item ${index + 1}`} maxLength={80} value={check.label} onChange={e => setDraft({ ...draft, checks: draft.checks.map(c => c.id === check.id ? { ...c, label: e.target.value } : c) })} />
          {draft.checks.length > 1 && <button className="lv-close" type="button" aria-label={`Remove item ${index + 1}`} onClick={() => setDraft({ ...draft, checks: draft.checks.filter(c => c.id !== check.id) })}>&times;</button>}
        </div>)}
        {draft.checks.length < 3 && <button type="button" className="lv-text-button" onClick={() => setDraft({ ...draft, checks: [...draft.checks, { id: crypto.randomUUID(), label: '', done: false }] })}>+ Add a check ({draft.checks.length}/3)</button>}
      </fieldset>
      <div className="lv-editor-footer">
        {!isNew ? <button className="lv-text-button" type="button" onClick={() => { if (!onArchive()) setError('Couldn’t archive. Try again.'); }}>Archive</button> : <span />}
        <button className="lv-primary" type="submit">{isNew ? 'Create area' : 'Save changes'}</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  </dialog>;
}

type RegionBounds = { left: number; top: number; width: number; height: number };
export function AreaFocus({ area, origin, onClose, onEdit, onSave }: {
  area: SimpleVital; origin: RegionBounds; onClose: () => void; onEdit: () => void; onSave: (area: SimpleVital) => boolean;
}) {
  const [draft, setDraft] = useState(() => ({ ...area, checks: area.checks.map(c => ({ ...c })) }));
  const [error, setError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const backdropDown = useRef(false);
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
  const pace = simplePace(draft);
  const allDone = draft.checks.every(c => c.done);
  const toggle = (id: string, done: boolean) => setDraft(old => ({ ...old,
    checks: old.checks.map(c => c.id === id ? { ...c, done } : c),
    extra: done ? old.extra : false, checkedAt: new Date().toISOString() }));
  const save = () => {
    if (onSave({ ...draft, extra: allDone && draft.extra, checkedAt: new Date().toISOString() })) close();
    else setError(true);
  };
  return <dialog ref={dialogRef} className="lv-focus-shell" aria-labelledby="simple-focus-title"
    onCancel={e => { e.preventDefault(); close(); }}
    onPointerDown={e => { backdropDown.current = e.target === e.currentTarget; }}
    onPointerCancel={() => { backdropDown.current = false; }}
    onClick={e => { if (backdropDown.current && e.target === e.currentTarget) close(); backdropDown.current = false; }}>
    <div ref={panelRef} className={`lv-focus-panel lv-simple-focus lv-${pace}`}>
      <div className="lv-focus-top"><PaceBadge pace={pace} /><button type="button" className="lv-close" onClick={close} aria-label="Close life area">&times;</button></div>
      <h2 id="simple-focus-title">{area.name}</h2>
      <div className="lv-focus-body">
        <fieldset className="lv-simple-basics"><legend>Keeping up</legend>
          {draft.checks.map(check => <label className="lv-simple-check" key={check.id}>
            <input type="checkbox" checked={check.done} onChange={e => toggle(check.id, e.target.checked)} /><span>{check.label}</span>
          </label>)}
        </fieldset>
        <label className={`lv-simple-check lv-simple-extra${allDone ? '' : ' lv-simple-disabled'}`}>
          <input type="checkbox" checked={draft.extra} disabled={!allDone} onChange={e => setDraft({ ...draft, extra: e.target.checked, checkedAt: new Date().toISOString() })} />
          <span>Made extra progress</span>
        </label>
        <div className="lv-focus-actions"><button type="button" className="lv-secondary" onClick={onEdit}>Edit area</button><button type="button" className="lv-primary" onClick={save}>Save check-in</button></div>
        {error && <p role="alert">Couldn’t save. Try again.</p>}
      </div>
    </div>
  </dialog>;
}

export default function SimpleLifeVitalsPage() {
  const [initial] = useState(() => {
    try { return { areas: loadSimpleVitals(localStorage, isTesting), error: false }; }
    catch { return { areas: [] as SimpleVital[], error: true }; }
  });
  const [areas, setAreas] = useState(initial.areas);
  const [selected, setSelected] = useState<{ id: string; origin: RegionBounds } | null>(null);
  const [editing, setEditing] = useState<SimpleVital | null>(null);
  const [error, setError] = useState(initial.error ? 'Saved Life Vitals could not be loaded. Reload to try again.' : '');
  const [notice, setNotice] = useState('');
  const visible = areas.filter(a => !a.archived);
  const selectedArea = areas.find(a => a.id === selected?.id);
  const persist = (next: SimpleVital[]) => {
    if (initial.error) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setAreas(next); setError(''); return true;
    } catch { setError('Couldn’t save. Try again.'); return false; }
  };
  const save = (area: SimpleVital) => {
    const ok = persist(areas.some(a => a.id === area.id) ? areas.map(a => a.id === area.id ? area : a) : [...areas, area]);
    if (ok) { setEditing(null); setNotice(`${area.name} saved.`); }
    return ok;
  };
  return <div className="page-shell lv-page">
    <NavBar hideCover />
    <main className="lv-main">
      <header className="lv-heading"><h1>Life Vitals</h1><button className="lv-secondary" type="button" disabled={initial.error || areas.length >= 100} onClick={() => setEditing(newVital())}>+ Add area</button></header>
      <div className="lv-grid" aria-label="Life areas">
        {visible.map((area, index) => {
          const pace = simplePace(area);
          return <button type="button" className={`lv-region lv-${pace}`} key={area.id} aria-label={`Open ${area.name}, ${paceLabels[pace]}`} aria-haspopup="dialog"
            onClick={event => { const r = event.currentTarget.getBoundingClientRect(); setSelected({ id: area.id, origin: { left: r.left, top: r.top, width: r.width, height: r.height } }); }}>
            <span className="lv-lane-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="lv-lane-name"><span className="lv-region-title">{area.name}</span></span>
            <PaceBadge pace={pace} /><span aria-hidden="true">&rarr;</span>
          </button>;
        })}
      </div>
      {visible.length === 0 && !initial.error && <div className="lv-empty-state"><button className="lv-primary" type="button" onClick={() => setEditing(newVital())}>Create your first area</button></div>}
      {areas.some(a => a.archived) && <details className="lv-explainer"><summary>Archived areas</summary>{areas.filter(a => a.archived).map(a => <div className="lv-archive-row" key={a.id}><span>{a.name}</span><button type="button" className="lv-secondary" onClick={() => persist(areas.map(x => x.id === a.id ? { ...x, archived: false } : x))}>Restore</button></div>)}</details>}
      {error && <p role="alert">{error}</p>}
      <span className="lv-sr-only" role="status">{notice}</span>
    </main>
    {selected && selectedArea && <AreaFocus key={selected.id} area={selectedArea} origin={selected.origin} onSave={save} onClose={() => setSelected(null)} onEdit={() => { setEditing(selectedArea); setSelected(null); }} />}
    {editing && <AreaEditor key={editing.id} area={editing} isNew={!areas.some(a => a.id === editing.id)} onClose={() => setEditing(null)} onSave={save} onArchive={() => {
      const ok = persist(areas.map(a => a.id === editing.id ? { ...a, archived: true } : a));
      if (ok) { setEditing(null); setNotice('Area archived.'); }
      return ok;
    }} />}
  </div>;
}
