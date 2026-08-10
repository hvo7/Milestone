import { useState, useEffect } from 'react';
import { useQuestStore } from '../store';
import ModalShell from './ModalShell';

interface Props { onClose: () => void; }

type PushStatus = 'idle' | 'testing' | 'pushing' | 'done' | 'error';
type PullStatus = 'idle' | 'pulling' | 'done' | 'error';

function parseNotionPageId(raw: string): string {
  const match = raw.trim().match(/([a-f0-9]{32})/i);
  if (match) {
    const id = match[1];
    return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
  }
  if (/^[a-f0-9-]{36}$/i.test(raw.trim())) return raw.trim();
  return raw.trim();
}

export default function NotionSyncModal({ onClose }: Props) {
  const questlines          = useQuestStore(s => s.questlines);
  const routines            = useQuestStore(s => s.routines);
  const setRoutineCompleted = useQuestStore(s => s.setRoutineCompleted);
  const setAllActionsComplete = useQuestStore(s => s.setAllActionsComplete);

  const [apiKey,      setApiKey]      = useState('');
  const [pageUrl,     setPageUrl]     = useState('');
  const [showKey,     setShowKey]     = useState(false);

  const [pushStatus,  setPushStatus]  = useState<PushStatus>('idle');
  const [pushLog,     setPushLog]     = useState<string[]>([]);
  const [testResult,  setTestResult]  = useState('');

  const [pullStatus,  setPullStatus]  = useState<PullStatus>('idle');
  const [pullLog,     setPullLog]     = useState<string[]>([]);
  const [pullSummary, setPullSummary] = useState('');

  const [errorMsg,    setErrorMsg]    = useState('');

  useEffect(() => {
    window.electronAPI?.notion.loadConfig().then(cfg => {
      if (cfg) { setApiKey(cfg.apiKey); setPageUrl(cfg.parentPageId); }
    });
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  async function handleTest() {
    if (!apiKey.trim()) return;
    setPushStatus('testing');
    setTestResult('');
    const res = await window.electronAPI!.notion.testConnection(apiKey.trim());
    if (res.ok) { setTestResult(`Connected as: ${res.name}`); setPushStatus('idle'); }
    else { setErrorMsg(res.error ?? 'Connection failed'); setPushStatus('error'); }
  }

  async function handlePush() {
    if (!apiKey.trim() || !pageUrl.trim()) return;
    setPushStatus('pushing');
    setPushLog([]);
    setErrorMsg('');
    await window.electronAPI!.notion.saveConfig({ apiKey: apiKey.trim(), parentPageId: parseNotionPageId(pageUrl) });
    const res = await window.electronAPI!.notion.sync({ questlines, routines });
    if (res.ok) { setPushLog(res.log ?? []); setPushStatus('done'); }
    else { setErrorMsg(res.error ?? 'Sync failed'); setPushLog(res.log ?? []); setPushStatus('error'); }
  }

  async function handlePull() {
    setPullStatus('pulling');
    setPullLog([]);
    setPullSummary('');
    setErrorMsg('');
    const res = await window.electronAPI!.notion.pull();
    if (!res.ok) { setErrorMsg(res.error ?? 'Pull failed'); setPullStatus('error'); return; }

    // Apply task updates
    let taskCount = 0;
    for (const u of res.taskUpdates ?? []) {
      setRoutineCompleted(u.id, u.completed);
      taskCount++;
    }

    // Apply quest updates — find the questline for each quest
    let questCount = 0;
    for (const u of res.questUpdates ?? []) {
      const ql = questlines.find(ql => ql.quests.some(q => q.id === u.questId));
      if (ql) { setAllActionsComplete(ql.id, u.questId, u.complete); questCount++; }
    }

    setPullLog(res.log ?? []);
    setPullSummary(`Updated ${taskCount} task${taskCount !== 1 ? 's' : ''} and ${questCount} quest${questCount !== 1 ? 's' : ''}.`);
    setPullStatus('done');
  }

  const canPush = apiKey.trim() && pageUrl.trim() && pushStatus !== 'pushing' && pushStatus !== 'testing';
  const canPull = !!apiKey.trim() && pullStatus !== 'pulling';

  return (
    // Taller than the others and scrolls with the page, so it top-aligns rather
    // than centring a panel that can outgrow the viewport.
    <ModalShell
      onClose={onClose}
      maxWidth={580}
      overlayStyle={{ alignItems: 'flex-start', paddingTop: 48, overflowY: 'auto' }}
      spring={{ stiffness: 320, damping: 30 }}
      from={{ scale: 0.92, y: 20 }}
      style={{ borderRadius: 10, padding: '32px 28px', border: '1px solid var(--card-border)', marginBottom: 48 }}
    >
          {/* Header */}
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--page-text)' }}>
              Notion Sync
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>
              Syncs into three linked databases: Questlines · Quests · Tasks
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Credentials */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <FieldLabel>Integration Token</FieldLabel>
                <div style={{ position: 'relative' }}>
                  <input
                    className="rune-input"
                    type={showKey ? 'text' : 'password'}
                    placeholder="secret_..."
                    value={apiKey}
                    onChange={e => { setApiKey(e.target.value); setTestResult(''); setPushStatus('idle'); }}
                    style={{ paddingRight: 44, fontFamily: 'monospace', fontSize: 13 }}
                  />
                  <button onClick={() => setShowKey(v => !v)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 16, padding: 0 }}>
                    {showKey ? '🙈' : '👁'}
                  </button>
                </div>
                <button onClick={handleTest} disabled={!apiKey.trim() || pushStatus === 'testing'} style={{ marginTop: 8, background: 'none', border: '1px solid var(--card-border)', borderRadius: 8, color: 'var(--text-dim)', fontFamily: 'inherit', fontSize: 12, fontWeight: 500, padding: '5px 14px', cursor: apiKey.trim() ? 'pointer' : 'not-allowed', opacity: apiKey.trim() ? 1 : 0.4, transition: 'all 0.2s' }}>
                  {pushStatus === 'testing' ? 'Testing…' : 'Test Connection'}
                </button>
                {testResult && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#6ee7b7' }}>✓ {testResult}</p>}
              </div>

              <div>
                <FieldLabel>Notion Page URL or ID</FieldLabel>
                <input
                  className="rune-input"
                  placeholder="https://notion.so/... or paste page ID"
                  value={pageUrl}
                  onChange={e => { setPageUrl(e.target.value); setPushStatus('idle'); }}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
                <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                  Share this page with your integration first. Milestone creates
                  Questlines · Quests · Tasks databases inside it on first push.
                </p>
              </div>
            </div>

            {/* Push / Pull panels */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

              {/* ── Push ── */}
              <div style={{ background: 'var(--input-bg)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '16px' }}>
                <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: 'var(--page-text)' }}>
                  ↑ Push to Notion
                </p>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                  Send your current quests and tasks to Notion.
                </p>
                <button className="btn-gold" style={{ width: '100%', opacity: canPush ? 1 : 0.45, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }} disabled={!canPush} onClick={handlePush}>
                  {pushStatus === 'pushing' ? <><Spinner /> Pushing…</> : '↑ Push Now'}
                </button>

                {(pushLog.length > 0 || pushStatus === 'pushing') && (
                  <div style={{ marginTop: 10, background: 'var(--input-bg)', border: '1px solid var(--card-border)', borderRadius: 5, padding: '8px 10px', maxHeight: 110, overflowY: 'auto' }}>
                    {pushStatus === 'pushing' && !pushLog.length && <p style={{ margin: 0, fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>Pushing… may take a moment.</p>}
                    {pushLog.map((l, i) => <p key={i} style={{ margin: '2px 0', fontSize: 11, color: l.startsWith('Sync complete') ? 'var(--success)' : 'var(--page-text)', fontFamily: 'monospace' }}>{l}</p>)}
                  </div>
                )}
                {pushStatus === 'done' && !pushLog.some(l => l.startsWith('Sync complete')) && (
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: '#6ee7b7' }}>✓ Pushed to Notion</p>
                )}
              </div>

              {/* ── Pull ── */}
              <div style={{ background: 'var(--input-bg)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '16px' }}>
                <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: 'var(--page-text)' }}>
                  ↓ Pull from Notion
                </p>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                  Read back task done-status and quest completion from Notion.
                </p>
                <button className="btn-gold" style={{ width: '100%', opacity: canPull ? 1 : 0.45, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }} disabled={!canPull} onClick={handlePull}>
                  {pullStatus === 'pulling' ? <><Spinner /> Pulling…</> : '↓ Pull Now'}
                </button>

                {(pullLog.length > 0 || pullStatus === 'pulling') && (
                  <div style={{ marginTop: 10, background: 'var(--input-bg)', border: '1px solid var(--card-border)', borderRadius: 5, padding: '8px 10px', maxHeight: 110, overflowY: 'auto' }}>
                    {pullStatus === 'pulling' && !pullLog.length && <p style={{ margin: 0, fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>Pulling… may take a moment.</p>}
                    {pullLog.map((l, i) => <p key={i} style={{ margin: '2px 0', fontSize: 11, color: l.startsWith('Pull complete') ? 'var(--success)' : 'var(--page-text)', fontFamily: 'monospace' }}>{l}</p>)}
                  </div>
                )}
                {pullStatus === 'done' && pullSummary && (
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: '#6ee7b7' }}>✓ {pullSummary}</p>
                )}
              </div>
            </div>

            {/* Error */}
            {(pushStatus === 'error' || pullStatus === 'error') && errorMsg && (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, padding: '10px 14px' }}>
                <p style={{ margin: 0, fontSize: 12, color: '#f87171' }}>✗ {errorMsg}</p>
              </div>
            )}

            <button className="btn-ghost" onClick={onClose}>Close</button>
          </div>
    </ModalShell>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 7 }}>
      {children}
    </label>
  );
}

function Spinner() {
  return <span style={{ display: 'inline-block', width: 13, height: 13, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />;
}
