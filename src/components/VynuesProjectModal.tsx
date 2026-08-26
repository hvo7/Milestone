import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVynuesStore } from '../vynuesStore';
import type { ProjectColor, VynuesProject } from '../vynuesStore';

const COLORS: { key: ProjectColor; var: string }[] = [
  { key: 'sapphire', var: 'var(--color-sapphire)' },
  { key: 'emerald',  var: 'var(--color-emerald)' },
  { key: 'violet',   var: 'var(--color-violet)' },
  { key: 'amber',    var: 'var(--color-amber)' },
  { key: 'crimson',  var: 'var(--color-crimson)' },
];

interface Props {
  open: boolean;
  /** Pass a project to edit it; omit for a new one. */
  project?: VynuesProject;
  onClose: () => void;
}

/** Right-hand slide-in panel for creating or editing a Vynues project — matches the
 *  Today / Quests task drawers so every "add" surface feels the same. */
export default function VynuesProjectModal({ open, project, onClose }: Props) {
  const addProject    = useVynuesStore(s => s.addProject);
  const updateProject = useVynuesStore(s => s.updateProject);
  const editing = !!project;

  const [name,  setName]  = useState('');
  const [desc,  setDesc]  = useState('');
  const [color, setColor] = useState<ProjectColor>('sapphire');
  const nameRef = useRef<HTMLInputElement>(null);

  // Keep the latest onClose in a ref so it doesn't drive the prefill effect (the page
  // re-renders around it) — mirrors the other drawers.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Prefill on open (or when the edited project changes): blank for a new project,
  // the project's values when editing.
  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? '');
    setDesc(project?.description ?? '');
    setColor(project?.color ?? 'sapphire');
    const t = setTimeout(() => nameRef.current?.focus(), 80);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id]);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (editing) updateProject(project!.id, { name: trimmed, description: desc.trim(), color });
    else         addProject(trimmed, desc.trim(), color);
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50 }}
          />
          <motion.div
            key="panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="side-drawer"
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 94vw)', zIndex: 51,
              background: 'var(--card-bg)', borderLeft: '1px solid var(--card-border)',
              boxShadow: '-14px 0 44px rgba(0,0,0,0.34)', display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--card-border)' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--page-text)' }}>
                {editing ? 'Edit project' : 'New project'}
              </h2>
              <button
                onClick={onClose}
                title="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-dim)', lineHeight: 1, padding: 4 }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={labelStyle}>Project name</label>
                <input
                  ref={nameRef}
                  className="rune-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                  placeholder="e.g. Q3 Marketing Site"
                  style={{ fontSize: 14, padding: '9px 12px' }}
                />
              </div>

              <div>
                <label style={labelStyle}>Description <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>(optional)</span></label>
                <textarea
                  className="rune-input"
                  value={desc}
                  onChange={e => setDesc(e.target.value)}
                  placeholder="What is this project about?"
                  rows={3}
                  style={{ resize: 'vertical', minHeight: 64, fontSize: 14, padding: '9px 12px' }}
                />
              </div>

              <div>
                <label style={labelStyle}>Accent colour</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  {COLORS.map(c => (
                    <button
                      key={c.key}
                      onClick={() => setColor(c.key)}
                      title={c.key}
                      style={{
                        width: 30, height: 30, borderRadius: 8, cursor: 'pointer',
                        background: c.var,
                        border: color === c.key ? '2px solid var(--page-text)' : '2px solid transparent',
                        boxShadow: color === c.key ? '0 0 0 2px var(--card-bg)' : 'none',
                        transition: 'all 0.15s',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div style={{ padding: '16px 22px', borderTop: '1px solid var(--card-border)', display: 'flex', gap: 10 }}>
              <button
                onClick={onClose}
                style={{ flex: 1, background: 'transparent', border: '1px solid var(--card-border)', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '10px', color: 'var(--text-dim)' }}
              >
                Cancel
              </button>
              <button
                className="btn-gold"
                style={{ flex: 2, opacity: name.trim() ? 1 : 0.4, padding: '10px' }}
                onClick={submit}
                disabled={!name.trim()}
              >
                {editing ? 'Save' : 'Create project'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: 6, fontSize: 12, fontWeight: 600, color: 'var(--page-text)',
};
