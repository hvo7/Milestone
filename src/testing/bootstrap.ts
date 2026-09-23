// Imported before the stores so the first hydration reads the test copy.
if (import.meta.env.MODE === 'testing') {
  document.title = 'Milestone — TESTING · Batch 002';
  const seed = window.milestoneTesting?.seed;
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
