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
    };
  }
}
