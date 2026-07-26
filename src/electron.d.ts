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
    };
  }
}
