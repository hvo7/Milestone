export {};

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      notion: {
        loadConfig:     () => Promise<{ apiKey: string; parentPageId: string } | null>;
        saveConfig:     (config: { apiKey: string; parentPageId: string }) => Promise<void>;
        testConnection: (apiKey: string) => Promise<{ ok: boolean; name?: string; error?: string }>;
        sync:           (data: { questlines: unknown[]; routines: unknown[] }) => Promise<{ ok: boolean; log?: string[]; error?: string }>;
        pull:           () => Promise<{ ok: boolean; log?: string[]; error?: string; taskUpdates?: { id: string; completed: boolean }[]; questUpdates?: { questId: string; complete: boolean }[] }>;
      };
      /** Cross-computer sync over a cloud-synced folder — see src/lib/cloudSync.ts. */
      sync: {
        getConfig:   () => Promise<{ enabled: boolean; folder: string; deviceId: string; deviceName: string }>;
        setConfig:   (patch: { enabled?: boolean; folder?: string }) => Promise<{ enabled: boolean; folder: string; deviceId: string; deviceName: string }>;
        /** Opens the folder picker; null if the user cancelled. */
        pickFolder:  () => Promise<string | null>;
        readPeers:   () => Promise<{ ok: boolean; peers?: unknown[]; unreadable?: number; error?: string }>;
        write:       (doc: unknown) => Promise<{ ok: boolean; at?: string; error?: string }>;
        writeBackup: (name: string, bundle: unknown) => Promise<{ ok: boolean; path?: string; error?: string }>;
        /** Returns an unsubscribe function. */
        onChanged:   (callback: () => void) => () => void;
      };
      /** Serving the app to a phone on this Wi-Fi — see electron/phone.cjs. */
      phone: {
        status:  () => Promise<PhoneStatus>;
        start:   () => Promise<{ ok: boolean; error?: string; status: PhoneStatus }>;
        stop:    () => Promise<{ ok: boolean; status: PhoneStatus }>;
        setPort: (port: number) => Promise<{ ok: boolean; status: PhoneStatus }>;
      };
      /** Rolling on-disk snapshots of the stores — see electron/backups.cjs. */
      backup: {
        save:   (bundle: unknown) => Promise<{ ok: boolean; name?: string; at?: string; skipped?: string; error?: string }>;
        list:   () => Promise<AutoBackup[]>;
        read:   (name: string) => Promise<{ ok: boolean; bundle?: MilestoneBundle; error?: string }>;
        reveal: () => Promise<string>;
      };
      /** Desktop notification — see electron/tray.cjs and src/lib/reminders.ts. */
      notify: (title: string, body: string) => Promise<{ ok: boolean; error?: string }>;
      tray: {
        update: (state: { count: number; keepInTray: boolean }) => Promise<{ ok: boolean; error?: string }>;
      };
    };
  }

  /** The phone bridge's state: whether this computer is currently serving the
   *  app on the network, and the address to open there. */
  interface PhoneStatus {
    available: boolean;
    enabled: boolean;
    port: number;
    token: string;
    /** One per network this computer is on, token included. */
    urls: string[];
    /** False in `electron:dev`, where there is no build on disk to serve. */
    built: boolean;
  }

  /** One automatic snapshot, as listed for the restore picker. */
  interface AutoBackup {
    name: string;
    savedAt: string;
    bytes: number;
    questlines: number;
    routines: number;
  }

  /** The export/backup file format shared by the Data panel, the sync layer's
   *  rescue copies, and the automatic snapshots. */
  interface MilestoneBundle {
    _milestone: number;
    appVersion?: string;
    exportedAt?: string;
    quest?: string;
    vynues?: string;
  }
}
