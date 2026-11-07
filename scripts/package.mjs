import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'dist/echo-menu-lyrics/manifest.json')));
for (const script of ['prepare-publish.mjs', 'check-package.mjs']) {
  const prepared = spawnSync(process.execPath, [path.join(root, 'scripts', script)], { cwd: root, stdio: 'inherit' });
  if (prepared.status !== 0) process.exit(prepared.status || 1);
}
const name = `echo-menu-lyrics-${manifest.version}-macos.zip`;
const result = spawnSync('ditto', ['-c', '-k', '--keepParent', 'echo-menu-lyrics', path.join(root, 'dist', name)], { cwd: path.join(root, 'packages'), stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
console.log(path.join(root, 'dist', name));
