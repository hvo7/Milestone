import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const restartOntoUpdate = vi.fn<(target: string | null) => Promise<void>>();
vi.mock('../lib/updateCheckpoint', () => ({ restartOntoUpdate: (target: string | null) => restartOntoUpdate(target) }));

const { default: UpdateCard } = await import('./UpdateCard');
const { useAppUpdate } = await import('../lib/appUpdate');

const host = document.createElement('div');
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); delete window.electronAPI; restartOntoUpdate.mockReset(); });

const button = () => host.querySelector('button')!;

it('desktop: "Restart now" saves a checkpoint for the downloaded version before restarting', async () => {
  let finish!: () => void;
  restartOntoUpdate.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { update: {
    status: async () => ({ phase: 'staged', supported: true, stagedVersion: '3.6.1' }),
    onStatus: () => () => {}, check: vi.fn(), apply: vi.fn(),
  } } });
  await act(async () => root.render(<UpdateCard />));
  expect(host.textContent).toContain('A checkpoint of your synced data is saved first.');
  expect(button().textContent).toBe('Restart now');
  await act(async () => button().click());
  expect(restartOntoUpdate).toHaveBeenCalledWith('3.6.1');
  expect(button().textContent).toBe('Saving a checkpoint…');
  expect(button().disabled).toBe(true);
  finish();
});

it('phone and web: the reload button says when it is saving a checkpoint', async () => {
  useAppUpdate.setState({ supported: true, ready: true, nextVersion: '3.6.1', saving: true });
  await act(async () => root.render(<UpdateCard />));
  expect(button().textContent).toBe('Saving a checkpoint…');
  expect(button().disabled).toBe(true);
  act(() => useAppUpdate.setState({ saving: false }));
  expect(button().textContent).toBe('Reload onto the new version');
});
