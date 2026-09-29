import { useEffect, useRef, useState } from 'react';
import ModalShell from './ModalShell';
import ArchivePanel from './ArchivePanel';
import './settings.css';

export default function SettingsModal({ onClose, notifications, onNotifications, onData, onNotion, desktop }: {
  onClose: () => void; notifications: string;
  onNotifications: () => void; onData: () => void; onNotion: () => void; desktop: boolean;
}) {
  const [tab, setTab] = useState('general');
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
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]') ?? [])];
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }}>
      <header className="settings-header"><div><h2 id="settings-heading">Settings</h2><p>Make Milestone work for you.</p></div><div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-ghost" aria-label="Close settings" onClick={onClose}>✕</button></div></header>
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
          {tab === 'general' && <><h3>General</h3><p className="settings-intro">Your everyday preferences.</p>
            <div className="settings-row"><div><h4>Notifications</h4><p>{notifications === 'Off' ? 'Reminders are turned off.' : `Reminders at ${notifications}.`}</p></div><button className="btn-ghost" onClick={onNotifications}>Manage reminders</button></div>
          </>}
          {tab === 'archive' && <ArchivePanel />}
          {tab === 'data' && <><h3>Data &amp; connections</h3><p className="settings-intro">Manage your saved work and integrations.</p>
            <div className="settings-row"><div><h4>Data &amp; backups</h4><p>Backups, sync, transfers and app updates.</p></div><button className="btn-ghost" onClick={onData}>Manage data</button></div>
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
