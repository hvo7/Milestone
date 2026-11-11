import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Read only the app's exported data slots, never its live profile or credentials.
export function refreshTestingSeed(backupDir, testingDir) {
  const candidates = fs.readdirSync(backupDir).filter(name => /^auto-.*\.json$/.test(name)).sort().reverse();
  for (const name of candidates) {
    let seed;
    try {
      const bundle = JSON.parse(fs.readFileSync(path.join(backupDir, name), 'utf8'));
      if (!bundle._milestone) continue;
      seed = {};
      for (const key of ['quest', 'vynues']) {
        if (bundle[key] == null) continue;
        const value = JSON.parse(bundle[key]);
        if (!value?.state || typeof value.state !== 'object' || Array.isArray(value.state)) throw new Error('Invalid state');
        seed[key] = bundle[key];
      }
      if (!seed.quest && !seed.vynues) continue;
      seed.exportedAt = bundle.exportedAt;
      seed.revision = crypto.createHash('sha256').update(JSON.stringify([seed.quest, seed.vynues])).digest('hex');
    } catch { continue; }
    fs.mkdirSync(testingDir, { recursive: true });
    const target = path.join(testingDir, 'seed.json');
    fs.writeFileSync(target + '.tmp', JSON.stringify(seed));
    fs.renameSync(target + '.tmp', target);
    return { name, exportedAt: seed.exportedAt };
  }
  throw new Error('No valid Milestone backup found');
}
