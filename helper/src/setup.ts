import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { extractApiKey, PAIRING_PATH, saveConfig } from './config.ts';

async function readSecret(): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal or provide --key-file followed by the examples file path.');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
  const reader = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write('Paste the Jev API key (hidden): ');
  muted = true;
  const key = await reader.question('');
  reader.close();
  process.stdout.write('\n');
  return key.trim();
}
try {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--key-file');
  const key = fileIndex >= 0 && args[fileIndex + 1]
    ? extractApiKey(await readFile(args[fileIndex + 1], 'utf8'))
    : process.env.TYPESAFE_API_KEY?.trim() || await readSecret();
  await saveConfig(key);
  console.log('Dock helper configured. The Jev API key was saved only to .private/config.json.');
  console.log(`Pairing code file: ${PAIRING_PATH}`);
  console.log('Copy that file’s contents into Dock settings, then run Start-Dock-Helper.cmd.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Setup failed. No API key was displayed.');
  process.exitCode = 1;
}
