/** Browser integration check for the built Gmail sidebar adapter and its storage path. */
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const project = process.cwd();
const extension = path.resolve(project, '.output/chrome-mv3');
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
const artifacts = path.join(project, 'test-results', 'sidebar', `${manifest.version}-${Date.now()}`);
await mkdir(artifacts, { recursive: true });
const issues = [];
const reports = [];
const pageErrors = [];
const unexpectedRequests = [];
const preferenceKey = 'dock-gmail-sidebar-width';

function nativeNavigation() {
  return `<div class="aeN" role="navigation" aria-label="Mail folders" style="width:187px"><div class="wT"><button class="compose">Compose</button><a href="#inbox" class="selected">Inbox <span>470</span></a><a href="#sent">Sent</a><a href="#drafts">Drafts <span>122</span></a><h2>Labels</h2><a href="#label/respond">1: to respond</a><a href="#label/finance">Dock/finance notifications and statements</a><a href="#label/updates">Dock/SaaS updates and announcements</a></div></div>`;
}

function fixture() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gmail sidebar fixture</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f8fc;font:14px Arial,sans-serif;color:#202124}header{height:64px;display:flex;align-items:center;gap:20px;padding:12px 24px}header button{font:20px Arial;border:0;background:none;width:40px;height:40px}.nH.aqk{display:flex;height:calc(100vh - 64px);width:100%;overflow:hidden}.aeN{flex-shrink:0;min-width:256px;max-width:256px;height:100%;position:relative}.wT{min-width:240px;max-width:240px;overflow:hidden;height:100%;padding-top:12px}.wT a{display:flex;align-items:center;gap:12px;height:38px;margin-right:4px;padding:0 20px 0 28px;text-decoration:none;color:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wT a span{margin-left:auto}.wT .selected{background:#d3e3fd;border-radius:0 20px 20px 0}.wT h2{font-size:16px;padding:16px 20px 0 28px}.compose{margin:0 0 20px 12px;padding:20px;background:#c2e7ff;border:0;border-radius:16px;font:16px Arial}.collapsed .aeN{min-width:72px;max-width:72px}.collapsed .wT{min-width:56px;max-width:56px}.collapsed .wT a{padding-left:20px}.collapsed .compose{padding:16px;font-size:0}.collapsed .compose::before{content:'+';font-size:20px}.collapsed .wT h2{visibility:hidden}main{flex:1;min-width:600px;background:white;border-radius:16px 0 0 0;overflow:auto}.tools{height:48px;display:flex;align-items:center;padding:0 12px;gap:16px}.tools button{border:0;background:none;font:18px Arial}.categories{display:flex;height:56px}.categories button{width:180px;border:0;border-bottom:1px solid #dadce0;background:white;text-align:left;padding:0 20px;font:14px Arial}.categories button[aria-selected=true]{color:#0b57d0;border-bottom:3px solid #0b57d0}.message{padding:18px 24px;border-bottom:1px solid #e0e3e7;background:#f2f6fc}.message strong{display:inline-block;width:180px}
</style></head><body><header><button class="gb_ad" role="button" aria-label="Main menu" aria-expanded="true">☰</button><strong>Gmail</strong><span>Synthetic sidebar fixture · no real email</span></header><div class="nH aqk">${nativeNavigation()}<main role="main"><div class="tools" role="toolbar" aria-label="Mail toolbar"><button aria-label="Select messages">□</button><button aria-label="Refresh inbox">↻</button><button aria-label="More mail actions">⋮</button></div><div class="categories" role="tablist" aria-label="Native categories"><button role="tab" aria-selected="true">Primary</button><button role="tab" aria-selected="false">Promotions</button><button role="tab" aria-selected="false">Social</button><button role="tab" aria-selected="false">Updates</button></div><div class="message"><strong>Fixture sender</strong>The message list keeps its native layout.</div><div class="message"><strong>Another sender</strong>Only the folder sidebar changes width.</div></main></div><script>
document.querySelector('[aria-label="Main menu"]').addEventListener('click', event => {const collapsed=document.body.classList.toggle('collapsed');event.currentTarget.setAttribute('aria-expanded',String(!collapsed));});
window.nativeRefreshClicks=0;document.querySelector('[aria-label="Refresh inbox"]').addEventListener('click',()=>window.nativeRefreshClicks++);
</script></body></html>`;
}

await writeFile(path.join(artifacts, 'fixture.html'), fixture());
const context = await chromium.launchPersistentContext(path.join(artifacts, 'profile'), {
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
await context.route(/^https?:\/\//, async route => {
  const request = route.request();
  if (request.isNavigationRequest() && new URL(request.url()).hostname === 'mail.google.com') {
    await route.fulfill({ contentType: 'text/html', body: fixture() });
  } else { unexpectedRequests.push(request.url()); await route.abort(); }
});

const page = await context.newPage();
const sidebar = page.locator('.aeN[role="navigation"]');
const handle = page.getByRole('separator', { name: 'Gmail sidebar', exact: true });
const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
const savedWidth = () => worker.evaluate(async key => (await chrome.storage.local.get(key))[key], preferenceKey);
const sidebarWidth = () => sidebar.evaluate(element => Math.round(element.getBoundingClientRect().width));
const handleStyle = () => handle.evaluate(element => {
  const line = getComputedStyle(element, '::before');
  const style = getComputedStyle(element);
  return { color: line.backgroundColor, opacity: line.opacity, outline: style.outlineStyle, focused: document.activeElement === element, focusVisible: element.matches(':focus-visible'), hovered: element.matches(':hover') };
});

async function checkWidth(expected) {
  await expect.poll(sidebarWidth).toBe(expected);
  await expect(handle).toHaveAttribute('aria-valuenow', String(expected));
  const geometry = await sidebar.evaluate(element => {
    const nav = element.getBoundingClientRect();
    const inner = element.querySelector('.wT').getBoundingClientRect();
    const main = document.querySelector('main').getBoundingClientRect();
    return { navWidth: nav.width, navRight: nav.right, innerWidth: inner.width, mainLeft: main.left, mainWidth: main.width };
  });
  expect(geometry.innerWidth, 'The label container follows the sidebar width').toBe(expected - 16);
  expect(geometry.mainLeft, 'The message list starts at the sidebar edge').toBe(geometry.navRight);
  expect(geometry.mainWidth, 'The message list retains its native minimum width').toBeGreaterThanOrEqual(600);
  return geometry;
}

async function record(scenario, screenshot = false) {
  const geometry = await checkWidth(await sidebarWidth());
  reports.push({ scenario, ...geometry, savedWidth: await savedWidth(), handleStyle: await handleStyle() });
  if (screenshot) await page.screenshot({ path: path.join(artifacts, `${scenario}.png`), fullPage: true });
}

async function dragWidth(width, cancel = false) {
  const box = await handle.boundingBox();
  if (!box) throw new Error('The sidebar resize handle is unavailable.');
  const currentWidth = await sidebarWidth();
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(120, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + width - currentWidth, y, { steps: 8 });
  await expect.poll(handleStyle).toMatchObject({ color: 'rgb(11, 87, 208)', opacity: '1' });
  if (cancel) {
    await checkWidth(width);
    await page.keyboard.press('Escape');
  }
  await page.mouse.up();
}

try {
  await page.goto('https://mail.google.com/mail/u/0/#inbox');
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
  await expect(handle).toHaveAttribute('tabindex', '0');
  await expect(page.locator('[data-dock-sidebar-handle]')).toHaveCount(1);
  await checkWidth(256);
  expect(await savedWidth()).toBeUndefined();
  await record('native-width', true);

  await handle.hover();
  await expect.poll(handleStyle).toMatchObject({ color: 'rgb(11, 87, 208)', opacity: '1', hovered: true });
  await page.mouse.move(1100, 500);
  await expect.poll(handleStyle).toMatchObject({ color: 'rgb(116, 119, 117)', opacity: '0.25', outline: 'none', hovered: false });
  await page.getByRole('link', { name: 'Dock/SaaS updates and announcements', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(handle).toBeFocused();
  await expect.poll(handleStyle).toMatchObject({ color: 'rgb(11, 87, 208)', opacity: '1', outline: 'solid', focused: true, hovered: false });
  await record('keyboard-focus-visible', true);

  await dragWidth(420);
  await checkWidth(420);
  await expect.poll(savedWidth).toBe(420);
  await page.mouse.move(1100, 500);
  await expect.poll(handleStyle).toMatchObject({ color: 'rgb(116, 119, 117)', opacity: '0.25', outline: 'none', focused: true, hovered: false });
  await record('drag-wider', true);
  await handle.press('ArrowRight');
  await checkWidth(430);
  await expect.poll(handleStyle).toMatchObject({ color: 'rgb(11, 87, 208)', opacity: '1', outline: 'solid', focused: true, hovered: false });
  await handle.press('ArrowLeft');
  await checkWidth(420);
  await record('pointer-to-keyboard-focus');
  await page.getByRole('button', { name: 'Refresh inbox', exact: true }).click();
  expect(await page.evaluate(() => window.nativeRefreshClicks)).toBe(1);

  await handle.focus();
  await handle.press('ArrowRight');
  await checkWidth(430);
  await expect.poll(handleStyle).toMatchObject({ color: 'rgb(11, 87, 208)', opacity: '1', outline: 'solid', focused: true, hovered: false });
  await expect.poll(savedWidth).toBe(430);
  await handle.press('ArrowLeft');
  await checkWidth(420);
  await handle.press('Shift+ArrowRight');
  await checkWidth(460);
  await expect.poll(savedWidth).toBe(460);
  await record('keyboard-resize');

  await dragWidth(20);
  await checkWidth(180);
  await expect.poll(savedWidth).toBe(180);
  await dragWidth(1100);
  await checkWidth(600);
  await expect.poll(savedWidth).toBe(600);
  await record('width-limits');

  await handle.press('Home');
  await checkWidth(180);
  await handle.press('End');
  await checkWidth(600);
  await expect.poll(savedWidth).toBe(600);
  await record('keyboard-limits');

  await dragWidth(420);
  await expect.poll(savedWidth).toBe(420);
  await dragWidth(500, true);
  await checkWidth(420);
  expect(await savedWidth(), 'Escape cancels the drag without changing saved width').toBe(420);
  await expect(page.locator('body')).not.toHaveAttribute('data-dock-sidebar-dragging', '');
  await record('cancel-drag');
  await page.reload();
  await expect(handle).toBeVisible();
  await checkWidth(420);
  await record('reload-restores-width');

  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await expect.poll(sidebarWidth).toBe(72);
  await expect(handle).toBeHidden();
  expect(await savedWidth()).toBe(420);
  await page.screenshot({ path: path.join(artifacts, 'native-collapsed.png'), fullPage: true });
  reports.push({ scenario: 'native-collapsed', navWidth: await sidebarWidth(), savedWidth: await savedWidth() });
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await expect(handle).toBeVisible();
  await checkWidth(420);
  await record('native-expanded');

  await page.getByRole('link', { name: 'Sent', exact: true }).click();
  await expect(page).toHaveURL(/#sent$/);
  await expect(page.locator('dock-inbox-controls')).toHaveCount(0);
  await checkWidth(420);
  await expect(page.locator('[data-dock-sidebar-handle]')).toHaveCount(1);
  await page.getByRole('link', { name: 'Inbox 470', exact: true }).click();
  await expect(page.locator('dock-inbox-controls')).toHaveCount(1);
  await record('native-route-return');

  await page.evaluate(html => {
    const replacement = new DOMParser().parseFromString(html, 'text/html').querySelector('.aeN');
    document.querySelector('.aeN').replaceWith(document.adoptNode(replacement));
  }, nativeNavigation());
  await expect(handle).toBeVisible();
  await checkWidth(420);
  await expect(page.locator('[data-dock-sidebar-handle]')).toHaveCount(1);
  await record('navigation-replaced', true);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(sidebarWidth).toBeLessThanOrEqual(300);
  expect(await sidebarWidth()).toBeGreaterThanOrEqual(180);
  expect(await savedWidth(), 'Viewport clamping preserves the preferred width').toBe(420);
  await record('narrow-window', true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await checkWidth(420);
  await record('wide-window-restores-width');

  await handle.dblclick();
  await checkWidth(256);
  await expect.poll(savedWidth).toBeUndefined();
  expect(await sidebar.evaluate(element => element.style.width), 'Reset preserves Gmail inline width').toBe('187px');
  await expect(sidebar).not.toHaveAttribute('data-dock-sidebar-width', '');
  await record('pointer-reset');
  await handle.press('ArrowRight');
  await expect.poll(sidebarWidth).toBeGreaterThan(256);
  await handle.press('Enter');
  await checkWidth(256);
  await expect.poll(savedWidth).toBeUndefined();
  await page.reload();
  await expect(handle).toBeVisible();
  await checkWidth(256);
  await record('keyboard-reset-persists');

  expect(pageErrors, 'The fixture and extension produce no page errors').toEqual([]);
  expect(unexpectedRequests, 'The fixture does not use mailbox APIs or external services').toEqual([]);
} catch (error) {
  issues.push(error instanceof Error ? error.message : String(error));
  if (await handle.count()) reports.push({ scenario: 'failure-state', handleStyle: await handleStyle() });
  await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true });
} finally {
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ version: manifest.version, result: issues.length ? 'FAIL' : 'PASS', issues, pageErrors, unexpectedRequests, reports }, null, 2));
  await context.close();
}
console.log(JSON.stringify({ version: manifest.version, result: issues.length ? 'FAIL' : 'PASS', issues, artifacts, scenarios: reports.length }, null, 2));
expect(issues, 'Gmail sidebar resizing, native collapse, and saved preferences must work together').toEqual([]);
