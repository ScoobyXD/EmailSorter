import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const project = process.cwd();
const directory = path.join(project, 'test-results', 'ui-fixture');
await mkdir(directory, { recursive: true });
await build({ configFile: false, root: project, plugins: [react()], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warn', build: { outDir: directory, emptyOutDir: false, lib: { entry: path.join(project, 'scripts/ui-fixture.tsx'), name: 'DockUiFixture', formats: ['iife'], fileName: () => 'fixture.js' } } });
const js = (await readFile(path.join(directory, 'fixture.js'), 'utf8')).replace(/<\/script/gi, '<\\/script');
const html = path.join(directory, 'fixture.html');
const fixtureHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dock UI fixture</title></head><body><div id="root"></div><script>${js}</script></body></html>`;
await writeFile(html, fixtureHtml);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true });
const context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
const unexpected = [];
const errors = [];
await context.route('https://**/*', async route => { unexpected.push(route.request().url()); await route.abort(); });
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(pathToFileURL(html).href);
  await expect(page.getByRole('button', { name: 'Categorize emails', exact: true })).toBeEnabled();
  await expect(page.getByText(/^Only messages currently in Inbox/)).toHaveCount(0);
  await expect(page.getByText(/^Categorization account:/)).toHaveCount(0);
  expect(await page.evaluate(() => window.fixture.starts)).toBe(0);
  expect(await page.evaluate(() => window.fixture.commands)).toEqual(['state', 'refreshLabels']);
  await expect(page.locator('#fixture-native-mail')).toBeVisible();
  await expect(page.locator('#fixture-custom-view')).toBeHidden();

  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  await page.getByRole('button', { name: 'Reconnect Gmail', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Fixture authorization denied');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Categorize emails', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.fixture.starts)).toBe(1);
  await expect(page.getByRole('button', { name: 'Edit Home repair' })).toBeDisabled();
  await expect(page.getByRole('slider', { name: 'Days back' })).toBeDisabled();
  await page.evaluate(() => { Object.assign(window.fixture.state.run, { processed: 1, succeeded: 1 }); });
  await expect(page.getByText('1 labeled · 1/2 processed', { exact: true })).toBeVisible();
  await page.evaluate(() => { window.fixture.state.run.retryAt = Date.now() + 60000; });
  await expect(page.getByText(/1 labeled · Retry in \d+s/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await page.screenshot({ path: path.join(directory, 'rate-limit.png'), fullPage: true });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText('1 labeled · 1/2 processed · Stopped', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Resume unfinished', exact: true })).toBeChecked();
  await page.evaluate(() => { delete window.fixture.state.run.retryAt; });
  expect(await page.evaluate(() => window.fixture.stops)).toBe(1);
  await page.getByRole('button', { name: 'Categorize emails', exact: true }).click();
  expect(await page.evaluate(() => window.fixture.resumes)).toBe(1);
  expect(await page.evaluate(() => window.fixture.starts)).toBe(1);
  await page.evaluate(() => { Object.assign(window.fixture.state.run, { processed: 2, succeeded: 2, status: 'completed' }); });
  await expect(page.getByText('2 labeled · Done', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(directory, 'completed.png'), fullPage: true });
  await checkGmailUsage(page, directory);
  await checkGmailNavigation(browser, fixtureHtml);
  expect(errors).toEqual([]); expect(unexpected).toEqual([]);
  console.log(JSON.stringify({ result: 'PASS', checks: ['current Gmail label names refresh once on load; native mail stays visible without a custom list', 'category, Uncategorized, Inbox and browser Back navigate without per-click API calls', 'pointer, Enter and arrow-key category controls preserve the verified account and current document', 'fresh label page, native label rename, reserved characters and missing labels', 'mismatch or unverified browser account uses an account-qualified Gmail URL', 'disconnected categories open Connection; label-refresh and OAuth errors remain visible', 'no classification before manual click, progress, disabled edits, Stop and explicit resume', 'synthetic fixture only, zero live network requests and page errors'] }, null, 2));
} catch (error) { console.error(JSON.stringify({ errors, unexpected })); throw error; }
finally { await context.close(); await browser.close(); }

async function checkGmailUsage(page, directory) {
  const button = page.getByRole('button', { name: 'Gmail usage', exact: true });
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Gmail usage', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Gmail usage is unavailable for this run.', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const run = window.fixture.state.run;
    const entry = (method, unitsPerRequest, requests, succeeded = requests, retries = 0, httpErrors = 0, networkErrors = 0) => ({ method, unitsPerRequest, requests, succeeded, retries, httpErrors, networkErrors });
    run.accountEmail = 'ui-fixture@example.test';
    run.gmailUsage = { startedAt: run.startedAt, complete: true, methods: [
      entry('getProfile', 1, 2, 1, 1, 1),
      entry('messages.list', 5, 2),
      entry('labels.list', 1, 1),
      entry('labels.create', 5, 1),
      entry('labels.patch', 5, 6),
      entry('messages.get', 20, 125, 121, 5, 2, 1),
      entry('messages.attachments.get', 20, 3),
      entry('messages.modify', 5, 100),
    ] };
    window.fixture.state.runHistory = [
      { ...structuredClone(run), id: 'partial-run', startedAt: run.startedAt - 60000, gmailUsage: { startedAt: run.startedAt - 30000, complete: false, methods: [entry('messages.list', 5, 1)] } },
      { ...structuredClone(run), id: 'legacy-run', startedAt: run.startedAt - 120000, gmailUsage: undefined },
    ];
  });
  const table = dialog.getByRole('table', { name: 'Gmail quota units by operation' });
  await expect(table).toBeVisible();
  await expect(table.getByRole('row').filter({ hasText: 'messages.get' })).toContainText('2,500');
  await expect(dialog).toContainText('3,108');
  await expect(dialog).toContainText('240');
  await expect(dialog).toContainText('ui-fixture@example.test');
  await page.screenshot({ path: path.join(directory, 'gmail-usage.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: path.join(directory, 'gmail-usage-mobile.png'), fullPage: true });
  await dialog.getByRole('combobox', { name: 'Run', exact: true }).selectOption('partial-run');
  await expect(dialog).toContainText(/partial/i);
  await dialog.getByRole('combobox', { name: 'Run', exact: true }).selectOption('legacy-run');
  await expect(dialog.getByText('Gmail usage is unavailable for this run.', { exact: true })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Run', exact: true }).selectOption('fixture-run');
  await expect(dialog).toContainText('3,108');
  await dialog.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(button).toBeFocused();
  await page.setViewportSize({ width: 1100, height: 1000 });
}

async function checkGmailNavigation(browser, body) {
  const navigation = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const documentRequests = [];
  const failures = [];
  const permittedLoads = new Set();
  // Every resource is intercepted. These pages contain synthetic data only.
  await navigation.route('**/*', async route => {
    const request = route.request();
    const url = request.url();
    if (request.isNavigationRequest() && permittedLoads.delete(url)) {
      documentRequests.push(url);
      await route.fulfill({ status: 200, contentType: 'text/html', body });
    } else {
      failures.push(`Unexpected request: ${url}`);
      await route.abort();
    }
  });
  const gmail = await navigation.newPage();
  gmail.on('pageerror', error => failures.push(error.message));
  const category = gmail.getByRole('tab', { name: 'Home repair', exact: true });
  const uncategorized = gmail.getByRole('tab', { name: 'Uncategorized', exact: true });
  const inbox = gmail.getByRole('button', { name: 'Back to Gmail inbox', exact: true });
  const labelHash = '#label/Dock%2FHousehold+%2B+repair+%5Bhome-repair%5D';
  const uncategorizedHash = '#label/Dock%2FUncategorized';
  const accountUrl = `https://mail.google.com/mail/u/?authuser=ui-fixture%40example.test${labelHash}`;
  async function load(url) {
    permittedLoads.add(url.split('#')[0]);
    await gmail.goto(url);
    await expect(category).toBeEnabled();
  }
  async function profile(email, attribute = 'aria-label') {
    await gmail.evaluate(({ email, attribute }) => {
      document.getElementById('synthetic-google-profile')?.remove();
      if (!email) return;
      const header = document.createElement('header');
      header.id = 'synthetic-google-profile';
      header.setAttribute('role', 'banner');
      const anchor = document.createElement('a');
      anchor.href = 'https://accounts.google.com/SignOutOptions?hl=en&service=mail';
      anchor.setAttribute(attribute, `Google Account: UI fixture\n(${email})`);
      anchor.textContent = 'Synthetic Google profile';
      header.append(anchor);
      document.body.prepend(header);
    }, { email, attribute });
  }
  async function inPlace(activate) {
    const before = await gmail.evaluate(() => ({ documentId: window.fixture.documentId, pathname: location.pathname, search: location.search, url: location.href, commands: [...window.fixture.commands] }));
    const requestsBefore = documentRequests.length;
    await activate();
    await expect(gmail).toHaveURL(`${before.url.split('#')[0]}${labelHash}`);
    await expect(category).toHaveAttribute('aria-selected', 'true');
    await expect(gmail.locator('#fixture-native-mail')).toBeVisible();
    await expect(gmail.locator('#fixture-custom-view')).toBeHidden();
    await expect(gmail.getByRole('link', { name: /^Open Gmail conversation:/ })).toHaveCount(0);
    expect(await gmail.evaluate(() => ({ documentId: window.fixture.documentId, pathname: location.pathname, search: location.search, commands: window.fixture.commands }))).toEqual({ documentId: before.documentId, pathname: before.pathname, search: before.search, commands: before.commands });
    expect(documentRequests).toHaveLength(requestsBefore);
    await gmail.goBack();
    await expect(gmail).toHaveURL(before.url);
    await expect(category).toHaveAttribute('aria-selected', 'false');
    expect(await gmail.evaluate(() => window.fixture.documentId)).toBe(before.documentId);
    expect(documentRequests).toHaveLength(requestsBefore);
  }
  async function accountFallback() {
    const before = await gmail.evaluate(() => ({ documentId: window.fixture.documentId, url: location.href }));
    const requestsBefore = documentRequests.length;
    const reloads = before.url.split('#')[0] !== accountUrl.split('#')[0];
    if (reloads) permittedLoads.add(accountUrl.split('#')[0]);
    await category.click();
    await expect(gmail).toHaveURL(accountUrl);
    await expect(category).toBeEnabled();
    expect(documentRequests).toHaveLength(requestsBefore + Number(reloads));
    if (reloads) {
      expect(await gmail.evaluate(() => window.fixture.documentId)).not.toBe(before.documentId);
      await expect(category).toHaveAttribute('aria-selected', 'true');
    } else expect(await gmail.evaluate(() => window.fixture.documentId)).toBe(before.documentId);
    expect(await gmail.evaluate(() => window.fixture.commands)).toEqual(['state', 'refreshLabels']);
  }
  try {
    await load('https://mail.google.com/mail/u/2/?dock-ui-navigation=1&authuser=2&zx=fixture#inbox');
    await profile('UI-Fixture@Example.Test');
    expect(await gmail.evaluate(() => window.fixture.commands)).toEqual(['state', 'refreshLabels']);
    await inPlace(() => category.click());
    await inPlace(async () => { await category.focus(); await category.press('Enter'); });
    await profile('ui-fixture@example.test', 'title');
    await inPlace(() => category.click());
    await category.focus();
    await category.press('ArrowRight');
    await expect(uncategorized).toBeFocused();
    await uncategorized.press('Enter');
    await expect(gmail).toHaveURL(`https://mail.google.com/mail/u/2/?dock-ui-navigation=1&authuser=2&zx=fixture${uncategorizedHash}`);
    await expect(uncategorized).toHaveAttribute('aria-selected', 'true');
    await inbox.click();
    await expect(gmail).toHaveURL('https://mail.google.com/mail/u/2/?dock-ui-navigation=1&authuser=2&zx=fixture#inbox');
    expect(await gmail.evaluate(() => window.fixture.commands)).toEqual(['state', 'refreshLabels']);
    expect(await gmail.evaluate(() => window.fixture.starts)).toBe(0);

    await load(`https://mail.google.com/mail/u/?authuser=ui-fixture%40example.test${labelHash}`);
    await expect(category).toHaveAttribute('aria-selected', 'true');
    await inbox.click();
    await inPlace(() => category.click()); // Explicit account email works without a badge.
    await profile('different@example.test');
    await accountFallback(); // Visible account takes precedence over a stale query.

    await load('https://mail.google.com/mail/u/0/?dock-ui-navigation=unknown&authuser=0#inbox');
    await accountFallback(); // Numeric slots do not identify an account email.
    await load('https://mail.google.com/mail/u/1/?authuser=different%40example.test#inbox');
    await accountFallback();

    await load('https://mail.google.com/mail/u/0/?scenario=rename-during-run&authuser=ui-fixture%40example.test#inbox');
    await category.click();
    expect(await gmail.evaluate(() => window.fixture.starts)).toBe(0);
    await gmail.getByRole('button', { name: 'Categorize emails', exact: true }).click();
    await expect(gmail.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await gmail.evaluate(() => { window.fixture.state.categories[0].labelName = 'Household renamed'; });
    await expect(gmail).toHaveURL(/#label\/Household\+renamed$/);
    await expect(category).toHaveAttribute('aria-selected', 'true');
    expect(await gmail.evaluate(() => window.fixture.starts)).toBe(1);
    expect(await gmail.evaluate(() => window.fixture.commands.filter(command => command === 'refreshLabels'))).toHaveLength(1);
    await gmail.evaluate(() => { Object.assign(window.fixture.state.run, { processed: 2, succeeded: 2, status: 'completed' }); });
    await expect(gmail.getByText('2 labeled · Done', { exact: true })).toBeVisible();

    await load('https://mail.google.com/mail/u/0/?scenario=missing-label&authuser=ui-fixture%40example.test#inbox');
    const missingUrl = gmail.url();
    await category.click();
    await expect(gmail.getByRole('alert')).toBeVisible();
    await expect(gmail).toHaveURL(missingUrl);
    await expect(gmail.locator('#fixture-custom-view')).toBeHidden();
    expect(await gmail.evaluate(() => window.fixture.commands)).toEqual(['state', 'refreshLabels']);

    await load('https://mail.google.com/mail/u/0/?scenario=missing-uncategorized&authuser=ui-fixture%40example.test#inbox');
    const missingUncategorizedUrl = gmail.url();
    await uncategorized.click();
    await expect(gmail.getByRole('alert')).toBeVisible();
    await expect(gmail).toHaveURL(missingUncategorizedUrl);
    expect(await gmail.evaluate(() => window.fixture.commands)).toEqual(['state', 'refreshLabels']);

    await load('https://mail.google.com/mail/u/0/?scenario=refresh-fails&authuser=ui-fixture%40example.test#inbox');
    await expect(gmail.getByRole('alert')).toContainText('Fixture Gmail access expired');
    await category.click();
    await expect(gmail).toHaveURL(/#inbox$/);
    expect(await gmail.evaluate(() => window.fixture.commands)).toEqual(['state', 'refreshLabels']);

    await load('https://mail.google.com/mail/u/0/?scenario=disconnected#inbox');
    await category.click();
    await expect(gmail.getByRole('dialog', { name: 'Connect Dock', exact: true })).toBeVisible();
    await expect(gmail).toHaveURL(/#inbox$/);
    await expect(gmail.locator('#fixture-custom-view')).toBeHidden();
    expect(await gmail.evaluate(() => window.fixture.starts)).toBe(0);
    expect(failures).toEqual([]);
  } finally { await navigation.close(); }
}
