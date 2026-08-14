import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(process.cwd());
const stage = join(root, '.desktop-app');
if (dirname(stage) !== root || basename(stage) !== '.desktop-app') {
  throw new Error('Refusing to stage the desktop app outside the project-owned build directory.');
}

const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const electronVersion = String(metadata.devDependencies?.electron ?? '').replace(/^[^0-9]*/, '');
if (!/^\d+\.\d+\.\d+/.test(electronVersion)) throw new Error('The Electron version is unavailable for desktop packaging.');
for (const directory of ['dist-electron', 'out']) {
  const information = await stat(join(root, directory));
  if (!information.isDirectory()) throw new Error(`Run the desktop build before staging: ${directory} is unavailable.`);
}

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await Promise.all([
  cp(join(root, 'dist-electron'), join(stage, 'dist-electron'), { recursive: true }),
  cp(join(root, 'out'), join(stage, 'out'), { recursive: true })
]);
await writeFile(join(stage, 'package.json'), `${JSON.stringify({
  name: 'reviewflow-desktop',
  version: metadata.version,
  description: metadata.description,
  author: metadata.author,
  license: metadata.license,
  private: true,
  main: 'dist-electron/main.js',
  build: {
    appId: 'dev.coreyhayward.reviewflow',
    productName: 'ReviewFlow',
    electronVersion,
    asar: true,
    npmRebuild: false,
    directories: {
      output: '../release',
      buildResources: '../desktop/assets'
    },
    files: [
      'dist-electron/**/*',
      'out/**/*',
      'package.json'
    ],
    mac: {
      category: 'public.app-category.developer-tools',
      icon: '../desktop/assets/icon.png',
      identity: null,
      target: [{ target: 'dir', arch: ['arm64'] }]
    },
    artifactName: 'ReviewFlow-${version}-${arch}.${ext}'
  }
}, null, 2)}\n`, 'utf8');
