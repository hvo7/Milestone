import { useState } from 'react';
import {
  useSyncStatus, enableSync, disableSync, syncNow, peekFolder, dismissNotice,
} from '../lib/cloudSync';

/** "3 minutes ago" — precise enough to answer "did my other computer's edit land?". */
function agoLabel(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Keeps a long Windows path readable in a 420px modal by dropping the middle. */
function shortPath(path: string): string {
  if (path.length <= 46) return path;
  return `${path.slice(0, 18)}…${path.slice(-26)}`;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--input-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 10,
  padding: '14px 16px',
};

/**
 * Settings for cross-computer sync, shown inside the Data panel.
 *
 * The one screen that matters is the first: choosing a folder that already
 * holds another computer's data means one of the two copies is about to be
 * replaced, so that choice is made explicitly here rather than resolved by a
 * rule the user can't see.
 */
export default function CloudSyncCard() {
  const status = useSyncStatus();
  const [pending, setPending] = useState<{ folder: string; peers: { deviceName: string; updatedAt: string }[] } | null>(null);
  const [working, setWorking] = useState(false);

  // Browser/dev builds have no bridge to the filesystem — nothing to offer.
  if (!status.available) return null;

  async function choose() {
    const folder = await window.electronAPI!.sync.pickFolder();
    if (!folder) return;
    setWorking(true);
    try {
      const peers = await peekFolder(folder);
      // A folder with someone else's data in it needs the user to say which copy
      // survives; an empty one has no ambiguity to resolve.
      if (peers.length) setPending({ folder, peers });
      else await enableSync(folder, 'push');
    } finally {
      setWorking(false);
    }
  }

  async function resolve(mode: 'adopt' | 'push') {
    if (!pending) return;
    setWorking(true);
    try { await enableSync(pending.folder, mode); setPending(null); }
    finally { setWorking(false); }
  }

  return (
    <div style={cardStyle}>
      <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--page-text)' }}>
        Sync across computers
      </p>

      {/* ── Choosing which copy survives ─────────────────────────────────── */}
      {pending ? (
        <>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            That folder already holds data from{' '}
            <strong style={{ color: 'var(--page-text)' }}>
              {pending.peers.map(p => p.deviceName).join(', ')}
            </strong>. Only one copy can survive — which one?
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn-gold" style={{ width: '100%' }} disabled={working} onClick={() => resolve('adopt')}>
              Use the folder's data
            </button>
            <button className="btn-ghost" style={{ width: '100%' }} disabled={working} onClick={() => resolve('push')}>
              Use this computer's data
            </button>
            <button className="btn-ghost" style={{ width: '100%' }} disabled={working} onClick={() => setPending(null)}>
              Cancel
            </button>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              Either way the losing copy is saved to <code>backups/</code> inside the folder first.
            </p>
          </div>
        </>
      ) : status.enabled ? (
        /* ── Running ──────────────────────────────────────────────────────── */
        <>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            <span style={{ color: 'var(--success)' }}>●</span> Syncing as{' '}
            <strong style={{ color: 'var(--page-text)' }}>{status.deviceName}</strong>
            <br />
            <span title={status.folder} style={{ wordBreak: 'break-all' }}>{shortPath(status.folder)}</span>
            <br />
            Last synced {agoLabel(status.lastSyncedAt)}
            {status.peers.length > 0 && (
              <>
                <br />
                Also here: {status.peers.map(p => `${p.deviceName} (${agoLabel(p.updatedAt)})`).join(', ')}
              </>
            )}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-gold" style={{ flex: 1 }} disabled={status.busy || working} onClick={() => void syncNow()}>
              {status.busy ? 'Syncing…' : 'Sync now'}
            </button>
            <button className="btn-ghost" style={{ flex: 1 }} disabled={working} onClick={() => void disableSync()}>
              Turn off
            </button>
          </div>
        </>
      ) : (
        /* ── Off ──────────────────────────────────────────────────────────── */
        <>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Keep this computer and another in step through a folder your cloud drive already
            syncs — OneDrive, Dropbox, Google Drive. Pick the same folder on both, and edits
            on one show up on the other within a few seconds.
          </p>
          <button className="btn-gold" style={{ width: '100%' }} disabled={working} onClick={() => void choose()}>
            {working ? 'Checking folder…' : 'Choose sync folder…'}
          </button>
        </>
      )}

      {status.error && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--danger)', lineHeight: 1.5 }}>
          ✗ {status.error}
        </p>
      )}

      {status.notice && (
        <div style={{
          marginTop: 10, padding: '10px 12px', borderRadius: 8,
          background: 'var(--accent-soft)', border: '1px solid var(--accent-border)',
        }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--page-text)', lineHeight: 1.55 }}>{status.notice}</p>
          <button className="btn-ghost" style={{ marginTop: 8, width: '100%' }} onClick={dismissNotice}>
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
