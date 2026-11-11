/** Shared by HTTP and WebSocket handshakes; never included in synced task data. */
export function reserveSyncRequest(address: string) {
  const url = new URL(address, location.href);
  if (url.protocol === 'wss:') url.protocol = 'https:';
  if (url.protocol === 'ws:') url.protocol = 'http:';
  const origin = url.origin;
  const key = `milestone-request-budget:${origin}`;
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  let budget: { day: string; count: number; recent: number[] } = { day, count: 0, recent: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (saved?.day === day && Number.isFinite(saved.count) && Array.isArray(saved.recent)) budget = saved;
  } catch { /* Start a new accounting window if the saved record is corrupt. */ }
  budget.recent = budget.recent.filter(time => time > now - 60_000);
  if (budget.count >= 8000) throw new Error('Sync paused to protect the free daily allowance. Resumes at midnight UTC; edits remain saved on this device.');
  if (budget.recent.length >= 30) throw new Error('Sync is slowing down to protect the free allowance. Saved changes will retry automatically.');
  budget.count++;
  budget.recent.push(now);
  localStorage.setItem(key, JSON.stringify(budget));
}
