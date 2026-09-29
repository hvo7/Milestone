import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import SettingsModal from '../components/SettingsModal';
import { useQuestStore } from '../store';

it('offers separate settings tabs, restores archived systems, and preserves data actions', async () => {
  const initial = useQuestStore.getState();
  useQuestStore.setState({ questlines: [], systems: [{ id: 'saved', title: 'Saved practice', hidden: true }] });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const onData = vi.fn(), onClose = vi.fn();
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!;
  try {
    await act(async () => root.render(createElement(SettingsModal, { notifications: 'Off', desktop: false, onData, onClose, onNotifications: vi.fn(), onNotion: vi.fn() })));
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('Notifications');
    expect(host.querySelector('[aria-label="Use dark mode"]')).toBeNull();
    await act(async () => button('Archive').click());
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe('Archive');
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('Saved practice');
    await act(async () => button('Restore').click());
    expect(useQuestStore.getState().systems[0].hidden).toBeFalsy();
    expect(host.textContent).toContain('No archived items yet');
    await act(async () => button('Data & connections').click());
    expect(button('Desktop only').disabled).toBe(true);
    await act(async () => button('Manage data').click());
    expect(onData).toHaveBeenCalledOnce();
    await act(async () => host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount()); host.remove(); useQuestStore.setState(initial);
  }
});
