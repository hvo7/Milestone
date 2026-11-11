import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('isolated relay delivers desktop/mobile pushes both ways and retains offline changes', { timeout: 15000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'milestone-sync-test-'));
  process.env.MILESTONE_TOKEN = 'synthetic-test-only';
  process.env.MILESTONE_DATA = dir;
  process.env.MILESTONE_DIST = path.join(dir, 'no-app');
  process.env.PORT = '0';
  const { server } = await import('./relay.mjs');
  if (!server.listening) await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const controllers = [];
  t.after(async () => {
    controllers.forEach(c => c.abort());
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const name of await readdir(dir)) await unlink(path.join(dir, name));
    await rmdir(dir);
  });
  const url = route => `${base}/api/${route}${route.includes('?') ? '&' : '?'}t=synthetic-test-only`;
  const watch = async deviceId => {
    const controller = new AbortController(); controllers.push(controller);
    const res = await fetch(url(`events?deviceId=${deviceId}`), { signal: controller.signal });
    const reader = res.body.getReader();
    return async () => {
      let text = '';
      while (!text.includes('event: changed')) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        text += new TextDecoder().decode(chunk.value);
      }
      return text;
    };
  };
  const write = async (deviceId, title) => {
    const result = await fetch(url('write'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _milestoneSync: 1, deviceId, deviceName: deviceId, updatedAt: new Date().toISOString(),
        clock: { [deviceId]: 1 }, stores: { quest: JSON.stringify({ state: { title } }) } }) });
    assert.equal((await result.json()).ok, true);
  };
  const phoneChanged = await watch('phone');
  const desktopChanged = await watch('desktop');
  await write('desktop', 'Desktop edit');
  assert.match(await phoneChanged(), /desktop/);
  await write('phone', 'Phone edit');
  assert.match(await desktopChanged(), /phone/);
  const mobile = await (await fetch(url('peers?deviceId=phone'))).json();
  assert.equal(mobile.peers.length, 1);
  assert.match(mobile.peers[0].stores.quest, /Desktop edit/);
  controllers.forEach(c => c.abort());
  await write('desktop', 'Edited while mobile offline');
  const recovered = await (await fetch(url('peers?deviceId=phone'))).json();
  assert.match(recovered.peers[0].stores.quest, /mobile offline/);
  assert.equal((await fetch(`${base}/api/peers?t=wrong`)).status, 401);
});
