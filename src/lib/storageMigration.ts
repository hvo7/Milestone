/**
 * localStorage key rename, 2026-07-13: the app was called rpg-quest-tracker before
 * it became Milestone, and its persisted stores were keyed off that name.
 *
 * The keys are the only handle on a user's data — a renamed store with no migration
 * reads an empty slot and the app comes up looking wiped, even though everything is
 * still sitting there under the old key. So on startup we copy any legacy value into
 * its new key.
 *
 * Copy, don't move: the old keys stay behind untouched, so rolling back to an older
 * build still finds its data. Idempotent, and never overwrites a new key that already
 * has a value — once Milestone has written anything, the legacy copy is history and
 * must not be allowed to clobber it.
 */
const LEGACY_KEYS: Record<string, string> = {
  'rpg-quest-tracker-v1': 'milestone-v1',
  'rpg-ui-state':         'milestone-ui',
  'vynues-v1':            'milestone-vynues-v1',
};

export function migrateLegacyStorage(): void {
  if (typeof localStorage === 'undefined') return;
  for (const [legacyKey, key] of Object.entries(LEGACY_KEYS)) {
    try {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy === null) continue;              // nothing to bring forward
      if (localStorage.getItem(key) !== null) continue;  // already migrated — leave it alone
      localStorage.setItem(key, legacy);
    } catch {
      // A quota or privacy-mode failure here must not take the app down with it:
      // the store just falls back to its initial state for that key.
    }
  }
}
