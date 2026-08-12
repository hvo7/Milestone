/**
 * Find anything, from anywhere: ⌘K / Ctrl-K, or just `/`.
 *
 * Mounted once above the routes rather than per page, so the shortcut works the
 * same everywhere and the palette can navigate *between* pages — which is most of
 * what it's for. The ranking lives in lib/search.ts; this is the shell around it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuestStore } from '../store';
import { useVynuesStore } from '../vynuesStore';
import { search, KIND_ICON, KIND_LABEL, type SearchResult } from '../lib/search';

/** Fields where a bare `/` has to stay a slash. */
const TYPING_SEL = 'input, textarea, select, [contenteditable]';

function useHotkey(onOpen: () => void, onToggle: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // `instanceof Element`, not a cast: a key event dispatched at `window` or
      // `document` has no `closest`, and reaching for it there throws — which
      // takes the whole shortcut down, not just this one press.
      const typing = e.target instanceof Element && !!e.target.closest(TYPING_SEL);
      // ⌘K / Ctrl-K works even mid-field — it's unambiguous, and being able to
      // search without first clicking away from what you were typing is the point.
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onToggle();
        return;
      }
      // Bare `/` only outside a field, where it can't mean a character.
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen, onToggle]);
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const questlines = useQuestStore(s => s.questlines);
  const routines = useQuestStore(s => s.routines);
  const projects = useVynuesStore(s => s.projects);

  // Opening and closing reset the query here rather than in an effect watching
  // `open` — the reset belongs to the event that caused it, not to a render.
  const openPalette = useCallback(() => { setQuery(''); setCursor(0); setOpen(true); }, []);
  const closePalette = useCallback(() => { setOpen(false); setQuery(''); setCursor(0); }, []);
  const togglePalette = useCallback(() => { setOpen(o => { if (o) { setQuery(''); setCursor(0); } return !o; }); }, []);

  useHotkey(openPalette, togglePalette);

  // Flattening every task in the app on each keystroke is wasted work on a large
  // store; the sources only change when something is edited.
  const results = useMemo(
    () => (open ? search({ questlines, routines, projects }, query) : []),
    [open, query, questlines, routines, projects],
  );

  // Clamped at read time rather than reset from an effect: a shrinking list must
  // never leave the highlight pointing at a row that no longer exists, and doing
  // it here means there is no frame in which it does.
  const active = Math.min(cursor, Math.max(0, results.length - 1));

  useEffect(() => {
    if (!open) return;
    // Focus via the ref rather than the `autoFocus` attribute: the input is
    // remounted by AnimatePresence, and autoFocus only fires on the first mount.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Keep the highlighted row on screen while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  function choose(r: SearchResult | undefined) {
    if (!r) return;
    closePalette();
    navigate(r.path);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { closePalette(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(Math.min(active + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(Math.max(active - 1, 0)); return; }
    if (e.key === 'Enter')     { e.preventDefault(); choose(results[active]); }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={closePalette}
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '12vh 16px 16px',
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 480, damping: 36 }}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-label="Search"
            style={{
              width: 'min(620px, 100%)', maxHeight: '70vh',
              display: 'flex', flexDirection: 'column',
              background: 'var(--page-surface)', border: '1px solid var(--page-border)',
              borderRadius: 14, overflow: 'hidden',
              boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', borderBottom: '1px solid var(--card-border)' }}>
              <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>⌕</span>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search questlines, quests, tasks and steps…"
                aria-label="Search"
                style={{
                  flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontFamily: 'inherit', fontSize: 14.5, color: 'var(--page-text)',
                }}
              />
              <kbd style={{ fontSize: 10, color: 'var(--text-dim)', border: '1px solid var(--card-border)', borderRadius: 5, padding: '2px 6px' }}>
                esc
              </kbd>
            </div>

            <div ref={listRef} style={{ overflowY: 'auto', padding: results.length ? 6 : 0 }}>
              {results.map((r, i) => (
                <button
                  key={`${r.kind}-${r.id}`}
                  data-active={i === active}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(r)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 11, width: '100%',
                    padding: '9px 11px', borderRadius: 9,
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    fontFamily: 'inherit',
                    background: i === active ? 'var(--accent-soft)' : 'transparent',
                  }}
                >
                  <span style={{ flexShrink: 0, width: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
                    {KIND_ICON[r.kind]}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, color: 'var(--page-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.title}
                    </span>
                    {r.context && (
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.context}
                      </span>
                    )}
                  </span>
                  {r.hint && (
                    <span style={{ flexShrink: 0, fontSize: 11, color: r.hint === 'done' ? 'var(--success)' : 'var(--text-dim)' }}>
                      {r.hint}
                    </span>
                  )}
                  <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--text-dim)', opacity: 0.7 }}>
                    {KIND_LABEL[r.kind]}
                  </span>
                </button>
              ))}

              {query.trim() && results.length === 0 && (
                <p style={{ margin: 0, padding: '20px 16px', fontSize: 13, color: 'var(--text-dim)', textAlign: 'center' }}>
                  Nothing matches “{query.trim()}”.
                </p>
              )}

              {!query.trim() && (
                <p style={{ margin: 0, padding: '18px 16px', fontSize: 12.5, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.6 }}>
                  Type to search everything — questlines, quests, tasks, Vynues, and nested steps.
                  <br />
                  <span style={{ opacity: 0.75 }}>↑ ↓ to move · ↵ to open</span>
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
