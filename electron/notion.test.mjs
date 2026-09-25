import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const model = require('./notion-model.cjs');
const config = { apiKey: 'test-only', parentPageId: 'parent' };
const quest = (extra = {}) => ({ id: 'q', title: 'Read', actions: [], ...extra });

function harness(map, respond = () => ({})) {
  const calls = [];
  let saved = structuredClone(map);
  const context = {
    module: { exports: {} }, AbortSignal,
    setTimeout: fn => { fn(); return 0; },
    require: name => name === 'electron' ? { app: { getPath: () => '/test' } }
      : name === 'fs' ? { readFileSync: () => JSON.stringify(saved), writeFileSync: (_p, value) => { saved = JSON.parse(value); } }
      : name === './notion-model.cjs' ? model : require(name),
    fetch: async (url, opts) => {
      const call = { url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined };
      calls.push(call);
      const reply = respond(call) ?? {};
      return { ok: !reply.error, status: reply.error ? 400 : 200, headers: { get: () => null }, json: async () => reply.error ? { message: reply.error } : reply };
    },
  };
  vm.runInNewContext(readFileSync(require.resolve('./notion.cjs'), 'utf8'), context);
  return { api: context.module.exports, calls, saved: () => saved };
}
const mapping = (extra = {}) => ({ questlinesDbId: 'ql-db', questsDbId: 'q-db', routinesDbId: 'r-db', questlines: {}, quests: {}, routines: {}, ...extra });

describe('Notion accuracy and safety', () => {
  it('matches standalone, checklist and manual quest completion', () => {
    expect(model.questComplete(quest({ completed: true }))).toBe(true);
    expect(model.questComplete(quest({ actions: [{ completed: true }] }))).toBe(true);
    expect(model.questComplete(quest({ completionMode: 'manual', actions: [{ completed: true }] }))).toBe(false);
    expect(model.questComplete(quest({ completionMode: 'manual', completed: true, actions: [{ completed: false }] }))).toBe(true);
  });
  it('exports readable recurrence and optional dates without inventing a deadline', () => {
    expect(model.recurrence({})).toBe('Once');
    expect(model.recurrence({ intervalDays: 21 })).toBe('Every 21 days');
    expect(model.recurrence({ monthlyRule: { nth: -1, kind: 'fri', months: 2 } })).toBe('Last Friday · every 2 months');
    const details = model.taskDetails({ id: 'r', progress: 2, target: 5, unit: 'books' }, []);
    expect(details.Due.date).toBe(null);
    expect(details.Progress.rich_text[0].text.content).toBe('2 / 5 books');
  });
  it('chunks long text without losing content', () => {
    const input = 'a'.repeat(1899) + '📚'.repeat(2200);
    const chunks = model.richText(input);
    expect(chunks.every(c => c.text.content.length <= 2000)).toBe(true);
    expect(chunks.map(c => c.text.content).join('')).toBe(input);
  });
  it('never turns missing Done properties or archived pages into unchecked tasks', async () => {
    const h = harness(mapping({ routines: { a: 'a', b: 'b', c: 'c' } }), c => c.url.endsWith('/a') ? {} : c.url.endsWith('/b') ? { archived: true, properties: { Done: { checkbox: false } } } : { properties: { Done: { checkbox: true } } });
    const result = await h.api.pullFromNotion(config);
    expect(result.taskUpdates).toEqual([{ id: 'c', completed: true }]);
  });
  it('fails an import instead of returning partial changes after a read error', async () => {
    const h = harness(mapping({ routines: { a: 'a', b: 'b' } }), c => c.url.endsWith('/b') ? { error: 'Unavailable' } : { properties: { Done: { checkbox: true } } });
    await expect(h.api.pullFromNotion(config)).rejects.toThrow('No local changes applied');
  });
  it('archives the final removed task even when the export contains no tasks', async () => {
    const h = harness(mapping({ routines: { old: 'old-page' } }));
    await h.api.syncToNotion([], [], config);
    expect(h.calls.some(c => c.url.endsWith('/pages/old-page') && c.body.archived)).toBe(true);
    expect(h.saved().routines).toEqual({});
  });
  it('does not create duplicate pages on update failure', async () => {
    const h = harness(mapping({ questlines: { line: 'page' } }), c => c.url.endsWith('/pages/page') ? { error: 'Invalid property' } : {});
    await expect(h.api.syncToNotion([{ id: 'line', title: 'Line', quests: [] }], [], config)).rejects.toThrow('Invalid property');
    expect(h.calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });
  it('only clears the owned snapshot, preserving other Notion page blocks', async () => {
    const h = harness(mapping({ questlines: { line: 'line-page' }, quests: { q: 'q-page' }, contentBlocks: { q: 'owned' } }), c => c.method === 'GET' ? { results: [{ id: 'old-step' }], has_more: false } : {});
    await h.api.syncToNotion([{ id: 'line', title: 'Line', quests: [quest({ completed: true })] }], [], config);
    expect(h.calls.filter(c => c.method === 'GET').map(c => c.url)).toEqual(['https://api.notion.com/v1/blocks/owned/children']);
    expect(h.calls.find(c => c.url.endsWith('/pages/q-page')).body.properties.Status.select.name).toBe('Complete');
  });
  it('refuses to mix maps from different parent pages', async () => {
    const h = harness(mapping({ parentPageId: 'other' }));
    await expect(h.api.syncToNotion([], [], config)).rejects.toThrow('different Notion page');
    expect(h.calls).toHaveLength(0);
  });
});
