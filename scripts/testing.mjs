import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
for (const args of [
  ['node_modules/typescript/bin/tsc', '-b'],
  ['node_modules/vite/bin/vite.js', 'build', '--mode', 'testing', '--outDir', 'dist-testing'],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const attached = process.argv.includes('--attached');
const child = spawn(require('electron'), [path.join(root, 'electron/testing.cjs')], {
  cwd: root, env, detached: !attached, stdio: attached ? 'inherit' : 'ignore', windowsHide: false,
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
if (!attached) child.unref();
console.log('Opening Milestone Testing. Production has not been updated.');
