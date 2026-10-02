import { readFile, writeFile, mkdir, cp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createZip } from '@aklinker1/zero-zip';

const project = process.cwd();
const built = path.join(project, '.output/chrome-mv3');
const output = path.resolve(project, 'outputs');
await mkdir(output, { recursive: true });
const excluded = new Set(['node_modules', '.output', '.wxt', 'test-results', 'playwright-report', '.git', '.private', '.local', 'private', 'dist']);
const allowed = p => !p.split(/[\\/]/).some(part => excluded.has(part) || /^\.env(?:\.|$)/.test(part) || /\.(?:pem|key)$/i.test(part));
async function files(root, sub = '') {
  const entries = await readdir(path.join(root, sub), { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const name = path.join(sub, entry.name);
    if (!allowed(name) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) found.push(...await files(root, name));
    else if (entry.isFile()) found.push(name);
  }
  return found.sort();
}
// Rebuild only these named generated output directories, preserving all source.
async function resetOutput(name) {
  const target = path.resolve(output, name);
  if (path.dirname(target) !== output || !['dock-extension', 'dock-helper'].includes(name)) throw new Error('Unsafe output path');
  if (name === 'dock-helper') {
    // A user may have configured the delivered helper. Preserve local credentials on rebuild.
    let entries = [];
    try { entries = await readdir(target, { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const entry of entries) {
      if (entry.name === '.private' || entry.name === 'node_modules') continue;
      const child = path.resolve(target, entry.name);
      if (path.dirname(child) !== target) throw new Error('Unsafe generated helper path');
      await rm(child, { recursive: true, force: true });
    }
  } else await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  return target;
}
const extension = await resetOutput('dock-extension');
await cp(built, extension, { recursive: true });
const helper = await resetOutput('dock-helper');
for (const name of await files(path.join(project, 'helper'))) {
  await mkdir(path.dirname(path.join(helper, name)), { recursive: true });
  await cp(path.join(project, 'helper', name), path.join(helper, name));
}
let html = await readFile(path.join(built, 'preview.html'), 'utf8');
for (const match of [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)]) {
  const js = await readFile(path.join(built, match[1].replace(/^\//, '')), 'utf8');
  html = html.replace(match[0], () => `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`);
}
for (const match of [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g)]) {
  const css = await readFile(path.join(built, match[1].replace(/^\//, '')), 'utf8');
  html = html.replace(match[0], () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
}
await writeFile(path.join(output, 'Dock-preview.html'), html);
await cp(path.join(project, 'README.md'), path.join(output, 'INSTALL.md'));
await cp(path.join(project, 'VERIFICATION.md'), path.join(output, 'VERIFICATION.md'));
const checksums = [];
async function zip(root, names, filename) {
  const zip = createZip();
  for (const relative of names) {
    zip.addFile(relative.replaceAll('\\', '/'), await readFile(path.join(root, relative)));
  }
  const archive = await zip.toBuffer();
  await writeFile(path.join(output, filename), archive);
  checksums.push({ name: filename, files: names.length, sha256: createHash('sha256').update(archive).digest('hex') });
}
const extensionFiles = await files(extension);
const helperFiles = await files(helper);
await zip(extension, extensionFiles, 'Dock-extension.zip');
await zip(helper, helperFiles, 'Dock-helper.zip');
const sourceRoots = ['entrypoints', 'src', 'public', 'scripts', 'helper', 'docs'];
const sources = ['package.json', 'package-lock.json', 'wxt.config.ts', 'tsconfig.json', 'extension-identity.json', 'README.md', 'VERIFICATION.md', '.gitignore'];
for (const root of sourceRoots) sources.push(...(await files(path.join(project, root))).map(p => path.join(root, p)));
await zip(project, sources, 'Dock-source.zip');
await writeFile(path.join(output, 'checksums.json'), JSON.stringify(checksums, null, 2) + '\n');
await writeFile(path.join(output, 'package-manifest.json'), JSON.stringify({ version: JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8')).version, sourceFiles: sources, extensionFiles, helperFiles }, null, 2));
console.log('Packaged extension, helper, source ZIPs and standalone preview. Private configuration excluded.');
