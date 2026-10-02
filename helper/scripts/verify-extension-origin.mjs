import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { createHelperServer, PORT } from '../src/server.ts';
import { NO_MATCH } from '../src/classification.ts';

// Synthetic browser verification. No Gmail account, real email, or Jev key is involved.
const identity = JSON.parse(await readFile(new URL('../../extension-identity.json', import.meta.url), 'utf8'));
const extensionPath = await mkdtemp(path.join(tmpdir(), 'dock-origin-extension-'));
const profile = await mkdtemp(path.join(tmpdir(), 'dock-origin-profile-'));
const token = 'f'.repeat(43);
const observations = [];
let calls = 0;
await writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'Dock synthetic helper verification', version: '1.0.0', key: identity.key,
  background: { service_worker: 'background.js' }, host_permissions: [`http://127.0.0.1:${PORT}/*`],
}));
await writeFile(path.join(extensionPath, 'background.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
const server = createHelperServer({ pairingToken: token, classify: async () => {
  calls++;
  return { categoryId: 'shipping', model: 'jev-fixture', answer: { type: 'choice', choice: 'shipping', confidence: 0.9, probabilities: { shipping: 0.98, [NO_MATCH]: 0.02 } }, usage: { input_tokens: 100, output_tokens: 20 } };
} });
server.on('request', req => observations.push({ method: req.method, path: req.url, origin: req.headers.origin ?? '<absent>' }));
server.listen(PORT, '127.0.0.1');
await once(server, 'listening');
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_EXECUTABLE ?? 'C:\\Users\\Jonat\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  assert.equal(new URL(worker.url()).hostname, identity.extensionId);
  const result = await worker.evaluate(async ({ token, port }) => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const health = await fetch(`http://127.0.0.1:${port}/health`, { method: 'POST', headers, body: '{}' });
    const classification = await fetch(`http://127.0.0.1:${port}/classify`, { method: 'POST', headers, body: JSON.stringify({ message: { sender: 'test@example.test', subject: 'Shipment', body: 'Your order shipped.' }, categories: [{ id: 'shipping', title: 'Shipping', description: 'Shipment updates.' }] }) });
    return { health: health.status, classification: classification.status, result: await classification.json() };
  }, { token, port: PORT });
  console.log(JSON.stringify({ result, observations, modelCalls: calls }, null, 2));
  assert.equal(result.health, 200);
  assert.equal(result.classification, 200);
  assert.equal(calls, 1);
} finally {
  await context?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
