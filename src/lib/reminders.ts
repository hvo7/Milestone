/**
 * The daily nudge.
 *
 * Milestone was entirely passive: it tracked habits perfectly and never once told
 * you about them, so a broken streak and "I forgot the app exists" looked
 * identical from the inside. This closes that.
 *
 * Deliberately modest. One notification a day, only on days with something still
 * open, only after the hour you chose, and never twice for the same day —
 * anything more and it becomes the thing you mute, which is worse than not having
 * it at all.
 *
 * Driven from the renderer because that is where the data is: localStorage isn't
 * readable from the main process, so the decision has to be made here and only the
 * *display* handed across the bridge.
 */
import { useQuestStore, useUIStore, dateKey, logicalDayStart } from '../store';
import { useVynuesStore } from '../vynuesStore';
import { dueSummary } from './today';

/**
 * The last logical day a reminder actually fired, kept out of the synced UI store
 * on purpose: "have I already been nudged today" is a fact about *this device*,
 * and syncing it would let one computer silence another's reminder.
 */
const FIRED_KEY = 'milestone-reminder-fired';

/** How often the schedule is re-checked. A minute is finer than any reminder time
 *  needs, and it costs one cheap comparison. */
const TICK_MS = 60_000;

/** Titles named in the notification body before it falls back to "and N more". */
const NAMED = 2;

const lastFired = (): string => {
  try { return localStorage.getItem(FIRED_KEY) ?? ''; } catch { return ''; }
};
const markFired = (day: string): void => {
  try { localStorage.setItem(FIRED_KEY, day); } catch { /* private mode — re-nudging is the lesser evil */ }
};

/** 'HH:MM' → minutes past midnight, or null when it isn't a valid time. */
export function parseTime(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Should a reminder fire right now?
 *
 * Pure, and exported, because every interesting case here is a clock case — the
 * hour rolling past, the day rolling over at 5am rather than midnight, a device
 * that was asleep at the appointed minute — and none of them are worth testing by
 * waiting for them to happen.
 *
 * Note the deliberate asymmetry: the *trigger* is "past this wall-clock time",
 * but the once-per-day key is the **logical** day. Between midnight and 5am you
 * are still inside yesterday as far as the app is concerned, so a 23:00 reminder
 * that fired at 23:05 must not fire again at 00:01.
 */
export function shouldFire(
  settings: { enabled: boolean; time: string },
  openCount: number,
  alreadyFiredDay: string,
  now: Date = new Date(),
): boolean {
  if (!settings.enabled) return false;
  if (openCount <= 0) return false;             // nothing to nag about
  const at = parseTime(settings.time);
  if (at === null) return false;
  if (now.getHours() * 60 + now.getMinutes() < at) return false;
  return dateKey(logicalDayStart(now)) !== alreadyFiredDay;
}

/** Body text for the nudge: the count, then a couple of the actual tasks. */
export function reminderBody(open: number, titles: string[]): string {
  const named = titles.slice(0, NAMED);
  if (!named.length) return `${open} still open today.`;
  const rest = open - named.length;
  return `${named.join(' · ')}${rest > 0 ? ` · and ${rest} more` : ''}`;
}

/** Show a notification through whichever mechanism this build has. */
async function notify(title: string, body: string): Promise<void> {
  const api = window.electronAPI?.notify;
  if (api) { await api(title, body); return; }
  // Browser build. Permission is requested when the setting is turned on, so a
  // denial here just means no reminders — never a prompt out of nowhere.
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  new Notification(title, { body, tag: 'milestone-daily' });
}

/** Ask for notification permission, if this build needs it and hasn't got it.
 *  Returns whether reminders can actually be shown. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (window.electronAPI?.notify) return true;   // desktop needs no permission
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

/** Today's open/total, read straight from the live stores. */
export const currentDue = () =>
  dueSummary(useQuestStore.getState(), useVynuesStore.getState());

/** Push the count to the desktop tray, so "3 left" is visible without opening
 *  anything. A no-op in the browser, which has no tray to push to. */
function updateTray(): void {
  const api = window.electronAPI?.tray;
  if (!api) return;
  const { enabled, keepInTray } = useUIStore.getState().reminders;
  void api.update({ count: currentDue().open, keepInTray: enabled && keepInTray });
}

let timer: ReturnType<typeof setInterval> | null = null;

/** One scheduler tick: nudge if it's time, and keep the tray honest either way. */
export async function tick(): Promise<void> {
  updateTray();
  const settings = useUIStore.getState().reminders;
  const { open, openTitles } = currentDue();
  if (!shouldFire(settings, open, lastFired())) return;
  // Marked *before* awaiting the notification: a failure to display must not
  // leave the door open for a second attempt a minute later.
  markFired(dateKey(logicalDayStart()));
  await notify(
    open === 1 ? '1 task still open today' : `${open} tasks still open today`,
    reminderBody(open, openTitles),
  );
}

/** Start the scheduler. Idempotent — calling it twice does not double-nudge. */
export function startReminders(): void {
  if (timer) return;
  void tick();
  timer = setInterval(() => { void tick(); }, TICK_MS);
  // The tray count is only interesting if it tracks the list; store edits are the
  // only thing that can change it between ticks.
  useQuestStore.subscribe(updateTray);
  useVynuesStore.subscribe(updateTray);
  useUIStore.subscribe(updateTray);
}

/** Send a reminder right now, whatever the schedule says — the "Send a test"
 *  button. Without it, verifying the setting means waiting until evening. */
export async function sendTestReminder(): Promise<{ ok: boolean; error?: string }> {
  if (!(await ensureNotificationPermission())) {
    return { ok: false, error: 'Notifications are blocked for this app in your system settings.' };
  }
  const { open, openTitles } = currentDue();
  await notify(
    open ? (open === 1 ? '1 task still open today' : `${open} tasks still open today`) : 'Milestone',
    open ? reminderBody(open, openTitles) : 'Nothing left today — this is what a reminder looks like.',
  );
  return { ok: true };
}
