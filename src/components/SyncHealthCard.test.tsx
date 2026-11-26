import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SyncHealthCard from './SyncHealthCard';
import { useSyncStatus } from '../lib/cloudSync';
import { useSyncIssues, type SyncIssue } from '../lib/syncIssues';
import { resetSafetyForTests, saveSafetySnapshot, isSyncPaused, setSyncPausedFlag } from '../lib/syncSafety';

const host = document.createElement('div');
let root: ReturnType<typeof createRoot>;
const issue = (over: Partial<SyncIssue>): SyncIssue => ({ id: Math.random().toString(36), kind: 'edit', slot: 'quest', path: '/questlines/a',
  label: 'Learn Korean', keptFrom: 'Phone', lostFrom: 'Laptop', lost: '{"id":"a","title":"Korean"}', parent: '/questlines', field: null,
  at: '2026-11-26T00:00:00.000Z', status: 'open', ...over });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear(); resetSafetyForTests(); setSyncPausedFlag(false);
  document.body.append(host);
  root = createRoot(host);
  useSyncStatus.setState({ available: true, enabled: true, linked: true, paused: false, pending: false, error: null, busy: false,
    peers: [
      { deviceName: 'Laptop', updatedAt: new Date(Date.now() - 6 * 86_400_000).toISOString(), appVersion: '3.4.1', legacy: true, waiting: 12 },
      { deviceName: 'Phone', updatedAt: new Date().toISOString(), appVersion: '3.5.0', legacy: false, waiting: 0 },
    ] });
  useSyncIssues.setState({ issues: [
    issue({ id: 'e' }),
    issue({ id: 'd', kind: 'delete', label: 'Gym', keptFrom: 'Phone', lostFrom: 'Laptop', lost: null }),
    issue({ id: 'closed', status: 'dismissed', label: 'Old one' }),
  ] });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const button = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === name)!;
const render = () => act(() => root.render(<SyncHealthCard />));

it('lists what needs review, each device\'s state, and only open issues', () => {
  render();
  expect(host.querySelector('[role="status"]')!.textContent).toBe('2 to review');
  const text = host.textContent!;
  expect(text).toContain('“Learn Korean”');
  expect(text).toContain('Changed on Laptop and Phone at the same time. Using Phone\'s.');
  expect(text).toContain('Deleted on Laptop while it was changed on Phone, so it was kept.');
  expect(text).not.toContain('Old one');
  expect(button('Use Laptop\'s')).toBeTruthy();
  expect(button('Delete it')).toBeTruthy();
  expect(text).toContain('12 waiting');
  expect(text).toContain('Update needed');
  expect(text).toContain('6 days ago');
  expect(text).toContain('Laptop runs an older version of Milestone. Until it updates, its copy can add items here but cannot delete or undo changes made on this device.');
});

it('closes an issue on Keep', () => {
  render();
  act(() => button('Keep').click());
  expect(useSyncIssues.getState().issues.find(i => i.id === 'e')!.status).toBe('dismissed');
  expect(host.querySelector('[role="status"]')!.textContent).toBe('1 to review');
});

it('pauses and resumes', async () => {
  useSyncIssues.setState({ issues: [] });
  render();
  await act(async () => button('Pause sync').click());
  expect(isSyncPaused()).toBe(true);
  expect(host.querySelector('[role="status"]')!.textContent).toBe('Paused');
  expect(host.textContent).toContain('Sync is paused.');
  await act(async () => button('Resume sync').click());
  expect(isSyncPaused()).toBe(false);
});

it('offers safety copies in recovery and lists what each would bring back', async () => {
  useSyncIssues.setState({ issues: [] });
  await saveSafetySnapshot('Before taking changes from Phone', { quest: JSON.stringify({ state: { questlines: [{ id: 'x', title: 'Lost questline', quests: [] }], routines: [] }, version: 0 }) });
  render();
  await act(async () => button('Recover items').click());
  const select = host.querySelector<HTMLSelectElement>('#sh-source')!;
  const option = [...select.options].find(o => o.textContent!.startsWith('Before taking changes from Phone'))!;
  expect(option).toBeTruthy();
  await act(async () => {
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  expect(host.textContent).toContain('Not on this device (1)');
  expect(host.textContent).toContain('Lost questline');
  expect(button('Bring back selected')).toBeTruthy();
  // The destructive choices ask first.
  await act(async () => button('Replace with this copy…').click());
  expect(host.textContent).toContain('Changes made since will be removed on every device.');
  await act(async () => button('Cancel').click());
  await act(async () => button('Use this device\'s data everywhere…').click());
  expect(button('Use everywhere')).toBeTruthy();
});

it('says when this device is not connected', () => {
  useSyncStatus.setState({ enabled: false, peers: [] });
  useSyncIssues.setState({ issues: [] });
  render();
  expect(host.querySelector('[role="status"]')!.textContent).toBe('Not connected');
});

it('stays out of the way on a device that does not sync and has nothing to review', () => {
  useSyncStatus.setState({ available: false });
  useSyncIssues.setState({ issues: [] });
  render();
  expect(host.textContent).toBe('');
});
