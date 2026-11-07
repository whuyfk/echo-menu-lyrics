import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function computeSourceDigest(root) {
  const files = [
    'package.json',
    'plugin/manifest.json',
    'plugin/icon.svg',
    'scripts/build.mjs',
    'scripts/source-digest.mjs',
  ];
  for (const directory of ['plugin/src', 'plugin/ui', 'native']) {
    for (const name of (await readdir(path.join(root, directory))).sort()) {
      if (/\.(?:js|css|html|swift)$/.test(name)) files.push(path.posix.join(directory, name));
    }
  }
  const digest = createHash('sha256');
  for (const relative of files.sort()) {
    digest.update(relative.split(path.sep).join('/'));
    digest.update('\0');
    digest.update(await readFile(path.join(root, relative)));
    digest.update('\0');
  }
  return digest.digest('hex');
}
