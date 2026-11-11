import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import NavBar from '../components/NavBar';
import './lifeVitals.css';

import { getPace, factorPace, newFactor, validAreas, paceLabels, type Pace, type Factor, type LifeArea, type AreaIcon } from '../lib/lifeVitals';
import { loadLifeVitals, lifeVitalsStorageKey } from '../lib/lifeVitalsStorage';
const isTesting = import.meta.env.MODE === 'testing';
const STORAGE_KEY = lifeVitalsStorageKey(isTesting);
const iconLabels: Record<AreaIcon, string> = { gym: 'Fitness', school: 'Learning', work: 'Work', projects: 'Ideas', wellbeing: 'Wellbeing', people: 'People' };
function readAreas(): LifeArea[] {
  try {
    return loadLifeVitals(localStorage, isTesting);
  } catch { return []; }
}

function VitalIcon({ name }: { name: AreaIcon | 'pulse' | 'arrow' | 'plus' }) {
  const paths = {
    gym: <><path d="m5 7 12 10M3 9l6-6m6 18 6-6M2 6l4-4m12 20 4-4M5 12l7-7m0 14 7-7" /></>,
    school: <><path d="m2 9 10-5 10 5-10 5L2 9Zm4 3v6c4 3 8 3 12 0v-6m4-3v8" /></>,
    work: <><rect x="3" y="7" width="18" height="14" rx="3" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12c6 4 12 4 18 0m-9 1v4" /></>,
    projects: <><path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3Z" /></>,
    wellbeing: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2" /></>,
    pulse: <path d="M2 12h5l3-8 4 16 3-8h5" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function PaceBadge({ pace }: { pace: Pace }) {
  return <span className={`lv-badge lv-${pace}`}><span aria-hidden="true">&bull;</span>{paceLabels[pace]}</span>;
}

function AreaEditor({ area, isNew, onClose, onSave, onArchive }: { area: LifeArea; isNew: boolean; onClose: () => void; onSave: (area: LifeArea) => void; onArchive: () => void }) {
  const [draft, setDraft] = useState(() => ({ ...area, factors: area.factors.map(f => ({ ...f })) }));
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = dialogRef.current; d?.showModal(); return () => d?.close(); }, []);
  const updateFactor = (id: string, patch: Partial<Factor>) => setDraft(old => ({ ...old, factors: old.factors.map(f => f.id === id ? { ...f, ...patch } : f) }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = { ...draft, name: draft.name.trim(), factors: draft.factors.map(f => ({ ...f, name: f.name.trim(), unit: f.unit.trim() })) };
    if (!clean.name || clean.factors.some(f => !f.name) || !validAreas([clean])) return;
    onSave(clean);
  };
  return <dialog ref={dialogRef} className="lv-dialog lv-custom-editor" aria-labelledby="lv-editor-title" onCancel={onClose}>
    <form onSubmit={submit}>
      <div className="lv-editor-heading"><h2 id="lv-editor-title">{isNew ? 'Create your life area' : 'Customize & check in'}</h2><button type="button" className="lv-close" onClick={onClose} aria-label="Close editor">&times;</button></div>
      <div className="lv-form-pair"><label>Area name<input autoFocus required maxLength={40} value={draft.name} placeholder="e.g. Music, Finances, School" onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><label>Icon<select value={draft.icon} onChange={e => setDraft({ ...draft, icon: e.target.value as AreaIcon })}>{Object.entries(iconLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label></div>
      <label>What matters here?<input maxLength={100} value={draft.intention} onChange={e => setDraft({ ...draft, intention: e.target.value })} /></label>
      <label>Tracking period<input required maxLength={80} value={draft.period} placeholder="e.g. Nov 9–15, Fall semester, November" onChange={e => setDraft({ ...draft, period: e.target.value })} /></label>
      <h3 className="lv-factor-heading">What determines whether you are keeping up?</h3>
      {draft.factors.map((f, index) => <fieldset className="lv-factor-editor" key={f.id}><legend>Factor {index + 1}</legend>
        <label>Factor name<input required maxLength={60} value={f.name} placeholder="e.g. Lectures reviewed, Spending, Energy" onChange={e => updateFactor(f.id, { name: e.target.value })} /></label>
        <label>How to assess it<select value={f.kind} onChange={e => updateFactor(f.id, { kind: e.target.value as Factor['kind'] })}><option value="progress">Build toward a goal — more is better</option><option value="limit">Stay within a limit — less is better</option><option value="manual">My own assessment</option></select></label>
        {f.kind !== 'manual' ? <>
          <div className="lv-form-pair"><label>Unit<input maxLength={35} value={f.unit} placeholder="hours, dollars, sessions..." onChange={e => updateFactor(f.id, { unit: e.target.value })} /></label><label>{f.kind === 'limit' ? 'Limit for the whole period' : 'Goal for the whole period'}<input required type="number" min="0" max="1000000000" step="any" value={f.target} onChange={e => updateFactor(f.id, { target: Number(e.target.value) })} /></label></div>
          <div className="lv-form-pair"><label>Actual so far<input type="number" min="0" max="1000000000" step="any" value={f.actual ?? ''} placeholder="Leave blank if not assessed" onChange={e => updateFactor(f.id, { actual: e.target.value === '' ? null : Number(e.target.value) })} /></label><label>{f.kind === 'limit' ? 'Allowed by this check-in' : 'Expected by this check-in'}<input required type="number" min="0" max="1000000000" step="any" value={f.expected} onChange={e => updateFactor(f.id, { expected: Number(e.target.value) })} /></label></div>
          <label>On-pace tolerance (+/- units)<input required type="number" min="0" max="1000000000" step="any" value={f.tolerance} onChange={e => updateFactor(f.id, { tolerance: Number(e.target.value) })} /></label>
          <p className="lv-form-help">Within {f.tolerance} {f.unit} of {f.expected} is on pace. {f.kind === 'limit' ? 'Above that range is behind; below it is ahead.' : 'Below that range is behind; above it is ahead.'} The whole-period goal is context, not the pace threshold.</p>
        </> : <>
          <label>What do your statuses mean?<textarea rows={3} maxLength={500} value={f.criteria} placeholder="Behind: overwhelmed. On pace: manageable. Ahead: rested with room to spare." onChange={e => updateFactor(f.id, { criteria: e.target.value })} /></label>
          <label>Your assessment<select value={f.assessment} onChange={e => updateFactor(f.id, { assessment: e.target.value as Pace })}>{Object.entries(paceLabels).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </>}
        <div className="lv-factor-toolbar"><label className="lv-checkbox"><input type="checkbox" checked={f.included} onChange={e => updateFactor(f.id, { included: e.target.checked })} /> Counts toward area status</label><PaceBadge pace={factorPace(f)} /></div>
        <button type="button" className="lv-text-button" onClick={() => setDraft({ ...draft, factors: draft.factors.filter(x => x.id !== f.id) })}>Remove factor from draft</button>
      </fieldset>)}
      <button type="button" className="lv-secondary" disabled={draft.factors.length >= 30} onClick={() => setDraft({ ...draft, factors: [...draft.factors, newFactor()] })}>+ Add factor</button>
      <label>Next step<input maxLength={140} value={draft.next} onChange={e => setDraft({ ...draft, next: e.target.value })} /></label>
      <label>Your note<textarea rows={2} maxLength={500} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></label>
      <div className="lv-editor-footer"><PaceBadge pace={getPace(draft)} /><button type="submit" className="lv-primary">{isNew ? 'Create area' : 'Save changes'}</button></div>
      {!isNew && <button type="button" className="lv-text-button" onClick={onArchive}>Archive this area (can be restored)</button>}
    </form>
  </dialog>;
}

type RegionBounds = { left: number; top: number; width: number; height: number };

function AreaFocus({ area, origin, onClose, onEdit }: {
  area: LifeArea; origin: RegionBounds; onClose: () => void; onEdit: () => void;
}) {
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
        { transform: originalTransform.current, opacity: .65 },
        { transform: 'none', opacity: 1 },
      ], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    return () => {
      animation.current?.cancel();
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [origin]);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    animation.current?.cancel();
    if (reduceMotion.current || !panelRef.current) { onClose(); return; }
    dialogRef.current?.classList.add('lv-focus-closing');
    animation.current = panelRef.current.animate([
      { transform: 'none', opacity: 1 },
      { transform: originalTransform.current, opacity: .35 },
    ], { duration: 220, easing: 'cubic-bezier(.4,0,.8,.2)', fill: 'forwards' });
    animation.current.onfinish = onClose;
  };
  const pace = getPace(area);

  return <dialog ref={dialogRef} className="lv-focus-shell" aria-labelledby="lv-focus-title"
    onCancel={e => { e.preventDefault(); close(); }}
    onPointerDown={e => { backdropDown.current = e.target === e.currentTarget; }}
    onPointerCancel={() => { backdropDown.current = false; }}
    onClick={e => { if (backdropDown.current && e.target === e.currentTarget) close(); backdropDown.current = false; }}>
    <div ref={panelRef} className={`lv-focus-panel lv-${pace}`}>
      <div className="lv-focus-top"><span className={`lv-area-icon lv-icon-${area.icon}`}><VitalIcon name={area.icon} /></span><PaceBadge pace={pace} /><button type="button" autoFocus className="lv-close" onClick={close} aria-label="Close life area">&times;</button></div>
      <h2 id="lv-focus-title">{area.name}</h2>
      {area.intention && <p className="lv-focus-intention">{area.intention}</p>}
      <div className="lv-focus-body">
        <p className="lv-eyebrow">{area.period || 'Your current period'} &middot; latest check-in</p>
        <div className="lv-factor-list">{area.factors.length === 0 && <p>No factors yet. Add what you want to track.</p>}{area.factors.map(f => <section className="lv-factor-detail" key={f.id}>
          <div className="lv-factor-toolbar"><h3>{f.name}</h3><PaceBadge pace={factorPace(f)} /></div>
          {f.kind === 'manual' ? f.criteria && <p>{f.criteria}</p> : <><p><strong>{f.actual === null ? 'Not logged' : f.actual} {f.unit}</strong> &middot; {f.kind === 'limit' ? 'allowed' : 'expected'}: {f.expected} {f.unit}</p><small>{f.kind === 'limit' ? 'Period limit' : 'Period goal'}: {f.target} {f.unit} &middot; tolerance: +/-{f.tolerance}</small></>}
          {!f.included && <small>Does not affect area status</small>}
        </section>)}</div>
        {area.next && <section className="lv-focus-next"><h3>Next step</h3><p>{area.next}</p></section>}
        {area.note && <section className="lv-focus-note"><h3>Your note</h3><p>{area.note}</p></section>}
        <div className="lv-focus-actions"><button type="button" className="lv-primary" onClick={onEdit}>Update check-in & customize</button></div>
      </div>
    </div>
  </dialog>;
}

export default function LifeVitalsPage() {
  const [areas, setAreas] = useState(readAreas);
  const [selected, setSelected] = useState<{ id: string; origin: RegionBounds } | null>(null);
  const [editing, setEditing] = useState<LifeArea | null>(null);
  const [notice, setNotice] = useState('');
  const [storageError, setStorageError] = useState(false);
  const counts = { behind: 0, 'on-pace': 0, ahead: 0, unrated: 0 };
  const visible = areas.filter(a => !a.archived);
  visible.forEach(area => counts[getPace(area)]++);
  const selectedArea = areas.find(area => area.id === selected?.id);
  const persist = (next: LifeArea[]) => {
    setAreas(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  };
  const save = (area: LifeArea) => {
    persist(areas.some(a => a.id === area.id) ? areas.map(a => a.id === area.id ? area : a) : [...areas, area]);
    setEditing(null);
    setNotice(`${area.name} check-in saved. ${paceLabels[getPace(area)]}.`);
  };
  const addArea = () => setEditing({ id: crypto.randomUUID(), name: '', icon: 'projects', intention: '', period: '', factors: [], next: '', note: '' });
  return <div className="page-shell lv-page">
    <NavBar hideCover />
    <main className="lv-main">
      <header className="lv-heading">
        <div><div className="lv-eyebrow"><VitalIcon name="pulse" /> YOUR PERSONAL OVERVIEW</div><h1>Life Vitals</h1></div>
        <div className="lv-heading-actions"><button type="button" className="lv-secondary" onClick={addArea} disabled={areas.length >= 100}><VitalIcon name="plus" /> Add area</button></div>
      </header>
      <div className="lv-summary" aria-label="Life balance overview"><span className="lv-behind">{counts.behind} need attention</span><span>{counts['on-pace']} on pace</span><span>{counts.ahead} ahead</span><span>{counts.unrated} not assessed</span></div>
      <div className="lv-grid" aria-label="Life areas">
        {visible.map((area, index) => {
          const pace = getPace(area);

          return <button type="button" className={`lv-region lv-${pace}`} key={area.id} aria-label={`Open ${area.name}, ${paceLabels[pace]}`} aria-haspopup="dialog"
            onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setSelected({ id: area.id, origin: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }); }}>
            <span className="lv-lane-number">{String(index + 1).padStart(2, '0')}</span><span className={`lv-area-icon lv-icon-${area.icon}`}><VitalIcon name={area.icon} /></span>
            <span className="lv-lane-name"><span className="lv-region-title">{area.name}</span><small>{area.factors.length} {area.factors.length === 1 ? 'factor' : 'factors'}{area.period ? ' / ' + area.period : ''}</small></span>
            <PaceBadge pace={pace} /><VitalIcon name="arrow" />
          </button>;
        })}
      </div>
      {visible.length === 0 && <div className="lv-empty-state"><button className="lv-primary" type="button" onClick={addArea}>Create your first area</button></div>}
      {areas.some(a => a.archived) && <details className="lv-explainer"><summary>Archived areas</summary>{areas.filter(a => a.archived).map(a => <div className="lv-archive-row" key={a.id}><span>{a.name}</span><button type="button" className="lv-secondary" onClick={() => persist(areas.map(x => x.id === a.id ? { ...x, archived: false } : x))}>Restore</button></div>)}</details>}
      <div className="lv-notice" role="status">{storageError ? 'This browser could not save the changes. They will last only until you leave or reload.' : notice}</div>
    </main>
    {selected && selectedArea && <AreaFocus area={selectedArea} origin={selected.origin} onClose={() => setSelected(null)}
      onEdit={() => { setEditing(selectedArea); setSelected(null); }} />}
    {editing && <AreaEditor key={editing.id} area={editing} isNew={!areas.some(a => a.id === editing.id)} onClose={() => setEditing(null)} onSave={save} onArchive={() => { persist(areas.map(a => a.id === editing.id ? { ...a, archived: true } : a)); setEditing(null); setNotice("Area archived. Restore it below the list."); }} />}
  </div>;
}
