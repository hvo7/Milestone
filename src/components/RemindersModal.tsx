/**
 * Reminder settings.
 *
 * Small on purpose. The only decisions worth offering are "do you want one" and
 * "when" — every extra knob here is a way to end up with a notification you mute,
 * which is strictly worse than none.
 *
 * The test button matters more than it looks: without it, the only way to find
 * out whether notifications are permitted (browser prompt, Windows Focus Assist,
 * a Do-Not-Disturb schedule) is to wait until evening and see if anything
 * happens. Failing loudly here beats failing silently at 7pm.
 */
import { useState } from 'react';
import { useUIStore, DEFAULT_REMINDERS } from '../store';
import { ensureNotificationPermission, sendTestReminder, currentDue, parseTime } from '../lib/reminders';
import ModalShell from './ModalShell';

const isElectron = !!window.electronAPI;

export default function RemindersModal({ onClose }: { onClose: () => void }) {
  const reminders = useUIStore(s => s.reminders) ?? DEFAULT_REMINDERS;
  const setReminders = useUIStore(s => s.setReminders);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const { open, total } = currentDue();
  const timeValid = parseTime(reminders.time) !== null;

  async function handleToggle(next: boolean) {
    setMsg(null);
    if (!next) { setReminders({ enabled: false }); return; }
    // Ask before storing the setting, so a blocked permission can't leave the
    // toggle reading "on" while nothing will ever fire.
    setBusy(true);
    const allowed = await ensureNotificationPermission();
    setBusy(false);
    if (!allowed) {
      setMsg({ text: 'Your browser or system is blocking notifications for Milestone. Allow them, then try again.', ok: false });
      return;
    }
    setReminders({ enabled: true });
  }

  async function handleTest() {
    setBusy(true);
    setMsg(null);
    const res = await sendTestReminder();
    setBusy(false);
    setMsg(res.ok
      ? { text: 'Sent. If nothing appeared, check your system notification settings.', ok: true }
      : { text: res.error ?? 'Could not send a notification.', ok: false });
  }

  return (
    <ModalShell onClose={onClose} maxWidth={420}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--page-text)' }}>Daily reminder</h2>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          One nudge a day, and only on days with something still open.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        <label style={{
          display: 'flex', alignItems: 'center', gap: 10, cursor: busy ? 'default' : 'pointer',
          background: 'var(--input-bg)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '14px 16px',
        }}>
          <input
            type="checkbox"
            className="rune-check"
            checked={reminders.enabled}
            disabled={busy}
            onChange={e => void handleToggle(e.target.checked)}
          />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--page-text)' }}>
              Remind me
            </span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
              {total === 0
                ? 'Nothing on today’s list yet.'
                : open === 0
                  ? 'Everything is done today — nothing would be sent.'
                  : `${open} of ${total} still open right now.`}
            </span>
          </span>
        </label>

        <div style={{ background: 'var(--input-bg)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '14px 16px' }}>
          <label htmlFor="reminder-time" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--page-text)', marginBottom: 6 }}>
            Time
          </label>
          <input
            id="reminder-time"
            type="time"
            className="rune-input"
            value={reminders.time}
            onChange={e => setReminders({ time: e.target.value })}
            style={{ width: '100%', opacity: reminders.enabled ? 1 : 0.55 }}
          />
          <p style={{ margin: '8px 0 0', fontSize: 11.5, color: timeValid ? 'var(--text-dim)' : 'var(--danger)', lineHeight: 1.5 }}>
            {timeValid
              ? 'Late enough to be a useful prompt, early enough to still act on it. If the app was closed at that moment, the reminder arrives the next time it opens.'
              : 'That isn’t a valid time — nothing will fire until it is.'}
          </p>
        </div>

        {isElectron && (
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
            background: 'var(--input-bg)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '14px 16px',
          }}>
            <input
              type="checkbox"
              className="rune-check"
              checked={reminders.keepInTray}
              onChange={e => setReminders({ keepInTray: e.target.checked })}
              style={{ marginTop: 2 }}
            />
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--page-text)' }}>
                Keep running in the tray
              </span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.5 }}>
                Closing the window hides it instead of quitting, so the reminder still arrives.
                Quit for real from the tray icon’s menu.
              </span>
            </span>
          </label>
        )}

        <button className="btn-ghost" onClick={() => void handleTest()} disabled={busy} style={{ opacity: busy ? 0.5 : 1 }}>
          Send a test notification
        </button>

        {msg && (
          <div style={{
            background: msg.ok ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
            border: `1px solid ${msg.ok ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
            borderRadius: 8, padding: '10px 14px',
          }}>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: msg.ok ? 'var(--success)' : 'var(--danger)' }}>
              {msg.ok ? '✓' : '✗'} {msg.text}
            </p>
          </div>
        )}

        <button className="btn-ghost" onClick={onClose} style={{ marginTop: 4 }}>Close</button>
      </div>
    </ModalShell>
  );
}
