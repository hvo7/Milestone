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

test('checkpoints in the folder are listed newest first, read back, and pruned to the newest 30', () => {
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'milestone-checkpoints-'));
  const profile = path.join(root, 'profile');
  const folder = path.join(root, 'OneDrive', 'Milestone');
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(profile, 'sync-config.json'), JSON.stringify({ enabled: true, folder, deviceId: 'laptop', deviceName: 'Laptop' }));
  const sandbox = {
    module: { exports: {} },
    require: name => name === 'electron' ? { app: { getPath: () => profile } } : require(name),
    setTimeout, clearTimeout,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./cloudSync.cjs'), 'utf8'), sandbox);
  const sync = sandbox.module.exports;
  try {
    const dir = path.join(folder, 'backups');
    assert.equal(sync.writeBackup('Laptop-before-adopt.json', { _milestone: 2 }).ok, true);
    for (let i = 0; i < 32; i++) {
      const name = `checkpoint-${String(i).padStart(2, '0')}-v3.6.0-Laptop.json`;
      assert.equal(sync.writeBackup(name, { _milestone: 2, quest: String(i) }).ok, true);
      const at = new Date(Date.now() - (100 - i) * 60_000);
      fs.utimesSync(path.join(dir, name), at, at);
    }
    // One more write prunes against the timestamps set above.
    assert.equal(sync.writeBackup('checkpoint-32-v3.6.0-Laptop.json', { _milestone: 2, quest: '32' }).ok, true);
    const names = fs.readdirSync(dir);
    assert.equal(names.filter(name => name.startsWith('checkpoint-')).length, 30);
    assert.ok(names.includes('Laptop-before-adopt.json'), 'rescue copies are never pruned');
    assert.ok(!names.includes('checkpoint-00-v3.6.0-Laptop.json'));

    const listed = sync.readBackups();
    assert.equal(listed[0].name, 'checkpoint-32-v3.6.0-Laptop.json');
    // Parsed inside the module's own context, so compare by content.
    assert.equal(JSON.stringify(sync.readBackup('checkpoint-31-v3.6.0-Laptop.json')), JSON.stringify({ _milestone: 2, quest: '31' }));
    assert.equal(sync.readBackup('../sync-config.json'), null);
    assert.equal(sync.readBackup('missing.json'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
