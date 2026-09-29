export default function ArchiveButton({ onClick, label = 'Archive' }: { onClick: () => void; label?: string }) {
  return <button type="button" className="btn-ghost" onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, width: 'fit-content' }}>
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="18" height="5" rx="1" /><path d="M5 8v12h14V8M10 12h4" /></svg>{label}
  </button>;
}
