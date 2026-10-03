import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// 1. Use synthetic run data and intercept every browser request.
// 2. View saved failures without starting or resuming categorization.
// 3. Preserve each full error, account link, and accessible dismissal path.
const project = process.cwd();
const directory = path.join(project, 'test-results', 'error-dropdown');
await mkdir(directory, { recursive: true });
await build({ configFile: false, root: project, plugins: [react()], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warn', build: { outDir: directory, emptyOutDir: false, lib: { entry: path.join(project, 'scripts/ui-fixture.tsx'), name: 'DockErrorFixture', formats: ['iife'], fileName: () => 'fixture.js' } } });
const js = (await readFile(path.join(directory, 'fixture.js'), 'utf8')).replace(/<\/script/gi, '<\\/script');
const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dock error fixture</title></head><body><div id="root"></div><script>${js}</script></body></html>`;
await writeFile(path.join(directory, 'fixture.html'), body);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true });
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const unexpected = [];
const errors = [];
const checks = [];
const permittedLoads = new Set();
const documentRequests = [];
let complete = false;
await context.route('**/*', async route => {
  const request = route.request();
  if (request.isNavigationRequest() && permittedLoads.delete(request.url())) {
    documentRequests.push(request.url());
    await route.fulfill({ status: 200, contentType: 'text/html', body });
  } else {
    unexpected.push(request.url());
    await route.abort();
  }
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const dialog = page.getByRole('dialog', { name: 'Email errors', exact: true });
const trigger = page.getByRole('button', { name: '5 errors', exact: true });
const account = 'ui-fixture@example.test';
const firstId = '18cd123abc100001';
const messageHash = `#all/${firstId}`;
const accountUrl = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account)}${messageHash}`;
async function load(scenario, authuser = account) {
  const url = `https://mail.google.com/mail/u/2/?scenario=${scenario}&authuser=${encodeURIComponent(authuser)}#inbox`;
  permittedLoads.add(url.split('#')[0]);
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Categorize emails', exact: true })).toBeEnabled();
}
async function noCategorization() {
  expect(await page.evaluate(() => ({ starts: window.fixture.starts, resumes: window.fixture.resumes, stops: window.fixture.stops }))).toEqual({ starts: 0, resumes: 0, stops: 0 });
  expect(await page.evaluate(() => window.fixture.commands.filter(command => ['start', 'resume', 'stop'].includes(command)))).toEqual([]);
}
async function profile(email) {
  await page.evaluate(email => {
    document.getElementById('synthetic-google-profile')?.remove();
    const anchor = document.createElement('a');
    anchor.id = 'synthetic-google-profile';
    anchor.href = 'https://accounts.google.com/SignOutOptions?service=mail';
    anchor.setAttribute('aria-label', `Google Account: synthetic (${email})`);
    anchor.textContent = 'Synthetic Google account';
    document.body.prepend(anchor);
  }, email);
}
try {
  await load('errors-legacy');
  await expect(page.getByText('556 labeled · 561/561 processed · Interrupted · 5 failed', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Resume unfinished', exact: true })).toBeChecked();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await noCategorization();
  expect(await page.evaluate(() => window.fixture.commands)).toEqual(['state', 'refreshLabels']);
  const initial = await page.evaluate(() => structuredClone(window.fixture.state.run));
  await trigger.focus();
  await trigger.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByRole('listitem')).toHaveCount(5);
  for (const failure of initial.failures) {
    await expect(dialog.getByText(failure.id, { exact: false })).toBeVisible();
    await expect(dialog.getByText(failure.error, { exact: true })).toBeVisible();
  }
  await expect(dialog.getByText(initial.error, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.fixture.requests.filter(request => request.command === 'refreshRunErrors'))).toEqual([{ type: 'dock:api', command: 'refreshRunErrors', runId: 'saved-failed-run' }]);
  await page.evaluate(() => window.fixture.releaseErrorRefresh());
  await expect(dialog.getByText('Quarterly invoice <north>', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Billing Desk <billing@example.test>', { exact: true })).toBeVisible();
  await expect(dialog.getByText('18cd123abc100005', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('link')).toHaveCount(5);
  const firstLink = dialog.getByRole('listitem').first().getByRole('link');
  await expect(firstLink).toHaveAttribute('href', accountUrl);
  expect(await page.evaluate(() => ({ succeeded: window.fixture.state.run.succeeded, processed: window.fixture.state.run.processed, failed: window.fixture.state.run.failed, failures: window.fixture.state.run.failures.map(({ id, error }) => ({ id, error })) }))).toEqual({ succeeded: 556, processed: 561, failed: 5, failures: initial.failures });
  await noCategorization();
  await page.screenshot({ path: path.join(directory, 'saved-failures.png'), fullPage: true });
  checks.push('Saved 556/561 run shows all five complete errors before metadata returns; four subjects/senders hydrate and the unavailable email keeps its ID.');

  await dialog.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.press('Space');
  await expect(dialog).toBeVisible();
  await page.getByRole('heading', { name: 'Dock component test · synthetic data only' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  checks.push('Enter and Space open the list; Escape restores trigger focus; outside click closes it.');

  await page.setViewportSize({ width: 390, height: 640 });
  await page.getByRole('toolbar', { name: 'Mail toolbar' }).evaluate(element => { element.style.overflow = 'hidden'; element.style.maxHeight = '48px'; });
  await trigger.click();
  await expect(dialog).toBeVisible();
  const geometry = await dialog.evaluate(element => {
    const box = element.getBoundingClientRect();
    const scrollables = [element, ...element.querySelectorAll('*')].filter(node => node.scrollHeight > node.clientHeight + 2 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY));
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, noHorizontalOverflow: element.scrollWidth <= element.clientWidth + 1, scrollable: scrollables.length > 0 };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.noHorizontalOverflow).toBe(true);
  expect(geometry.scrollable).toBe(true);
  await page.screenshot({ path: path.join(directory, 'narrow-failures.png'), fullPage: true });
  const lastLink = dialog.getByRole('listitem').last().getByRole('link');
  await lastLink.scrollIntoViewIfNeeded();
  await expect(lastLink).toBeInViewport();
  await lastLink.focus();
  await expect(lastLink).toBeFocused();
  checks.push('At 390 × 640, the list stays inside the viewport, wraps long text, scrolls, and escapes a clipped toolbar.');
  await dialog.press('Escape');
  await page.setViewportSize({ width: 1100, height: 900 });

  await load('errors-state-error');
  await expect(page.getByRole('alert')).toContainText('Synthetic saved connection error remains visible');
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic saved connection error remains visible' })).toBeVisible();
  await dialog.press('Escape');
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  await page.getByRole('button', { name: 'Reconnect Gmail', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Connect Dock', exact: true }).getByRole('alert')).toContainText('Fixture authorization denied');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(trigger).toBeVisible();
  checks.push('State errors and connection-form errors remain visible with the email error control.');

  await load('errors-run-only');
  await page.getByRole('button', { name: '1 error', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Synthetic Gmail discovery failed before any email was selected. Reconnect Gmail, then resume.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link')).toHaveCount(0);
  await noCategorization();
  checks.push('A run-level failure with no email remains available without a false email link.');

  await load('errors-metadata-fails');
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('listitem')).toHaveCount(5);
  await expect(dialog.getByText('Email details could not be loaded. The saved errors and message links are still available.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Email body exceeds 60,000 characters. This email was left unchanged.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link')).toHaveCount(5);
  await noCategorization();
  checks.push('A metadata request failure preserves all original errors and ID links.');

  await load('errors-navigation');
  await profile('UI-Fixture@Example.Test');
  const before = await page.evaluate(() => ({ documentId: window.fixture.documentId, url: location.href }));
  const requestsBefore = documentRequests.length;
  await trigger.click();
  await dialog.getByRole('listitem').first().getByRole('link').click();
  await expect(page).toHaveURL(`${before.url.split('#')[0]}${messageHash}`);
  expect(await page.evaluate(() => window.fixture.documentId)).toBe(before.documentId);
  expect(documentRequests).toHaveLength(requestsBefore);
  await expect(dialog).not.toBeVisible();
  await noCategorization();
  await page.goBack();
  await expect(page).toHaveURL(before.url);

  await load('errors-navigation', 'different@example.test');
  await profile('different@example.test');
  const wrongAccountDocument = await page.evaluate(() => window.fixture.documentId);
  await trigger.click();
  await expect(dialog.getByRole('listitem').first().getByRole('link')).toHaveAttribute('href', accountUrl);
  permittedLoads.add(accountUrl.split('#')[0]);
  await dialog.getByRole('listitem').first().getByRole('link').click();
  await expect(page).toHaveURL(accountUrl);
  await expect(page.getByRole('button', { name: 'Categorize emails', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.fixture.documentId)).not.toBe(wrongAccountDocument);
  await noCategorization();
  checks.push('Message links preserve a verified Gmail account in place and use the saved run account when the current account differs.');
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
  complete = true;
} catch (error) {
  await page.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true });
  throw error;
} finally {
  await writeFile(path.join(directory, 'report.json'), JSON.stringify({ result: complete ? 'PASS' : 'FAIL', checks, errors, unexpected, documentRequests }, null, 2));
  await context.close();
  await browser.close();
}
console.log(JSON.stringify({ result: 'PASS', checks, artifacts: directory }, null, 2));
