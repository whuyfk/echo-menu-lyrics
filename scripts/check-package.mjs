import assert from 'node:assert/strict';
import { readFile, stat, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSourceDigest } from './source-digest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDigest = await computeSourceDigest(root);
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
  const committedInfo = spawnSync('plutil', ['-extract', 'EchoMenuLyricsSourceDigest', 'raw', path.join(directory, 'bin/EchoMenuLyrics.app/Contents/Info.plist')], { encoding: 'utf8' });
  assert.equal(committedInfo.status, 0, committedInfo.stderr);
  assert.equal(committedInfo.stdout.trim(), sourceDigest, 'installation Info.plist was built from different sources');
  const buildInfo = spawnSync(executable, ['--build-info'], { encoding: 'utf8' });
  assert.equal(buildInfo.status, 0, buildInfo.stderr);
  assert.deepEqual(JSON.parse(buildInfo.stdout), { sourceDigest, version: manifest.version });
}
console.log('PASS: registry path, manifest, entry syntax, universal executable, permissions and package contents');
