import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EXTENSION_ID } from './server.ts';
import { MODEL } from './classification.ts';

export const PRIVATE_DIR = fileURLToPath(new URL('../.private/', import.meta.url));
export const CONFIG_PATH = fileURLToPath(new URL('../.private/config.json', import.meta.url));
export const PAIRING_PATH = fileURLToPath(new URL('../.private/pairing-code.txt', import.meta.url));
export interface Config { apiKey: string; pairingToken: string; extensionId: string; model: string }

export async function loadConfig(): Promise<Config> {
  try {
    const value = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    if (typeof value.apiKey !== 'string' || value.apiKey.length < 12 || typeof value.pairingToken !== 'string'
      || !/^[A-Za-z0-9_-]{43,128}$/.test(value.pairingToken) || !/^[a-p]{32}$/.test(value.extensionId)
      || value.model !== MODEL) throw new Error();
    return value as Config;
  } catch { throw new Error('Dock helper is not configured. Run Setup-Dock-Helper.cmd first.'); }
}

export async function saveConfig(apiKey: string, extensionId = EXTENSION_ID): Promise<void> {
  if (apiKey.length < 12 || /[\s\x00-\x1f]/.test(apiKey)) throw new Error('The API key is invalid.');
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('The extension ID is invalid.');
  let pairingToken = randomBytes(32).toString('base64url');
  try {
    const existing = await loadConfig();
    if (existing.extensionId === extensionId) pairingToken = existing.pairingToken;
  } catch { /* First setup; use the newly generated pairing secret. */ }
  await mkdir(PRIVATE_DIR, { recursive: true, mode: 0o700 });
  const config = { apiKey, pairingToken, extensionId, model: MODEL };
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await writeFile(PAIRING_PATH, pairingToken, { mode: 0o600 });
}

// Parse only explicit API-key fields or Bearer examples in the one file the user chose.
export function extractApiKey(text: string): string {
  const patterns = [
    /(?:TYPESAFE_API_KEY|JEV_API_KEY)\s*[=:]\s*["']?([A-Za-z0-9._-]{12,})/gi,
    /["']?(?:api_key|apiKey)["']?\s*[=:]\s*["']([A-Za-z0-9._-]{12,})["']/gi,
    /Authorization\s*:\s*Bearer\s+([A-Za-z0-9._-]{12,})/gi,
  ];
  const matches = new Set(patterns.flatMap(pattern => [...text.matchAll(pattern)].map(match => match[1]))
    .filter(key => !/^(?:your|example|replace|placeholder|test)[_-]/i.test(key)));
  if (matches.size !== 1) throw new Error('The selected file must contain exactly one distinct Jev API key. Use interactive setup instead.');
  return [...matches][0];
}
