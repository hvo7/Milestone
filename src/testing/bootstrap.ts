// Imported before the stores so the first hydration reads the test copy.
if (import.meta.env.MODE === 'testing') {
  document.title = 'Milestone — TESTING · Batch 015';
  const seed = window.milestoneTesting?.seed;
  if (seed?.revision && localStorage.getItem('milestone-testing-source-revision') !== seed.revision) {
    try {
      const entries = [['milestone-v1', seed.quest], ['milestone-vynues-v1', seed.vynues]] as const;
      // Validate all slots before replacing anything. Keep the previous test state recoverable.
      for (const [, value] of entries) {
        if (value !== undefined && !JSON.parse(value)?.state) throw new Error('Invalid testing snapshot');
      }
      localStorage.setItem('milestone-testing-before-refresh', JSON.stringify({
        savedAt: new Date().toISOString(),
        quest: localStorage.getItem('milestone-v1'),
        vynues: localStorage.getItem('milestone-vynues-v1'),
      }));
      for (const [key, value] of entries) {
        if (value !== undefined) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      }
      localStorage.setItem('milestone-testing-source-revision', seed.revision);
      localStorage.setItem('milestone-testing-seeded-v2', '1');
    } catch (error) { console.warn('Testing snapshot could not be applied', error); }
  }
  if (!localStorage.getItem('milestone-testing-seeded-v2') && seed) {
    for (const [key, value] of [['milestone-v1', seed.quest], ['milestone-vynues-v1', seed.vynues]]) {
      if (typeof value === 'string' && typeof key === 'string') {
        const current = JSON.parse(localStorage.getItem(key) ?? '{}').state;
        if (current && (current.questlines?.length || current.routines?.length || current.projects?.length)) continue;
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed.state === 'object') localStorage.setItem(key, value);
      }
    }
    localStorage.setItem('milestone-testing-seeded-v2', '1');
  }
}
export {};
