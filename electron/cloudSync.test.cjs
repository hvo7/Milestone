const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('folder watcher ignores own snapshots and temporary files but observes peers', () => {
  let event, scheduled = null, notified = 0;
  const fakeFs = {
    readFileSync: () => JSON.stringify({ enabled: true, folder: 'synthetic', deviceId: 'desktop', deviceName: 'Desktop' }),
    watch: (_folder, listener) => { event = listener; return { close() {}, on() {} }; },
  };
  const sandbox = {
    module: { exports: {} },
    require: name => name === 'electron' ? { app: { getPath: () => 'synthetic' } } : name === 'fs' ? fakeFs : require(name),
    setTimeout: fn => { scheduled = fn; return 1; },
    clearTimeout: () => { scheduled = null; },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./cloudSync.cjs'), 'utf8'), sandbox);
  sandbox.module.exports.initWatcher(() => notified++);
  event('rename', 'desktop.milestone-sync.json');
  event('rename', 'desktop.milestone-sync.json.tmp');
  event('rename', 'backups');
  assert.equal(scheduled, null);
  event('rename', 'laptop.milestone-sync.json');
  assert.equal(typeof scheduled, 'function');
  scheduled();
  assert.equal(notified, 1);
});
