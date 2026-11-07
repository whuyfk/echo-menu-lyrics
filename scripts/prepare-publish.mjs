import { cp, mkdir, readFile, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'dist/echo-menu-lyrics');
const target = path.join(root, 'packages/echo-menu-lyrics');
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
const expected = JSON.parse(await readFile(path.join(root, 'plugin/manifest.json'), 'utf8'));
if (JSON.stringify(manifest) !== JSON.stringify(expected)) throw new Error('构建与源 manifest 不一致，请先构建');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const name of ['manifest.json', 'index.js', 'icon.svg', 'bin']) await cp(path.join(source, name), path.join(target, name), { recursive: true });
for (const name of ['README.md', 'LICENSE', 'CHANGELOG.md']) await cp(path.join(root, name), path.join(target, name));
await chmod(path.join(target, 'bin/EchoMenuLyrics.app/Contents/MacOS/EchoMenuLyrics'), 0o755);
console.log('Prepared packages/echo-menu-lyrics for repository ZIP installation');
