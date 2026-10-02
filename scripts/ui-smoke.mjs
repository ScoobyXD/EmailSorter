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
  expect(await page.evaluate(() => window.fixture.starts)).toBe(0);
  await page.getByRole('tab', { name: 'Home repair', exact: true }).click();
  const link = page.getByRole('link', { name: 'Open Gmail conversation: Sink repair appointment', exact: true });
  await expect(link).toHaveAttribute('href', 'https://mail.google.com/mail/u/?authuser=ui-fixture%40example.test#all/thread-a');
  await expect(link).toHaveClass(/is-unread/);
  await page.getByRole('button', { name: 'Load more messages' }).click();
  await expect(page.getByRole('link', { name: /^Open Gmail conversation:/ })).toHaveCount(2);
  await page.getByLabel('Message order', { exact: true }).selectOption('oldest');
  await expect(page.getByRole('link', { name: /^Open Gmail conversation:/ }).first()).toHaveText(/Fixture receipt/);
  expect(await page.evaluate(() => window.fixture.starts)).toBe(0);
  await page.evaluate(() => { window.fixture.failList = true; });
  await page.getByRole('button', { name: 'Refresh category messages' }).click();
  await expect(page.getByRole('alert')).toContainText('Fixture Gmail access expired');
  await page.evaluate(() => { window.fixture.failList = false; });
  await page.getByRole('button', { name: 'Refresh category messages' }).click();
  await expect(link).toBeVisible();

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
  await expect(page.getByText('Categorizing: 1 of 2 messages processed.', { exact: true })).toBeVisible();
  // The log viewer only reads synthetic saved events, including during a run.
  const gmailListsBeforeLogs = await page.evaluate(() => window.fixture.listCalls);
  const startsBeforeLogs = await page.evaluate(() => window.fixture.starts);
  await page.getByRole('button', { name: 'Run logs', exact: true }).click();
  const logs = page.getByRole('dialog', { name: 'Run logs', exact: true });
  await expect(logs).toBeVisible();
  await expect(logs.getByRole('combobox', { name: 'Run history', exact: true })).toHaveValue('fixture-run');
  await expect(logs.getByRole('list', { name: 'Log events' }).locator(':scope > li')).toHaveCount(100);
  await expect(logs.getByText('875', { exact: true })).toBeVisible();
  await logs.getByText('How sorting works and uses Gmail quota', { exact: true }).click();
  await expect(logs.getByText(/A normal sort uses about 25 Gmail units/)).toBeVisible();
  await logs.getByText('How sorting works and uses Gmail quota', { exact: true }).click();
  await logs.getByText('Gmail rate limit reached; completed labels are saved.', { exact: true }).click();
  await expect(logs.getByLabel('Event 120 JSON', { exact: true })).toContainText('userRateLimitExceeded');
  await logs.getByRole('combobox', { name: 'Show', exact: true }).selectOption('error');
  await expect(logs.getByRole('list', { name: 'Log events' }).locator(':scope > li')).toHaveCount(1);
  await logs.getByLabel('Search loaded events', { exact: true }).fill('fixture-request-120');
  await expect(logs.getByRole('list', { name: 'Log events' }).locator(':scope > li')).toHaveCount(1);
  await logs.getByLabel('Search loaded events', { exact: true }).fill('message-a');
  await expect(logs.getByRole('list', { name: 'Log events' }).locator(':scope > li')).toHaveCount(1);
  await logs.getByLabel('Search loaded events', { exact: true }).fill('does-not-exist');
  await expect(logs.getByText('No loaded events match this filter.', { exact: true })).toBeVisible();
  await logs.getByLabel('Search loaded events', { exact: true }).fill('');
  await logs.getByRole('combobox', { name: 'Show', exact: true }).selectOption('all');
  await logs.getByRole('button', { name: 'Load older', exact: true }).click();
  await expect(logs.getByRole('list', { name: 'Log events' }).locator(':scope > li')).toHaveCount(115);
  await page.evaluate(() => {
    const seq = 121;
    window.fixture.logEvents.push({ seq, id: `fixture-event-${seq}`, at: Date.now(), runId: 'fixture-run', scope: 'run', level: 'info', stage: 'labels', event: 'label.applied', message: 'Live fixture event arrived.', messageId: 'message-live' });
    window.fixture.logPersistence.latestSequence = seq;
  });
  await expect(logs.getByText('Live fixture event arrived.', { exact: true })).toBeVisible();
  await expect(logs.getByRole('list', { name: 'Log events' }).locator(':scope > li')).toHaveCount(116);
  await logs.getByText('Log storage · Local copy pending', { exact: true }).click();
  await expect(logs.getByText(/The browser retains up to 100,000 events/)).toBeVisible();
  await expect(logs.getByText(/C:\\Dock-fixture/)).toBeVisible();
  await logs.getByRole('button', { name: 'Retry local copy', exact: true }).click();
  await expect(logs.getByText('Log storage · Local copy saved', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await logs.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^dock-logs-fixture-run-\d+\.json$/);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported.schemaVersion).toBe(1); expect(exported.runId).toBe('fixture-run'); expect(exported.events).toHaveLength(116);
  await logs.getByRole('combobox', { name: 'Run history', exact: true }).selectOption('fixture-previous');
  await expect(logs.getByRole('list', { name: 'Log events' }).locator(':scope > li')).toHaveCount(5);
  await logs.getByRole('combobox', { name: 'Run history', exact: true }).selectOption('');
  await expect(logs.getByRole('combobox', { name: 'Run history', exact: true })).toHaveValue('');
  await expect(logs.getByRole('list', { name: 'Log events' }).locator(':scope > li')).toHaveCount(100);
  await page.screenshot({ path: path.join(directory, 'run-logs.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await logs.evaluate(element => element.scrollWidth <= element.clientWidth + 2)).toBe(true);
  await page.screenshot({ path: path.join(directory, 'run-logs-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.keyboard.press('Escape');
  await expect(logs).toBeHidden();
  await expect(page.getByRole('button', { name: 'Run logs', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.fixture.listCalls)).toBe(gmailListsBeforeLogs);
  expect(await page.evaluate(() => window.fixture.starts)).toBe(startsBeforeLogs);
  await page.getByRole('button', { name: 'Run logs', exact: true }).click();
  await expect(logs).toBeVisible();
  await logs.getByRole('button', { name: 'Close run logs' }).click();
  await expect(logs).toBeHidden();

  await page.evaluate(() => { window.fixture.state.run.retryAt = Date.now() + 60000; });
  await expect(page.getByText(/Waiting for Gmail’s rate limit\. Retrying in \d+ seconds; 1 labeled/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await page.screenshot({ path: path.join(directory, 'rate-limit.png'), fullPage: true });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText(/Stopped\. 1 of 2 processed/)).toBeVisible();
  await page.evaluate(() => { delete window.fixture.state.run.retryAt; });
  expect(await page.evaluate(() => window.fixture.stops)).toBe(1);
  await page.getByRole('button', { name: 'Categorize emails', exact: true }).click();
  expect(await page.evaluate(() => window.fixture.resumes)).toBe(1);
  expect(await page.evaluate(() => window.fixture.starts)).toBe(1);
  await page.evaluate(() => { Object.assign(window.fixture.state.run, { processed: 2, succeeded: 2, status: 'completed' }); });
  await expect(page.getByText('Finished. 2 labeled, 0 skipped, 0 failed.', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(directory, 'completed.png'), fullPage: true });
  await checkGmailNavigation(browser, fixtureHtml);
  expect(errors).toEqual([]); expect(unexpected).toEqual([]);
  console.log(JSON.stringify({ result: 'PASS', checks: ['Run logs modal, pipeline explanation, totals, JSON details, filtering, paging, live updates, history, mirror sync, export, Escape/focus return; no Gmail reads', 'real-mode category link and account URL, unread message, paging dedupe, ordering', 'message loading error and explicit refresh recovery', 'OAuth error is actionable in Connection dialog', 'no classification before manual click, run progress, disabled edits during run, Stop', 'explicit resume keeps completed work and successful completion feedback', 'Gmail pointer/Enter conversation navigation preserves document, account path/query and browser Back', 'modified/middle clicks preserve selection and account-qualified link; mismatch/unknown account uses original link', 'account identity comes from native profile label/title or explicit email authuser; no classification on navigation', 'synthetic fixture only, zero live network requests and page errors'] }, null, 2));
} catch (error) { console.error(JSON.stringify({ errors, unexpected })); throw error; }
finally { await context.close(); await browser.close(); }

async function checkGmailNavigation(browser, body) {
  const navigation = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
  const documentRequests = [];
  const failures = [];
  const permittedLoads = new Set();
  // Every resource is intercepted; these pages contain synthetic data only.
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
  const conversation = gmail.getByRole('link', { name: 'Open Gmail conversation: Sink repair appointment', exact: true });
  const accountUrl = 'https://mail.google.com/mail/u/?authuser=ui-fixture%40example.test#all/thread-a';
  async function load(url) {
    permittedLoads.add(url.split('#')[0]);
    await gmail.goto(url);
    await expect(category).toBeEnabled();
    await gmail.evaluate(() => { window.fixture.documentId = crypto.randomUUID(); });
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
  async function select() {
    await category.click();
    await expect(conversation).toBeVisible();
    await expect(conversation).toHaveAttribute('href', accountUrl);
  }
  async function inPlace(activate) {
    await select();
    const before = await gmail.evaluate(() => ({ documentId: window.fixture.documentId, pathname: location.pathname, search: location.search, url: location.href }));
    const requestsBefore = documentRequests.length;
    await activate();
    await expect(gmail).toHaveURL(`${before.url.split('#')[0]}#all/thread-a`);
    await expect(gmail.getByRole('button', { name: 'Back to inbox', exact: true })).toBeHidden();
    expect(await gmail.evaluate(() => ({ documentId: window.fixture.documentId, pathname: location.pathname, search: location.search }))).toEqual({ documentId: before.documentId, pathname: before.pathname, search: before.search });
    expect(documentRequests).toHaveLength(requestsBefore);
    await gmail.goBack();
    await expect(gmail).toHaveURL(before.url);
    expect(await gmail.evaluate(() => window.fixture.documentId)).toBe(before.documentId);
    expect(documentRequests).toHaveLength(requestsBefore);
  }
  async function nativeDefault(options = {}, preserveSelection = false) {
    await select();
    const before = gmail.url();
    // Observe default prevention after React handles the event, then suppress
    // the browser's native action so fallback/new-tab tests stay wholly local.
    await gmail.evaluate(() => {
      window.fixture.navigationEvent = undefined;
      const record = event => {
        const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement);
        if (!anchor?.classList.contains('dock-native-message-row')) return;
        window.fixture.navigationEvent = { prevented: event.defaultPrevented, href: anchor.href };
        event.preventDefault();
        document.removeEventListener('click', record);
        document.removeEventListener('auxclick', record);
      };
      document.addEventListener('click', record);
      document.addEventListener('auxclick', record);
    });
    await conversation.click(options);
    expect(await gmail.evaluate(() => window.fixture.navigationEvent)).toEqual({ prevented: false, href: accountUrl });
    await expect(gmail).toHaveURL(before);
    if (preserveSelection) {
      await expect(category).toHaveAttribute('aria-selected', 'true');
      await expect(conversation).toBeVisible();
    }
  }
  try {
    await load('https://mail.google.com/mail/u/2/?dock-ui-navigation=1&authuser=2&zx=fixture#inbox');
    await profile('UI-Fixture@Example.Test');
    await inPlace(() => conversation.click());
    await inPlace(async () => { await conversation.focus(); await conversation.press('Enter'); });
    for (const modifier of ['Control', 'Meta', 'Shift', 'Alt']) await nativeDefault({ modifiers: [modifier] }, true);
    await nativeDefault({ button: 'middle' }, true);
    await profile('ui-fixture@example.test', 'title');
    await inPlace(() => conversation.click());
    await profile('different@example.test');
    await nativeDefault();
    await profile(null);
    await nativeDefault(); // Numeric account slots do not identify an email.
    expect(await gmail.evaluate(() => window.fixture.starts)).toBe(0);

    await load('https://mail.google.com/mail/u/?dock-ui-navigation=2&authuser=ui-fixture%40example.test#inbox');
    await inPlace(() => conversation.click()); // Explicit account email, no badge.
    await profile('different@example.test');
    await nativeDefault(); // Visible account takes precedence over a stale query.
    expect(await gmail.evaluate(() => window.fixture.starts)).toBe(0);

    await load('https://mail.google.com/mail/u/0/?dock-ui-navigation=3&authuser=different%40example.test#inbox');
    await nativeDefault();
    expect(await gmail.evaluate(() => window.fixture.starts)).toBe(0);
    expect(documentRequests).toHaveLength(3);
    expect(failures).toEqual([]);
  } finally { await navigation.close(); }
}
