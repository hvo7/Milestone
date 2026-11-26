import { useEffect, useRef, useState } from 'react';
import ModalShell from './ModalShell';
import ArchivePanel from './ArchivePanel';
import { useUIStore } from '../uiStore';
import Icon from './Icon';
import './settings.css';

export default function SettingsModal({ onClose, notifications, onNotifications, onData, onNotion, onSpaces, desktop, syncReview = 0 }: {
  onClose: () => void; notifications: string;
  onNotifications: () => void; onData: () => void; onNotion: () => void; onSpaces?: () => void; desktop: boolean;
  /** Open sync issues, so the way to them is marked. */
  syncReview?: number;
}) {
  const [tab, setTab] = useState(syncReview ? 'data' : 'general');
  const resetTime = useUIStore(s => s.resetTime);
  const setResetTime = useUIStore(s => s.setResetTime);
  const [resetDraft, setResetDraft] = useState(resetTime);
  const theme = useUIStore(s => s.theme);
  const toggleTheme = useUIStore(s => s.toggleTheme);
  const showPageArt = useUIStore(s => s.showPageArt) !== false;
  const setShowPageArt = useUIStore(s => s.setShowPageArt);
  const dialog = useRef<HTMLElement>(null);
  const tabs = [{ id: 'general', label: 'General', icon: 'settings' }, { id: 'archive', label: 'Archive', icon: 'archive' }, { id: 'data', label: 'Data & connections', icon: 'data' }] as const;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus();
    return () => previous?.focus();
  }, []);
  return <ModalShell onClose={onClose} maxWidth={780} style={{ padding: 0, overflow: 'hidden' }}>
    <section ref={dialog} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-heading" onKeyDown={e => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [tabindex="0"]') ?? [])];
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }}>
      <header className="settings-header"><h2 id="settings-heading">Settings</h2>
        <button type="button" className="icon-btn-round" aria-label="Close settings" title="Close settings" onClick={onClose}><Icon name="close" /></button></header>
      <div className="settings-layout">
        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {tabs.map((item, index) => <button key={item.id} id={`settings-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id}
            aria-controls={`settings-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}
            onKeyDown={e => {
              if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
              e.preventDefault();
              const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : -1) + tabs.length) % tabs.length;
              setTab(tabs[next].id); document.getElementById(`settings-tab-${tabs[next].id}`)?.focus();
            }}><SettingsIcon name={item.icon} /><span>{item.label}</span></button>)}
        </div>
        <div className="settings-content" role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
          {tab === 'general' && <><h3>General</h3>
            <div className="settings-row"><div><h4 id="setting-theme">Theme</h4></div>
              <div role="group" aria-labelledby="setting-theme" style={{ display: 'flex', gap: 6 }}>
                {(['dark', 'light'] as const).map(mode => <button key={mode} type="button" className="chip" aria-pressed={theme === mode}
                  onClick={() => { if (theme !== mode) toggleTheme(); }}>{mode === 'dark' ? 'Dark' : 'Light'}</button>)}
              </div>
            </div>
            <div className="settings-row"><div><h4 id="setting-page-art">Show page art</h4></div>
              <button type="button" className="switch" role="switch" aria-checked={showPageArt} aria-labelledby="setting-page-art"
                onClick={() => setShowPageArt(!showPageArt)} />
            </div>
            {onSpaces && <div className="settings-row"><div><h4>Space tabs</h4></div><button className="btn-ghost" onClick={onSpaces}>Manage spaces</button></div>}
            <div className="settings-row"><div><h4><label htmlFor="goal-reset-time">Goal reset time</label></h4><p>Your daily goals and Today board start a new day at this local time. Weekly goals keep their weekly cadence. Saving applies immediately and may start a new day.</p></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input id="goal-reset-time" type="time" className="rune-input" value={resetDraft} onChange={e => setResetDraft(e.target.value)} style={{ width: 130 }} />
                <button className="btn-ghost" disabled={!resetDraft || resetDraft === resetTime} onClick={() => setResetTime(resetDraft)}>Save reset time</button>
              </div>
            </div>
            <div className="settings-row"><div><h4>Notifications</h4><p>{notifications === 'Off' ? 'Reminders are turned off.' : `Reminders at ${notifications}.`}</p></div><button className="btn-ghost" onClick={onNotifications}>Manage reminders</button></div>
          </>}
          {tab === 'archive' && <ArchivePanel />}
          {tab === 'data' && <><h3>Data &amp; connections</h3>
            <div className="settings-row"><div><h4>Data &amp; backups</h4><p>{syncReview ? <strong style={{ color: 'var(--gold)' }}>{syncReview === 1 ? '1 sync item' : `${syncReview} sync items`} to review.</strong> : 'Backups, sync, transfers and app updates.'}</p></div><button className="btn-ghost" onClick={onData}>Manage data</button></div>
            <div className="settings-row"><div><h4>Notion</h4><p>{desktop ? 'Import and export your workspace.' : 'Import and export are available in the desktop app.'}</p></div><button className="btn-ghost" disabled={!desktop} onClick={onNotion}>{desktop ? 'Open Notion' : 'Desktop only'}</button></div>
          </>}
        </div>
      </div>
    </section>
  </ModalShell>;
}

function SettingsIcon({ name }: { name: 'archive' | 'settings' | 'data' }) {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {name === 'archive' ? <><rect x="3" y="3" width="18" height="5" rx="1" /><path d="M5 8v12h14V8M10 12h4" /></> : name === 'data' ? <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" /></> : <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="8" cy="18" r="2" /></>}
  </svg>;
}
