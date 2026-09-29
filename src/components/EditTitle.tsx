import type { ReactNode } from 'react';
export default function EditTitle({ children, onEdit, reorderHandle = false }: { children: ReactNode; onEdit: () => void; reorderHandle?: boolean }) {
  return <button type="button" data-reorder-handle={reorderHandle || undefined} title={reorderHandle ? 'Click to edit · Hold to reorder' : undefined} onClick={e => { e.stopPropagation(); onEdit(); }}
    style={{ font: 'inherit', color: 'inherit', background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', overflowWrap: 'anywhere' }}>{children}</button>;
}
