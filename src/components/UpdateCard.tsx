/**
 * "Which build am I on, and is it the current one?" — in the Data panel.
 *
 * Both halves of the app answer that question differently and the card shows
 * whichever applies. The desktop downloads a new executable and swaps it in on
 * restart (electron/updater.cjs); the web and phone copies replace their own
 * service worker and reload (lib/appUpdate.ts). What they have in common is that
 * both now happen without being asked, so most of the time this card exists to
 * say "nothing to do" — which is the point. The version chip in the nav bar
 * tells you what you are running; this tells you whether that is the latest.
 *
 * The manual button stays because automatic is not the same as immediate: the
 * desktop looks every six hours, and "I just published a fix, get it now" is a
 * real thing to want.
 */
import { useEffect, useState } from 'react';
import { VERSION_LABEL, buildDateLabel } from '../buildInfo';
import { useAppUpdate, checkForUpdate, applyUpdate } from '../lib/appUpdate';

const shell = {
  background: 'var(--input-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 10,
  padding: '14px 16px',
} as const;

const title = { margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--page-text)' } as const;
const body = { margin: '0 0 12px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 } as const;

export default function UpdateCard() {
  return window.electronAPI?.update ? <DesktopUpdate /> : <WebUpdate />;
}

// ── The desktop app ───────────────────────────────────────────────────────────

function DesktopUpdate() {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);

  useEffect(() => {
    const api = window.electronAPI?.update;
    if (!api) return;
    void api.status().then(setStatus);
    // Pushed rather than polled: a download has progress worth watching, and the
    // panel is often open precisely because someone is waiting on one.
    return api.onStatus(setStatus);
  }, []);

  if (!status) return null;

  const check = () => { void window.electronAPI?.update?.check().then(setStatus); };
  const apply = () => { void window.electronAPI?.update?.apply(); };

  const busy = status.phase === 'checking' || status.phase === 'downloading';

  return (
    <div style={shell}>
      <p style={title}>Updates</p>
      <p style={body}>
        {status.phase === 'staged' ? (
          <>Milestone <strong style={{ color: 'var(--page-text-dim)' }}>{status.stagedVersion}</strong> is downloaded and
          will be installed when you next close the app.</>
        ) : status.phase === 'downloading' ? (
          <>Downloading {status.latestVersion}…</>
        ) : status.phase === 'checking' ? (
          'Checking for a newer version…'
        ) : !status.supported ? (
          <>Running an unpackaged build ({VERSION_LABEL}), so there is nothing to update — use <code>npm run package</code>.</>
        ) : status.error ? (
          <>Couldn't check for updates: {status.error} This copy still works; it will try again later.</>
        ) : (
          <>Up to date on <strong style={{ color: 'var(--page-text-dim)' }}>{VERSION_LABEL}</strong>, built {buildDateLabel()}.
          New versions are downloaded on their own and installed when you close the app.</>
        )}
      </p>

      {status.supported && (
        <div style={{ display: 'flex', gap: 8 }}>
          {status.phase === 'staged' ? (
            <button className="btn-gold" style={{ flex: 1 }} onClick={apply}>
              Restart now
            </button>
          ) : (
            <button className="btn-ghost" style={{ flex: 1 }} onClick={check} disabled={busy}>
              {busy ? 'Checking…' : 'Check for updates'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── The web and phone copies ──────────────────────────────────────────────────

function WebUpdate() {
  const { ready, nextVersion, busy, supported } = useAppUpdate();

  return (
    <div style={shell}>
      <p style={title}>Updates</p>
      <p style={body}>
        {ready ? (
          <>{nextVersion ? `Milestone ${nextVersion}` : 'A new version'} is ready. It installs the next time this app
          goes to the background, or you can take it now.</>
        ) : !supported ? (
          <>Running {VERSION_LABEL}, built {buildDateLabel()}.</>
        ) : (
          <>Up to date on <strong style={{ color: 'var(--page-text-dim)' }}>{VERSION_LABEL}</strong>, built {buildDateLabel()}.
          This copy checks for a new build whenever you open it.</>
        )}
      </p>

      {supported && (
        ready
          ? <button className="btn-gold" style={{ width: '100%' }} onClick={applyUpdate}>Reload onto the new version</button>
          : (
            <button
              className="btn-ghost"
              style={{ width: '100%' }}
              disabled={busy}
              onClick={() => { void checkForUpdate({ force: true }); }}
            >
              {busy ? 'Checking…' : 'Check for updates'}
            </button>
          )
      )}
    </div>
  );
}
