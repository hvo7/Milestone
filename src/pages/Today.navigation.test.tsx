import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';
import { REFRESH_DAY_EVENT } from '../lib/dayClock';

const host = document.createElement('div');
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubEnv('MODE', 'testing');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })));
  window.location.hash = '#/';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const click = (el: HTMLElement) => act(() => el.click());
const navButton = (name: string) => host.querySelector<HTMLButtonElement>(`.nav-tools [aria-label="${name}"]`)!;
const labelButton = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === name)!;

it('navigates each visible tab from Today and returns through the Milestone wordmark', async () => {
  await Promise.all([import('./AllPage'), import('./SystemsPage'), import('./QuestsPage'), import('./SpacePage'), import('./StatusLifeVitalsPage')]);
  await act(async () => { root.render(<App />); });
  const tabs = [...host.querySelectorAll<HTMLAnchorElement>('.app-tabs a')].map(a => a.hash);
  expect(tabs).toContain('#/systems');
  for (const hash of tabs) {
    await act(async () => { host.querySelector<HTMLAnchorElement>(`.app-tabs a[href="${hash}"]`)!.click(); });
    expect(host.querySelector('.nav-link[aria-current="page"]')?.getAttribute('href')).toBe(hash);
    expect(host.querySelector('.page-shell')).toBeTruthy();
    await act(async () => { host.querySelector<HTMLAnchorElement>('.app-brand')!.click(); });
    await vi.waitFor(() => expect(host.querySelector('.agenda-inline h1')?.textContent).toBe('Today'));
  }
}, 20000);

it('operates theme, task refresh, space manager and Settings from the Today toolbar', async () => {
  await act(async () => { root.render(<App />); });
  const theme = navButton('Use dark mode') ? 'dark' : 'light';
  click(navButton(`Use ${theme} mode`));
  expect(document.documentElement.dataset.theme).toBe(theme);
  click(navButton(`Use ${theme === 'dark' ? 'light' : 'dark'} mode`));
  const refresh = vi.fn();
  window.addEventListener(REFRESH_DAY_EVENT, refresh, { once: true });
  const glyph = navButton('Reload tasks').querySelector('svg')!;
  Object.assign(glyph, { animate: vi.fn(), getAnimations: () => [] });
  click(navButton('Reload tasks'));
  expect(refresh).toHaveBeenCalledOnce();
  click(navButton('Add new tab'));
  expect(host.querySelector('[aria-label="Close manage spaces"]')).toBeTruthy();
  click(host.querySelector<HTMLButtonElement>('[aria-label="Close manage spaces"]')!);
  click(navButton('Settings'));
  for (const section of ['Archive', 'Data & connections', 'General']) {
    click(labelButton(section));
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(section);
  }
  await act(async () => { labelButton('Manage reminders').click(); await import('../components/RemindersModal'); });
  expect(host.textContent).toMatch(/reminder/i);
  const closeReminders = [...host.querySelectorAll('button')].find(b => /^(Close|Done|Cancel)$/i.test(b.textContent?.trim() ?? '') || b.title === 'Close');
  expect(closeReminders).toBeDefined();
  click(closeReminders!);
  click(navButton('Settings'));
  click(labelButton('Data & connections'));
  await act(async () => { labelButton('Manage data').click(); await import('../components/DataModal'); });
  click(labelButton('Close'));
  click(navButton('Settings'));
  click(host.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')!);
  expect(host.querySelector('.settings-dialog')).toBeNull();
});
