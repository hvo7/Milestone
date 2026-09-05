import { useRef, useState } from 'react';
import { VYNUES_STORE_KEY } from '../vynuesStore';
import { QUEST_STORE_KEY as STORE_KEY } from '../store';
import { APP_VERSION, VERSION_LABEL, buildDateLabel } from '../buildInfo';
import { noteExternalWrite } from '../lib/cloudSync';
import CloudSyncCard from './CloudSyncCard';
import PhoneCard from './PhoneCard';
import AutoBackupCard from './AutoBackupCard';
import UpdateCard from './UpdateCard';
import ModalShell from './ModalShell';

interface Props { onClose: () => void; }

export default function DataModal({ onClose }: Props) {
  const fileRef  = useRef<HTMLInputElement>(null);
  const [msg, setMsg]             = useState<{ text: string; ok: boolean } | null>(null);
  const [importing, setImporting] = useState(false);

  function handleExport() {
    const quest  = localStorage.getItem(STORE_KEY);
    const vynues = localStorage.getItem(VYNUES_STORE_KEY);
    if (!quest && !vynues) { setMsg({ text: 'Nothing to export — no data saved yet.', ok: false }); return; }
    // Bundle both stores. Backward compatible: old quest-only backups still import.
    // `appVersion` records which build wrote the file — purely informational on
    // import, but it's what tells you how old a backup is when restoring one.
    const bundle = { _milestone: 2, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), quest, vynues };
    const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    // Date-stamped so successive backups don't overwrite each other in Downloads.
    a.download = `milestone-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg({ text: 'Exported! Save the file somewhere safe.', ok: true });
  }

  function handleImportClick() {
    setMsg(null);
    fileRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const parsed = JSON.parse(text);
        if (parsed?._milestone) {
          // New bundle format: restore whichever stores are present.
          if (typeof parsed.quest === 'string')  localStorage.setItem(STORE_KEY, parsed.quest);
          if (typeof parsed.vynues === 'string') localStorage.setItem(VYNUES_STORE_KEY, parsed.vynues);
          if (typeof parsed.quest !== 'string' && typeof parsed.vynues !== 'string') {
            setMsg({ text: 'Invalid file — backup is empty.', ok: false });
            setImporting(false);
            return;
          }
        } else if (parsed?.state?.questlines) {
          // Legacy quest-only backup.
          localStorage.setItem(STORE_KEY, text);
        } else {
          setMsg({ text: 'Invalid file — does not contain Milestone data.', ok: false });
          setImporting(false);
          return;
        }
        // An import writes localStorage behind the stores' backs, so sync has to
        // be told — otherwise the restored data still carries the pre-import
        // version and the next sync would treat it as stale and undo it.
        noteExternalWrite();
        setMsg({ text: 'Data loaded! Restarting…', ok: true });
        setTimeout(() => window.location.reload(), 900);
      } catch {
        setMsg({ text: 'Could not read the file. Make sure it is the exported JSON.', ok: false });
        setImporting(false);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <ModalShell onClose={onClose} maxWidth={420}>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--page-text)' }}>
              Sync & Backup
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>
              Keep another computer in step, export your data, or restore from a saved backup.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Sync and automatic backups — both hide outside the desktop app */}
            <CloudSyncCard />
            <PhoneCard />
            <AutoBackupCard />
            {/* Which build this is and whether it's current. Renders in both
                builds — they update by different means, and the card picks. */}
            <UpdateCard />

            {/* Export */}
            <div style={{ background: 'var(--input-bg)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '14px 16px' }}>
              <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--page-text)' }}>
                Export
              </p>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                Download all your data — questlines, tasks, and Vynues projects — as a JSON file.
              </p>
              <button className="btn-gold" style={{ width: '100%' }} onClick={handleExport}>
                Download backup
              </button>
            </div>

            {/* Import */}
            <div style={{ background: 'var(--input-bg)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '14px 16px' }}>
              <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--page-text)' }}>
                Import
              </p>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                Load a previously exported backup. <span style={{ color: 'var(--danger)' }}>This replaces all current data.</span>
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <button
                className="btn-ghost"
                style={{ width: '100%', opacity: importing ? 0.5 : 1 }}
                onClick={handleImportClick}
                disabled={importing}
              >
                Load backup
              </button>
            </div>

            {/* Status message */}
            {msg && (
              <div style={{
                background: msg.ok ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
                border: `1px solid ${msg.ok ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
                borderRadius: 8, padding: '10px 14px', textAlign: 'center',
              }}>
                <p style={{ margin: 0, fontSize: 13, color: msg.ok ? 'var(--success)' : 'var(--danger)' }}>
                  {msg.ok ? '✓' : '✗'} {msg.text}
                </p>
              </div>
            )}

            <button className="btn-ghost" onClick={onClose} style={{ marginTop: 4 }}>Close</button>

            {/* Build stamp — confirms the running app is the build you expect. */}
            <p style={{ margin: '2px 0 0', textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              Milestone <strong style={{ color: 'var(--page-text-dim)' }}>{VERSION_LABEL}</strong>
              <br />
              built {buildDateLabel()}
            </p>
          </div>
    </ModalShell>
  );
}
