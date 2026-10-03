import { expect } from '@playwright/test';

export async function seedStoredState(context, page, update, value) {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(update, value);
  // 1. Seed only this isolated profile's extension storage.
  // 2. Stop its worker so the next UI request reads the seed into a fresh cache.
  const session = await context.newCDPSession(page);
  let stopped = false;
  session.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    if (versions.some(version => version.scriptURL === worker.url() && version.runningStatus === 'stopped')) stopped = true;
  });
  try {
    await session.send('ServiceWorker.enable');
    await session.send('ServiceWorker.stopAllWorkers');
    // Playwright keeps the Worker object when Chrome restarts the same target.
    await expect.poll(() => stopped).toBe(true);
  } finally { await session.detach(); }
}
