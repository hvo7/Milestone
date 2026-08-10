/**
 * Restore-from-automatic-backup, in the Data panel.
 *
 * The backups are worthless if recovering from one means finding a folder and
 * knowing which file to open, so the snapshots are listed here with the counts
 * they contain — a snapshot showing "0 questlines" is exactly the one you don't
 * want, and that has to be visible *before* you restore it.
 *
 * Hides itself entirely in a browser tab, where there is no disk to write to.
 */
import { useEffect, useState } from 'react';
import { listBackups, restoreBackup, snapshotNow } from '../lib/autoBackup';
import { noteExternalWrite } from '../lib/cloudSync';

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? `Today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      `, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};

export default function AutoBackupCard() {
  const [backups, setBackups] = useState<AutoBackup[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const available = !!window.electronAPI?.backup;

  useEffect(() => {
    if (!available) return;
    void listBackups().then(setBackups);
  }, [available]);

  if (!available) return null;

  async function handleRestore(name: string) {
    setBusy(true);
    setError(null);
    const res = await restoreBackup(name);
    if (!res.ok) {
      setError(res.error ?? 'Could not restore that backup.');
      setBusy(false);
      setConfirming(null);
      return;
    }
    // The restore wrote localStorage behind the stores' backs, so sync has to be
    // told — otherwise the next pull would read it as stale and undo it.
    noteExternalWrite();
    window.location.reload();
  }

  async function handleSnapshot() {
    setBusy(true);
    await snapshotNow();
    setBackups(await listBackups());
    setBusy(false);
  }

  const newest = backups?.[0];

  return (
    <div style={{ background: 'var(--input-bg)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '14px 16px' }}>
      <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--page-text)' }}>
        Automatic backups
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {backups === null
          ? 'Checking…'
          : newest
            ? <>Saved automatically to this computer. Most recent: <strong style={{ color: 'var(--page-text-dim)' }}>{when(newest.savedAt)}</strong> · {newest.questlines} questlines, {newest.routines} tasks.</>
            : 'No snapshots yet — one is taken each time the app starts.'}
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn-ghost"
          style={{ flex: 1, opacity: busy ? 0.5 : 1 }}
          onClick={() => setOpen(v => !v)}
          disabled={busy || !backups?.length}
        >
          {open ? 'Hide' : `Restore${backups?.length ? ` (${backups.length})` : ''}`}
        </button>
        <button
          className="btn-ghost"
          style={{ flex: 1, opacity: busy ? 0.5 : 1 }}
          onClick={handleSnapshot}
          disabled={busy}
        >
          Back up now
        </button>
      </div>

      {open && backups && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
          {backups.map(b => (
            <div
              key={b.name}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', borderRadius: 8,
                background: 'var(--page-surface)', border: '1px solid var(--page-border)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--page-text)' }}>{when(b.savedAt)}</span>
                <span style={{ display: 'block', fontSize: 11, color: b.questlines === 0 && b.routines === 0 ? 'var(--danger)' : 'var(--text-dim)' }}>
                  {b.questlines} questlines · {b.routines} tasks
                </span>
              </div>
              {confirming === b.name ? (
                <>
                  <button className="btn-gold" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => void handleRestore(b.name)} disabled={busy}>
                    Replace all
                  </button>
                  <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setConfirming(null)} disabled={busy}>
                    Cancel
                  </button>
                </>
              ) : (
                <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setConfirming(b.name)} disabled={busy}>
                  Restore
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--danger)' }}>✗ {error}</p>
      )}
    </div>
  );
}
