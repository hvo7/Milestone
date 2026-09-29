import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import ArchivePanel from '../components/ArchivePanel';
import QuestlineAccordionItem from '../components/QuestlineAccordionItem';
import { useQuestStore, useUIStore } from '../store';
import type { Questline } from '../types';

const initial = useQuestStore.getState();
const ui = useUIStore.getState();
afterEach(() => { useQuestStore.setState(initial); useUIStore.setState(ui); });
const line: Questline = { id: 'line', title: 'Reading', description: '', icon: '', color: 'blue', quests: [{ id: 'quest', title: 'Finish a book', description: '', order: 1, actions: [] }] };

it('nests archived systems under their questline or quest, leaving standalone systems flat', async () => {
  useQuestStore.setState({ questlines: [line], systems: [
    { id: 'direct', title: 'Daily reading', hidden: true, questlineIds: ['line'] },
    { id: 'nested', title: 'Take notes', hidden: true, questIds: ['quest'] },
    { id: 'solo', title: 'Standalone', hidden: true },
  ] });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
  await act(async () => root.render(createElement(ArchivePanel)));
  expect(host.querySelectorAll('details')).toHaveLength(2);
  expect(host.querySelector('details > summary')?.textContent).toContain('Reading');
  expect(host.querySelector('details details')?.textContent).toContain('Take notes');
  const standalone = host.querySelector('[aria-label="Restore Standalone"]');
  expect(standalone?.closest('details')).toBeNull();
  expect(host.querySelectorAll('[aria-label="Restore Take notes"]')).toHaveLength(1);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('quest titles open editing without a pencil or an archive button on the row', async () => {
  useQuestStore.setState({ questlines: [line], systems: [], routines: [] });
  useUIStore.setState({ editMode: false });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), edit = vi.fn();
  try {
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(QuestlineAccordionItem, { questline: line, isOpen: true, onToggle: () => {}, detail: true, onEditQuest: edit }))));
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === 'Finish a book')!;
    expect(button).toBeDefined();
    expect(host.textContent).not.toContain('Archive');
    expect(host.textContent).not.toContain('✎');
    await act(async () => button.click());
    expect(edit).toHaveBeenCalledWith('line', line.quests[0]);
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Reading')!.click());
    expect(host.textContent).toContain('Edit Questline');
    expect(host.textContent).toContain('Archive questline');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
