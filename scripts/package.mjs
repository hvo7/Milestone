/** Build a minimal desktop bundle, or patch the existing executable's app archive. */
import { cp, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPackage, extractFile, listPackage } from '@electron/asar';
import { packager } from '@electron/packager';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'release', 'Milestone-win32-x64');
const patch = process.argv.includes('--patch');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(await readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const scratch = await mkdtemp(path.join(os.tmpdir(), 'milestone-package-'));

try {
  const source = path.join(scratch, 'app');
  await mkdir(source);
  // Renderer dependencies are bundled by Vite. Electron uses only built-in modules.
  // Copy only runtime inputs, never release output, tests, source, or local notes.
  await cp(path.join(root, 'dist'), path.join(source, 'dist'), { recursive: true });
  await mkdir(path.join(source, 'electron'));
  for (const file of await readdir(path.join(root, 'electron'))) {
    if (file.endsWith('.cjs') && !file.includes('.test.') && !file.startsWith('testing')) {
      await copyFile(path.join(root, 'electron', file), path.join(source, 'electron', file));
    }
  }
  const metadata = Object.fromEntries(['name', 'version', 'main', 'type', 'repository'].map(key => [key, pkg[key]]));
  await writeFile(path.join(source, 'package.json'), JSON.stringify(metadata, null, 2));

  if (patch) {
    const runtime = (await readFile(path.join(target, 'version'), 'utf8')).trim();
    if (runtime !== electronVersion) throw new Error('Electron runtime changed. Run npm run package instead.');
    const archive = path.join(target, 'resources', 'app.asar');
    const installed = JSON.parse(extractFile(archive, 'package.json').toString());
    if (installed.version !== pkg.version) throw new Error('App version changed. Run npm run package to update executable metadata too.');
    const next = path.join(scratch, 'app.asar');
    await createPackage(source, next);
    for (const entry of ['electron/main.cjs', 'electron/preload.cjs', 'dist/index.html']) extractFile(next, entry);
    const backup = path.join(root, 'release', '.patch-backup');
    await mkdir(backup, { recursive: true });
    await copyFile(archive, path.join(backup, 'app.asar'));
    const pending = path.join(target, 'resources', 'app.next.asar');
    try {
      await copyFile(next, pending);
      await rename(pending, archive);
    } finally {
      await rm(pending, { force: true });
    }
    console.log(`Patched ${path.join(target, 'Milestone.exe')} (${listPackage(next).length} archive entries).`);
    console.log(`Previous archive: ${path.join(backup, 'app.asar')}`);
  } else {
    // Packager 20 accepts a local ZIP, not an unpacked electronDist directory.
    // Reuse the installed runtime so packaging works without a network download.
    if (process.platform !== 'win32') throw new Error('Full Windows packaging requires Windows.');
    const runtimeZip = path.join(scratch, `electron-v${electronVersion}-win32-x64.zip`);
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:MILESTONE_RUNTIME, $env:MILESTONE_ZIP, [IO.Compression.CompressionLevel]::Fastest, $false)"], {
      windowsHide: true, stdio: 'inherit',
      env: { ...process.env, MILESTONE_RUNTIME: path.join(root, 'node_modules/electron/dist'), MILESTONE_ZIP: runtimeZip },
    });
    const [built] = await packager({
      dir: source, name: 'Milestone', platform: 'win32', arch: 'x64',
      out: path.join(scratch, 'output'), asar: true, prune: false,
      electronVersion, electronZipDir: scratch, tmpdir: path.join(scratch, 'packager'),
      appVersion: pkg.version, win32metadata: { CompanyName: 'Milestone' }, icon: path.join(root, 'build/icon.ico'),
      extraResource: [path.join(root, 'build/icon.ico')],
    });
    // Preserve unrelated files in the user's release folder.
    await cp(built, target, { recursive: true, force: true });
    console.log(`Built ${path.join(target, 'Milestone.exe')}`);
  }
} finally {
  // Only this invocation's verified temporary directory may be removed recursively.
  const relative = path.relative(os.tmpdir(), scratch);
  if (!relative.startsWith('milestone-package-') || relative.includes(path.sep)) throw new Error('Unexpected staging directory');
  await rm(scratch, { recursive: true, force: true });
}
