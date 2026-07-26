/**
 * Labelled form field — the layout every drawer uses for its inputs.
 * Previously copy-pasted into all four drawers; this is the single definition.
 *
 * `label` is a ReactNode rather than a string: the quest drawer decorates its
 * labels with inline hints.
 */
export default function Field({ label, children, hint }: {
  label: React.ReactNode;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--page-text-dim)' }}>
        {label}
      </span>
      {children}
      {hint && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>{hint}</p>}
    </div>
  );
}
