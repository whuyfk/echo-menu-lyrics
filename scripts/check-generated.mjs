import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const status = spawnSync(
  'git',
  ['status', '--porcelain=v1', '--untracked-files=all', '--', 'packages/echo-menu-lyrics'],
  { cwd: root, encoding: 'utf8' },
);

if (status.error) throw status.error;
if (status.status !== 0) {
  process.stderr.write(status.stderr);
  process.exit(status.status || 1);
}

const changes = status.stdout.trim();
if (changes) {
  console.error('Generated installable package differs from Git:');
  console.error(changes);
  console.error('Run `npm run package` and commit the complete packages/echo-menu-lyrics directory.');
  process.exit(1);
}

console.log('PASS: rebuilt installable package is identical to the committed package');
