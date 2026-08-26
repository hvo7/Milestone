/**
 * Labelled form field — the layout every drawer uses for its inputs.
 * Previously copy-pasted into all four drawers; this is the single definition.
 *
 * A label and its control, and nothing else. There was a `hint` here that drew a
 * paragraph explaining what each box was for; a form that has to be narrated is
 * a form with the wrong labels, and the prose was most of what you read.
 */
export default function Field({ label, children }: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--page-text-dim)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}
