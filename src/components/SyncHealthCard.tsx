/**
 * Sync health: what needs you, which device has caught up, and the emergency
 * tools for when sync has gone wrong anyway.
 *
 * Shown on every device that syncs (desktop, laptop, phone). The issue list is
 * itself synced, so what one device set aside can be reviewed on any of them.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  useSyncStatus, setSyncPaused, syncNow, restoreIssue, dismissIssue, peerCopies, relayHistory, relayHistoryCopy,
  compareWith, bringBack, restoreCopy, shareThisDeviceEverywhere, emergencyBundle, backupBundleOf,
  type RecoverySource, type RecoveryItem, type PeerStatus,
} from '../lib/cloudSync';
import { useSyncIssues, openIssues, type SyncIssue } from '../lib/syncIssues';
import { listSafetySnapshots, loadSafetySnapshot, type SnapshotSummary } from '../lib/syncSafety';
import type { HistoryEntry } from '../lib/phoneTransport';
import './syncHealth.css';

const STALE_DAYS = 3;

function ago(iso: string, now: number): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return 'unknown';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hr ago`;
  const days = Math.round(seconds / 86_400);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const when = (iso: string | number) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function IssueRow({ issue }: { issue: SyncIssue }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const text = issue.kind === 'edit'
    ? <>Changed on {issue.lostFrom} and {issue.keptFrom} at the same time. Using {issue.keptFrom}'s.</>
    : <>Deleted on {issue.lostFrom} while it was changed on {issue.keptFrom}, so it was kept.</>;
  const restoreLabel = issue.kind === 'edit' ? `Use ${issue.lostFrom}'s` : 'Delete it';
  async function restore() {
    setBusy(true); setFailed(false);
    try { if (!await restoreIssue(issue)) setFailed(true); } finally { setBusy(false); }
  }
  return (
    <li className="sh-issue">
      <strong>“{issue.label}”</strong>
      <span>{text}</span>
      {failed && <span className="sh-error">Its place no longer exists here. Use Recover items to bring it back.</span>}
      <div className="sh-actions">
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void restore()}>{restoreLabel}</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => dismissIssue(issue)}>Keep</button>
      </div>
    </li>
  );
}

function DeviceRow({ peer, now }: { peer: PeerStatus; now: number }) {
  const stale = now - Date.parse(peer.updatedAt) > STALE_DAYS * 86_400_000;
  return (
    <li className="sh-device">
      <span className="sh-device-name">{peer.deviceName}</span>
      <span className="sh-meta">
        {peer.appVersion ? `v${peer.appVersion}` : 'older version'} · <span className={stale ? 'sh-warn' : undefined}>{ago(peer.updatedAt, now)}</span>
      </span>
      {!!peer.waiting && <span className="sh-chip">{peer.waiting} waiting</span>}
      {peer.legacy && <span className="sh-chip sh-chip-warn">Update needed</span>}
    </li>
  );
}

type SourceOption = { id: string; label: string; load: () => Promise<RecoverySource | null> };

function Recovery({ onDone }: { onDone: (message: string) => void }) {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [choice, setChoice] = useState('');
  const [source, setSource] = useState<RecoverySource | null>(null);
  const [items, setItems] = useState<RecoveryItem[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<'replace' | 'everywhere' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void listSafetySnapshots().then(setSnapshots);
    void relayHistory().then(setHistory);
  }, []);

  const options = useMemo<SourceOption[]>(() => [
    ...peerCopies().map(copy => ({ id: copy.id, label: `${copy.label} · now`, load: async () => copy })),
    ...snapshots.map(snap => ({ id: `snap:${snap.id}`, label: `${snap.reason} · ${when(snap.at)}`, load: async () => {
      const full = await loadSafetySnapshot(snap.id);
      return full ? { id: `snap:${full.id}`, label: `the copy from ${when(full.at)}`, at: full.at, stores: full.stores } : null;
    } })),
    ...history.map(entry => ({ id: `history:${entry.id}`, label: `${entry.deviceName}, relay copy · ${when(entry.saved)}`, load: () => relayHistoryCopy(entry.id) })),
  ], [snapshots, history]);

  async function choose(id: string) {
    setChoice(id); setSource(null); setItems([]); setConfirm(null); setError('');
    const option = options.find(item => item.id === id);
    if (!option) return;
    const loaded = await option.load();
    if (!loaded) { setError('That copy could not be read.'); return; }
    const found = compareWith(loaded);
    // What is missing is offered ticked; a different version is offered, not assumed.
    setSource(loaded); setItems(found); setPicked(new Set(found.filter(item => item.change === 'missing').map(item => `${item.slot}:${item.path}`)));
  }

  async function act(work: () => Promise<string>) {
    setBusy(true); setError('');
    try { onDone(await work()); }
    catch (err) { setError(err instanceof Error ? err.message : 'That did not work.'); }
    finally { setBusy(false); setConfirm(null); }
  }

  return (
    <div className="sh-recovery">
      <label className="sh-label" htmlFor="sh-source">Recover from</label>
      <select id="sh-source" className="rune-input" value={choice} onChange={e => void choose(e.target.value)}>
        <option value="">Choose a copy…</option>
        {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>

      {source && (items.length ? (
        <>
          {(['missing', 'different'] as const).map(change => {
            const group = items.filter(item => item.change === change);
            if (!group.length) return null;
            return <div key={change}>
              <p className="sh-label">{change === 'missing' ? 'Not on this device' : 'Different here'} ({group.length})</p>
              <ul className="sh-picks">
                {group.map(item => {
                  const key = `${item.slot}:${item.path}`;
                  return <li key={key}><label>
                    <input type="checkbox" checked={picked.has(key)} onChange={() => setPicked(prev => {
                      const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next;
                    })} /> {item.label}
                  </label></li>;
                })}
              </ul>
            </div>;
          })}
          <button type="button" className="btn-gold" disabled={busy || !picked.size}
            onClick={() => void act(async () => {
              const count = await bringBack(source, items.filter(item => picked.has(`${item.slot}:${item.path}`)));
              return `Brought back ${count === 1 ? '1 item' : `${count} items`}.`;
            })}>Bring back selected</button>
        </>
      ) : <p className="sh-label">This copy matches this device.</p>)}

      {source && (confirm === 'replace' ? (
        <div className="sh-confirm">
          <span>Replace this device's data with {source.label}? Changes made since will be removed on every device.</span>
          <div className="sh-actions">
            <button type="button" className="btn-gold" disabled={busy} onClick={() => void act(async () => { await restoreCopy(source); return 'Restored.'; })}>Replace</button>
            <button type="button" className="btn-ghost" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="sh-actions">
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirm('replace')}>Replace with this copy…</button>
          <button type="button" className="btn-ghost" onClick={() => download(`milestone-recovered-${new Date().toISOString().slice(0, 10)}.json`, backupBundleOf(source.stores))}>Download it</button>
        </div>
      ))}

      <div className="sh-divider" />
      {confirm === 'everywhere' ? (
        <div className="sh-confirm">
          <span>Make this device's data the copy on every device? Anything only on another device will be removed there.</span>
          <div className="sh-actions">
            <button type="button" className="btn-gold" disabled={busy} onClick={() => void act(async () => { await shareThisDeviceEverywhere(); return 'This device\'s data is now on every device.'; })}>Use everywhere</button>
            <button type="button" className="btn-ghost" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="sh-actions">
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirm('everywhere')}>Use this device's data everywhere…</button>
          <button type="button" className="btn-ghost" onClick={() => download(`milestone-emergency-${new Date().toISOString().slice(0, 10)}.json`, emergencyBundle())}>Download emergency file</button>
        </div>
      )}
      {error && <p className="sh-error">{error}</p>}
    </div>
  );
}

export default function SyncHealthCard() {
  const status = useSyncStatus();
  const issues = useSyncIssues(s => s.issues);
  const open = openIssues(issues);
  const [recovering, setRecovering] = useState(false);
  const [message, setMessage] = useState('');
  // Read when the panel opens; "3 days ago" does not need to tick.
  const [now] = useState(() => Date.now());

  // Shown in Milestone Testing too, which never syncs, so the tools can be reviewed.
  if (!status.available && !open.length && import.meta.env.MODE !== 'testing') return null;

  const legacy = status.peers.filter(peer => peer.legacy);
  const state = !status.enabled && !open.length ? { text: 'Not connected', tone: 'warn' }
    : status.paused ? { text: 'Paused', tone: 'warn' }
    : open.length ? { text: `${open.length} to review`, tone: 'warn' }
    : status.error ? { text: 'Not syncing', tone: 'bad' }
    : legacy.length ? { text: 'Update needed', tone: 'warn' }
    : status.pending ? { text: 'Sending…', tone: 'ok' }
    : { text: 'All synced', tone: 'ok' };

  return (
    <section className="sh-card" aria-labelledby="sh-title">
      <header className="sh-head">
        <h3 id="sh-title">Sync health</h3>
        <span className={`sh-state sh-${state.tone}`} role="status">{state.text}</span>
      </header>

      {status.paused && <p className="sh-note">Sync is paused. Changes stay on this device until you resume.</p>}
      {legacy.length > 0 && <p className="sh-note">{legacy.map(peer => peer.deviceName).join(' and ')} {legacy.length === 1 ? 'runs' : 'run'} an older version of Milestone. Until {legacy.length === 1 ? 'it updates' : 'they update'}, {legacy.length === 1 ? 'its' : 'their'} copy can add items here but cannot delete or undo changes made on this device.</p>}

      {open.length > 0 && <ul className="sh-list">{open.map(issue => <IssueRow key={issue.id} issue={issue} />)}</ul>}

      {status.peers.length > 0 && <ul className="sh-list sh-devices">{status.peers.map(peer => <DeviceRow key={peer.deviceName + peer.updatedAt} peer={peer} now={now} />)}</ul>}

      <div className="sh-actions">
        {status.paused
          ? <button type="button" className="btn-gold" onClick={() => void setSyncPaused(false)}>Resume sync</button>
          : <button type="button" className="btn-ghost" disabled={!status.enabled} onClick={() => void setSyncPaused(true)}>Pause sync</button>}
        {!status.paused && status.enabled && <button type="button" className="btn-ghost" disabled={status.busy} onClick={() => void syncNow()}>{status.busy ? 'Syncing…' : 'Sync now'}</button>}
        <button type="button" className="btn-ghost" aria-expanded={recovering} onClick={() => setRecovering(value => !value)}>Recover items</button>
      </div>
      {recovering && <Recovery onDone={text => { setMessage(text); setRecovering(false); }} />}
      {message && <p className="sh-done" role="status">{message}</p>}
    </section>
  );
}
