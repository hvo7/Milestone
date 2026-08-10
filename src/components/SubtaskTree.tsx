import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import IconButton from './IconButton';

/** Store-agnostic node shape — Today routines (`completed`) and Vynues tasks
 *  (`done`) both map into this before rendering. */
export interface SubNode {
  id: string;
  title: string;
  done: boolean;
  children?: SubNode[];
}

export interface SubtaskTreeHandlers {
  onToggle?: (id: string) => void;
  /** Add a step under `parentId` (null = top level). Omit to hide the ＋ affordances. */
  onAdd?: (title: string, parentId: string | null) => void;
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
}

/** Inline "add a step" input, used at the root and under any node. */
export function SubtaskAddInput({ placeholder = 'Add a step…', autoFocus = true, compact = false, onSubmit, onDismiss }: {
  placeholder?: string;
  autoFocus?: boolean;
  compact?: boolean;
  onSubmit: (title: string) => void;
  onDismiss?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  function submit() {
    const t = draft.trim();
    if (!t) { onDismiss?.(); return; }
    onSubmit(t);
    setDraft('');
    requestAnimationFrame(() => ref.current?.focus());
  }
  return (
    <input
      ref={ref}
      autoFocus={autoFocus}
      className="rune-input"
      placeholder={placeholder}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') { setDraft(''); onDismiss?.(); }
      }}
      onBlur={() => { if (!draft.trim()) onDismiss?.(); }}
      style={{ fontSize: compact ? 12.5 : 13, padding: compact ? '4px 8px' : '5px 9px' }}
    />
  );
}

function NodeRow({ node, depth, handlers, readOnly }: {
  node: SubNode;
  depth: number;
  handlers: SubtaskTreeHandlers;
  readOnly: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.title);
  const editRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  const kids = node.children ?? [];
  const canToggle = !!handlers.onToggle && !readOnly;

  function startEdit() {
    if (!handlers.onRename || readOnly) return;
    setDraft(node.title);
    setEditing(true);
  }
  function commitEdit() {
    setEditing(false);
    if (cancelRef.current) { cancelRef.current = false; return; }
    const t = draft.trim();
    if (t && t !== node.title) handlers.onRename?.(node.id, t);
  }

  const iconBtn = (label: string, title: string, onClick: () => void, hoverColor: string) => (
    <IconButton
      onClick={onClick} title={title} hover={hoverColor}
      size={11} opacity={hovered ? 1 : 0}
    >
      {label}
    </IconButton>
  );

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.16 }}
    >
      <div
        className="subtask-row"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24 }}
      >
        <input
          type="checkbox"
          className="rune-check rune-check-sm"
          checked={node.done}
          onChange={() => handlers.onToggle?.(node.id)}
          disabled={!canToggle}
          title={kids.length ? 'Checks every step under it too' : undefined}
          style={{ flexShrink: 0, ...(!canToggle ? { cursor: 'default', opacity: 0.6 } : {}) }}
        />
        {editing ? (
          <input
            ref={editRef}
            autoFocus
            className="rune-input"
            value={draft}
            onFocus={e => e.currentTarget.select()}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') editRef.current?.blur();
              if (e.key === 'Escape') { cancelRef.current = true; editRef.current?.blur(); }
            }}
            onBlur={commitEdit}
            style={{ flex: 1, fontSize: 12.5, padding: '3px 8px' }}
          />
        ) : (
          <span
            onDoubleClick={startEdit}
            style={{
              flex: 1, minWidth: 0, fontSize: depth === 0 ? 13 : 12.5,
              color: node.done ? 'var(--page-text-dim)' : 'var(--page-text)',
              textDecoration: node.done ? 'line-through' : 'none',
              cursor: handlers.onRename && !readOnly ? 'text' : undefined,
              transition: 'color 0.2s',
            }}
            title={handlers.onRename && !readOnly ? 'Double-click to rename' : undefined}
          >
            {node.title}
          </span>
        )}
        {!readOnly && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
            {handlers.onAdd && iconBtn('＋', 'Break this step down further', () => setAddingChild(v => !v), 'var(--accent)')}
            {handlers.onRename && !editing && iconBtn('✎', 'Rename step', startEdit, 'var(--accent)')}
            {handlers.onDelete && iconBtn('✕', kids.length ? 'Delete step and everything under it' : 'Delete step', () => handlers.onDelete!(node.id), 'var(--danger)')}
          </span>
        )}
      </div>

      {(kids.length > 0 || addingChild) && (
        <div style={{
          marginTop: 5, marginLeft: 7, paddingLeft: 14,
          borderLeft: '1px solid var(--card-border)',
          display: 'flex', flexDirection: 'column', gap: 5,
        }}>
          <AnimatePresence initial={false}>
            {kids.map(child => (
              <NodeRow key={child.id} node={child} depth={depth + 1} handlers={handlers} readOnly={readOnly} />
            ))}
          </AnimatePresence>
          {addingChild && (
            <SubtaskAddInput
              compact
              placeholder="A smaller step…"
              onSubmit={t => handlers.onAdd?.(t, node.id)}
              onDismiss={() => setAddingChild(false)}
            />
          )}
        </div>
      )}
    </motion.div>
  );
}

/**
 * Infinitely-nestable subtask checklist. Every step can be checked, renamed,
 * deleted, or broken down further with its own ＋ — because the simplest version
 * of a step usually only reveals itself later.
 */
export default function SubtaskTree({ nodes, handlers, readOnly = false, showRootAdd = false, onDismissRootAdd }: {
  nodes: SubNode[];
  handlers: SubtaskTreeHandlers;
  readOnly?: boolean;
  /** Render the top-level "add a step" input below the list. */
  showRootAdd?: boolean;
  onDismissRootAdd?: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <AnimatePresence initial={false}>
        {nodes.map(n => (
          <NodeRow key={n.id} node={n} depth={0} handlers={handlers} readOnly={readOnly} />
        ))}
      </AnimatePresence>
      {showRootAdd && !readOnly && handlers.onAdd && (
        <SubtaskAddInput
          onSubmit={t => handlers.onAdd!(t, null)}
          onDismiss={onDismissRootAdd}
        />
      )}
    </div>
  );
}
