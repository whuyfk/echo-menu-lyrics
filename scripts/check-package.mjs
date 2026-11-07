import assert from 'node:assert/strict';
import { readFile, stat, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(await readFile(path.join(root, 'echo-plugins.json'), 'utf8'));
const entry = registry.plugins.find(value => value.id === 'echo-menu-lyrics');
assert.ok(entry); assert.equal(entry.repo, 'https://github.com/whuyfk/echo-menu-lyrics');
const directory = path.join(root, entry.path);
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
const source = JSON.parse(await readFile(path.join(root, 'plugin/manifest.json'), 'utf8'));
assert.deepEqual(manifest, source); assert.equal(manifest.id, entry.id);
assert.equal(manifest.version, JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version);
const files = await readdir(directory);
assert.deepEqual(files.sort(), ['CHANGELOG.md', 'LICENSE', 'README.md', 'bin', 'icon.svg', 'index.js', 'manifest.json'].sort());
const script = path.join(directory, manifest.main);
const syntax = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr);
const executable = path.join(directory, 'bin/EchoMenuLyrics.app/Contents/MacOS/EchoMenuLyrics');
assert.ok((await stat(executable)).mode & 0o111, '原生程序需要执行权限');
if (process.platform === 'darwin') {
  const arch = spawnSync('lipo', ['-archs', executable], { encoding: 'utf8' });
  assert.equal(arch.status, 0); assert.match(arch.stdout, /arm64/); assert.match(arch.stdout, /x86_64/);
  const signature = spawnSync('codesign', ['--verify', '--deep', '--strict', path.join(directory, 'bin/EchoMenuLyrics.app')], { encoding: 'utf8' });
  assert.equal(signature.status, 0, signature.stderr);
}
console.log('PASS: registry path, manifest, entry syntax, universal executable, permissions and package contents');
