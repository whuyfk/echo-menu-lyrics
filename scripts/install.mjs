import { cp, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'dist/echo-menu-lyrics');
const target = path.join(os.homedir(), 'Library/Application Support/echo-music/plugins/echo-menu-lyrics');
await stat(path.join(source, 'manifest.json'));
try {
  await stat(target);
  const backup = path.join(path.dirname(path.dirname(target)), 'plugin-backups', `echo-menu-lyrics-${Date.now()}`);
  await cp(target, backup, { recursive: true });
  console.log(`Backup: ${backup}`);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(path.dirname(target), { recursive: true });
await cp(source, target, { recursive: true });
console.log(`Installed: ${target}\n请在 EchoMusic 插件管理中刷新并启用「Mac 菜单栏歌词」。`);
