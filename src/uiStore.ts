import { migrateLegacyStorage } from './lib/storageMigration';

export const QUEST_STORE_KEY = 'milestone-v1';
export const UI_STORE_KEY = 'milestone-ui';

// Migration must precede the first persist() call in either store.
migrateLegacyStorage();

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── UI state ──────────────────────────────────────────────────────────────────

/** Daily reminder settings. See lib/reminders.ts — the app is otherwise entirely
 *  passive, and a habit tracker you have to remember to open is one that only
 *  works on the days you didn't need it. */
export interface ReminderSettings {
  enabled: boolean;
  /** Local 'HH:MM' the nudge fires at, on days with something still open. */
  time: string;
  /** Desktop only: closing the window hides it to the tray instead of quitting,
   *  so the reminder can still arrive. Off by default — silently not-quitting
   *  when someone hits ✕ is exactly the kind of surprise an app shouldn't spring. */
  keepInTray: boolean;
}

export const DEFAULT_REMINDERS: ReminderSettings = { enabled: false, time: '19:00', keepInTray: false };

interface UIStore {
  editMode: boolean;
  theme: 'dark' | 'light';
  reminders: ReminderSettings;
  toggleEditMode: () => void;
  toggleTheme: () => void;
  setReminders: (patch: Partial<ReminderSettings>) => void;
}
export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      editMode: false,
      theme: 'light' as 'dark' | 'light',
      reminders: DEFAULT_REMINDERS,
      toggleEditMode: () => set(s => ({ editMode: !s.editMode })),
      toggleTheme: () => set(s => {
        const next = s.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        return { theme: next };
      }),
      // Merged over the defaults, not over `s.reminders` alone: a save written by
      // a build that predates a field would otherwise leave it undefined.
      setReminders: (patch) => set(s => ({ reminders: { ...DEFAULT_REMINDERS, ...s.reminders, ...patch } })),
    }),
    { name: UI_STORE_KEY }
  )
);
