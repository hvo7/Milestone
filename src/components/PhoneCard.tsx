/**
 * "Open Milestone on my phone" — the desktop half of electron/phone.cjs.
 *
 * Shows the address to type on the phone and lets the bridge be switched off
 * again. There is no account to sign into and nothing is uploaded anywhere: the
 * phone talks to this computer, on this network, and only while this is on.
 */
import { useEffect, useState } from 'react';
import { useSyncStatus } from '../lib/cloudSync';
import { loadRelay, saveRelay, testRelay, relayConfigured, type RelayConfig } from '../lib/relay';

/**
 * Where to reach your other copy when it isn't on this network.
 *
 * The Wi-Fi bridge below only works while you're next to the computer. A relay
 * is the same exchange at an address that stays up, so an edit made while you're
 * out is waiting for the desktop when it next looks — and the desktop's edits
 * are waiting for you. Shown on both devices, because both have to point at it.
 */
function RelaySection() {
  const [config, setConfig] = useState<RelayConfig>(loadRelay);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setResult(null);
    try {
      const saved = saveRelay(config);
      setConfig(saved);
      setResult(await testRelay(saved));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--card-border)' }}>
      <h4 style={{ margin: '0 0 4px', fontSize: 12.5, fontWeight: 700, color: 'var(--page-text)' }}>
        When you're away
      </h4>
      <p style={{ margin: '0 0 10px', fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        An address that stays up, so edits find each other even when the two devices
        are never awake at once — and changes arrive as they happen rather than when
        something next asks. Deploy it with <code>fly deploy</code> (see
        <code>docs/relay.md</code>), then put the same address and key on every device.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input
          className="rune-input"
          placeholder="https://milestone.example.com"
          value={config.url}
          onChange={e => setConfig(c => ({ ...c, url: e.target.value }))}
          style={{ fontSize: 12.5, padding: '7px 10px' }}
        />
        <input
          className="rune-input"
          type="password"
          placeholder="Shared key (MILESTONE_TOKEN)"
          value={config.token}
          onChange={e => setConfig(c => ({ ...c, token: e.target.value }))}
          style={{ fontSize: 12.5, padding: '7px 10px' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" className="btn-ghost" onClick={save} disabled={busy} style={{ fontSize: 12, padding: '5px 12px' }}>
            {busy ? 'Checking…' : 'Save and check'}
          </button>
          {result && (
            <span style={{ fontSize: 11.5, color: result.ok ? 'var(--success)' : 'var(--danger)' }}>
              {result.ok ? '✓ Reachable' : result.error}
            </span>
          )}
          {!result && relayConfigured(config) && (
            <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Set up</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PhoneCard() {
  const api = window.electronAPI?.phone;
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  const overWifi = useSyncStatus(s => s.overWifi);
  const linked = useSyncStatus(s => s.linked);

  useEffect(() => {
    if (!api) return;
    void api.status().then(setStatus);
  }, [api]);

  // On the phone itself this card would be offering to serve the app to itself.
  if (overWifi) {
    return (
      <div className="parchment" style={{ borderRadius: 14, padding: '14px 16px', marginTop: 14 }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: 'var(--page-text)' }}>
          {linked ? 'Linked to your other copy' : 'Working on its own'}
        </h3>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          {linked
            ? 'Everything is stored on this device, with or without a signal. Changes find your computer over Wi-Fi when you’re home, and through the relay when you’re not.'
            : 'Everything is stored on this device and works with no signal. Nothing is being exchanged yet — give it a relay below and your computer will see these edits.'}
        </p>
        <RelaySection />
      </div>
    );
  }

  if (!api || !status?.available) return null;

  async function toggle() {
    if (!api) return;
    setBusy(true);
    setError('');
    try {
      const res: { ok: boolean; error?: string; status: PhoneStatus } =
        status?.enabled ? await api.stop() : await api.start();
      setStatus(res.status);
      if (!res.ok) setError(res.error ?? 'Could not start.');
    } finally {
      setBusy(false);
    }
  }

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(''), 1500);
  };

  return (
    <div className="parchment" style={{ borderRadius: 14, padding: '14px 16px', marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--page-text)', flex: 1 }}>
          📱 On your phone
        </h3>
        <button
          type="button"
          className={status.enabled ? 'btn-ghost' : 'btn-gold'}
          onClick={toggle}
          disabled={busy || !status.built}
          style={{ fontSize: 12, padding: '5px 12px' }}
        >
          {busy ? '…' : status.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>

      {!status.built && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>
          No build to serve — run <code>npm run build</code> first.
        </p>
      )}

      {status.enabled && status.urls.length > 0 && (
        <>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-dim)' }}>
            Open this on your phone, then add it to your home screen:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {status.urls.map(url => (
              <button
                key={url}
                type="button"
                onClick={() => copy(url)}
                title="Copy"
                style={{
                  fontFamily: 'ui-monospace, monospace', fontSize: 11.5, textAlign: 'left',
                  padding: '7px 10px', borderRadius: 8, cursor: 'pointer', wordBreak: 'break-all',
                  border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--page-text)',
                }}
              >
                {url}{copied === url ? '  ✓ copied' : ''}
              </button>
            ))}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            The link carries a key, so keep it to yourself. Both devices have to be on
            the same Wi-Fi, and this computer has to be awake.
          </p>
        </>
      )}

      {status.enabled && status.urls.length === 0 && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>
          This computer isn't on a network I can see.
        </p>
      )}

      {error && <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--danger)' }}>{error}</p>}

      <RelaySection />
    </div>
  );
}
