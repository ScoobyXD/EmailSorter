import { chromium, expect } from '@playwright/test';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const project = process.cwd();
const output = path.resolve(project, 'outputs');
const artifacts = path.join(project, 'test-results');
await mkdir(artifacts, { recursive: true });
const executablePath = process.env.CHROMIUM_EXECUTABLE || undefined;
const errors = [];
const unexpectedRequests = [];
const extension = path.join(output, 'dock-extension');
const profile = path.join(artifacts, `profile-${Date.now()}`);
const context = await chromium.launchPersistentContext(profile, {
  executablePath,
  channel: 'chromium',
  headless: true,
  viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const watch = (page) => {
  page.on('pageerror', error => errors.push(error.message));
};
context.on('page', watch);
context.pages().forEach(watch);
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Mail integration fixture</title><style>
body{margin:0;background:#f5f7fb;font:14px Arial;color:#314746}header{height:80px;display:flex;align-items:center;gap:28px;padding:0 32px}header strong{width:160px}form[role=search]{width:520px;height:44px;border-radius:24px;background:#e8eef7;display:flex;align-items:center;padding:0 20px;box-sizing:border-box}form input{border:0;background:none;width:100%;outline:none}main{margin:0 48px 0 216px;background:white;border-radius:14px;min-height:800px}.tools{min-height:50px;display:flex;align-items:center;gap:8px;padding:0 12px;color:#788781}.native-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}.native-actions button,.native-pagination button{border:0;background:none;width:28px;height:32px;color:inherit}.native-pagination{display:flex;align-items:center;gap:8px;margin-left:auto;white-space:nowrap;flex-shrink:0}table{width:100%;border-collapse:collapse;table-layout:fixed}td[role=tab]{height:56px;padding:0 18px;border-bottom:1px solid #e5e9ee;cursor:pointer;box-sizing:border-box;font-size:14px}td[role=tab]:first-child{color:#1a73e8;border-bottom:3px solid #1a73e8}.content{padding:28px;max-width:650px}.content p{line-height:1.7;color:#788781}.content input{padding:12px;border:1px solid #d2dcd6;border-radius:7px}
</style></head><body><header><strong>Mail UI fixture</strong><form role="search"><input aria-label="Search mail" placeholder="Search mail"></form></header><main role="main"><div class="tools" role="toolbar" aria-label="Mail toolbar"><div class="native-actions"><button aria-label="Select messages">□</button><button aria-label="Refresh inbox">↻</button><button aria-label="More mail actions">⋮</button></div><div class="native-pagination"><span>1–50 of 731</span><button aria-label="Previous page">‹</button><button aria-label="Next page">›</button></div></div><table role="tablist" aria-label="Native categories"><tbody><tr><td role="tab" tabindex="0" aria-selected="true" data-native="primary">Primary</td><td role="tab" tabindex="0" data-native="promotions">Promotions</td><td role="tab" tabindex="0" data-native="social">Social</td><td role="tab" tabindex="0" data-native="updates">Updates</td></tr></tbody></table><div class="content"><h1>A normal email page</h1><p>This is a synthetic page at a supported mail URL. The built Chrome extension adds custom category tabs without a sidebar. No live mailbox is loaded.</p><input aria-label="Host input" placeholder="Host keyboard events stay separate"><p>The host page remains available when Dock is closed.</p></div></main><script>
window.hostKeys=0;window.nativeClicks=0;window.nativeMouseDowns=0;
document.addEventListener('keydown',()=>window.hostKeys++);
document.querySelectorAll('[data-native]').forEach(tab=>tab.addEventListener('click',()=>window.nativeClicks++));
// Gmail's tab strip can cancel mouse defaults, including focus and select opening.
document.querySelector('[aria-label="Native categories"] tr').addEventListener('mousedown',event=>{window.nativeMouseDowns++;event.preventDefault();});
window.originalPrimary=document.querySelector('[data-native=primary]');
</script></body></html>`;
await context.route('https://**/*', async route => {
  const request = route.request();
  if (request.isNavigationRequest() && /^(mail\.google\.com|outlook\.office\.com|outlook\.live\.com|outlook\.office365\.com|outlook\.cloud\.microsoft)$/.test(new URL(request.url()).hostname)) {
    await route.fulfill({ contentType: 'text/html', body: fixture });
  } else {
    unexpectedRequests.push(request.url());
    await route.abort();
  }
});

async function assertNoHorizontalScroll(page) {
  const result = await page.locator('dock-inbox-tabs').evaluate(host => {
    const nodes = [host, ...host.shadowRoot.querySelectorAll('*')];
    return nodes.filter(node => node instanceof HTMLElement && getComputedStyle(node).display !== 'contents')
      .some(node => ['auto','scroll'].includes(getComputedStyle(node).overflowX) && node.scrollWidth > node.clientWidth + 1);
  });
  expect(result).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function fillCategory(page, title, description) {
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill(description);
  await page.getByRole('button', { name: 'Save category', exact: true }).click();
}

async function clickWithMouse(page, locator) {
  await expect(locator).toBeVisible();
  const target = await locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    let hit = document.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    return { x, y, reachable: hit === element || element.contains(hit), hit: hit?.tagName ?? null };
  });
  expect(target.reachable, `Mouse must reach the control, not ${target.hit}`).toBe(true);
  await page.mouse.click(target.x, target.y);
}

async function selectWithMouseAndKeyboard(page, label, value) {
  const select = page.getByRole('combobox', { name: label, exact: true });
  const index = await select.evaluate((element, selectedValue) => [...element.options].findIndex(option => option.value === selectedValue), value);
  expect(index).toBeGreaterThanOrEqual(0);
  await clickWithMouse(page, select);
  await expect(select).toBeFocused();
  await page.keyboard.press('Home');
  for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(select).toHaveValue(value);
}

async function typeWithMouseAndKeyboard(page, label, value) {
  const input = page.getByRole('textbox', { name: label, exact: true });
  await clickWithMouse(page, input);
  await expect(input).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(value);
  await expect(input).toHaveValue(value);
}

const legacyCategories = [
  ['customs', 'Customs', 'Customs paperwork and duties.', 'package', '#b9e4d0'],
  ['shipping', 'Shipping', 'Shipment tracking, deliveries and freight.', 'truck', '#fcdee8'],
  ['purchasing', 'Purchase orders', 'Purchase orders and approvals.', 'shopping-bag', '#ffe6c7'],
  ['vendors', 'Vendors', 'Supplier quotes and introductions.', 'users', '#fcdee8'],
  ['invoices', 'Invoices', 'Invoices, bills and payment requests.', 'receipt', '#b9e4d0'],
].map(([id, title, description, icon, color]) => ({ id, title, description, icon, color }));

async function assertEditorSurface(page, anchor, below = true) {
  const editor = page.getByRole('dialog', { name: /^(Edit|Create) category$/ });
  await expect(editor).toBeVisible();
  const panel = await editor.boundingBox();
  const trigger = await anchor.boundingBox();
  const viewport = page.viewportSize();
  expect(panel.width).toBeLessThanOrEqual(340);
  expect(panel.height).toBeLessThanOrEqual(360);
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.y).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width);
  expect(panel.y + panel.height).toBeLessThanOrEqual(viewport.height);
  if (below) {
    expect(panel.y).toBeGreaterThanOrEqual(trigger.y + trigger.height);
    expect(panel.y - trigger.y - trigger.height).toBeLessThanOrEqual(10);
    expect(Math.abs(panel.x - Math.min(Math.max(8, trigger.x), viewport.width - panel.width - 8))).toBeLessThanOrEqual(2);
  }
  expect(await editor.evaluate(element => ({
    modal: element.matches(':modal'),
    ariaModal: element.getAttribute('aria-modal') === 'true',
    horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
    backdrop: getComputedStyle(element, '::backdrop').backgroundColor,
  }))).toEqual({ modal: false, ariaModal: false, horizontalOverflow: false, backdrop: 'rgba(0, 0, 0, 0)' });
  const icon = await page.getByRole('combobox', { name: 'Icon', exact: true }).boundingBox();
  const color = await page.getByRole('combobox', { name: 'Color', exact: true }).boundingBox();
  const name = await page.getByRole('textbox', { name: 'Name', exact: true }).boundingBox();
  const description = await page.getByRole('textbox', { name: 'Description', exact: true }).boundingBox();
  expect(Math.abs(icon.y - color.y)).toBeLessThanOrEqual(2);
  expect(icon.x + icon.width).toBeLessThanOrEqual(color.x);
  expect(name.y).toBeGreaterThan(icon.y + icon.height);
  expect(description.y).toBeGreaterThan(name.y + name.height);
  for (const control of [icon, color, name, description]) {
    expect(control.x).toBeGreaterThanOrEqual(panel.x);
    expect(control.x + control.width).toBeLessThanOrEqual(panel.x + panel.width);
    expect(control.y + control.height).toBeLessThanOrEqual(panel.y + panel.height);
  }
}

async function checkStarterCategories(page, worker) {
  await expect(page.getByRole('tab', { name: 'Edit Me!', exact: true })).toHaveCount(3);
  await expect(page.locator('.dock-native-tab-item')).toHaveCount(4);
  const initial = await worker.evaluate(async () => (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'].categories);
  expect(initial).toHaveLength(3);
  expect(new Set(initial.map(category => category.id)).size).toBe(3);
  expect(initial.every(category => category.title === 'Edit Me!' && category.description === '')).toBe(true);
  await expect(page.getByRole('tab', { name: 'Uncategorized', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Categorize emails', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Edit Me!', exact: true })).toHaveCount(3);
  const firstStarter = page.getByRole('tab', { name: 'Edit Me!', exact: true }).first();
  await clickWithMouse(page, firstStarter);
  await assertEditorSurface(page, firstStarter);
  await expect(page.getByRole('dialog', { name: 'Connect Dock', exact: true })).toHaveCount(0);
  await clickWithMouse(page, page.getByRole('button', { name: 'Cancel', exact: true }));
  await expect(page.getByRole('dialog', { name: 'Edit category', exact: true })).toBeHidden();

  // Each identical starter remains independently editable and keeps its original ID.
  for (const [index, category] of legacyCategories.slice(0, 3).entries()) {
    const tab = page.getByRole('tab', { name: 'Edit Me!', exact: true }).first();
    await tab.focus();
    await page.getByRole('button', { name: 'Edit Edit Me!', exact: true }).first().click();
    await assertEditorSurface(page, tab);
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('');
    if (index === 0) {
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Outside click draft');
      await page.getByRole('textbox', { name: 'Search mail', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Edit category', exact: true })).toBeHidden();
      await expect(page.getByRole('textbox', { name: 'Search mail', exact: true })).toBeFocused();
      await expect(tab).toHaveCount(1);
      await tab.press('F2');
      await page.getByRole('textbox', { name: 'Name', exact: true }).press('Escape');
      await expect(page.getByRole('dialog', { name: 'Edit category', exact: true })).toBeHidden();
      await expect(tab).toBeFocused();
      await tab.press('F2');
    }
    if (index === 0) {
      await selectWithMouseAndKeyboard(page, 'Icon', category.icon);
      await selectWithMouseAndKeyboard(page, 'Color', category.color);
      await typeWithMouseAndKeyboard(page, 'Name', category.title);
      await typeWithMouseAndKeyboard(page, 'Description', category.description);
      await page.screenshot({ path: path.join(artifacts, `category-editor-${index + 1}.png`) });
      await clickWithMouse(page, page.getByRole('button', { name: 'Save category', exact: true }));
      expect(await page.evaluate(() => window.nativeMouseDowns)).toBe(0);
    } else {
      await page.getByRole('combobox', { name: 'Icon', exact: true }).selectOption(category.icon);
      await page.getByRole('combobox', { name: 'Color', exact: true }).selectOption(category.color);
      await page.screenshot({ path: path.join(artifacts, `category-editor-${index + 1}.png`) });
      await fillCategory(page, category.title, category.description);
    }
    await expect(page.getByRole('tab', { name: category.title, exact: true })).toBeVisible();
    expect((await worker.evaluate(async () => (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'].categories))[index]).toEqual({ ...category, id: initial[index].id });
  }
  await page.reload();
  for (const category of legacyCategories.slice(0, 3)) {
    const tab = page.getByRole('tab', { name: category.title, exact: true });
    await tab.press('F2');
    await assertEditorSurface(page, tab);
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(category.title);
    await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(category.description);
    await expect(page.getByRole('combobox', { name: 'Icon', exact: true })).toHaveValue(category.icon);
    await expect(page.getByRole('combobox', { name: 'Color', exact: true })).toHaveValue(category.color);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
}

async function checkDemoDeletion(page) {
  await page.getByRole('tab', { name: 'Shipping', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Shipping', exact: true }).click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('tab', { name: 'Uncategorized', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Open sample message:/ })).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Shipping', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Uncategorized', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Open sample message:/ })).toHaveCount(2);
}

async function checkExistingCategoryEdits(page, worker) {
  const customs = page.getByRole('tab', { name: 'Customs', exact: true });
  const shipping = page.getByRole('tab', { name: 'Shipping', exact: true });
  await customs.press('F2');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Unsaved first category');
  await shipping.hover();
  await page.getByRole('button', { name: 'Edit Shipping', exact: true }).click();
  await assertEditorSurface(page, shipping);
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Shipping');
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(legacyCategories[1].description);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(customs).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Unsaved first category', exact: true })).toHaveCount(0);

  await worker.evaluate(async () => {
    const state = (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'];
    state.categories[0].color = '#b6cff5';
    await chrome.storage.local.set({ 'dock-gmail-v2': state });
  });
  await page.reload();
  await customs.press('F2');
  await expect(page.getByRole('combobox', { name: 'Color', exact: true })).toHaveValue('#b6cff5');
  await fillCategory(page, 'Customs archive', 'Updated customs paperwork and archived duty notices.');
  await expect(page.getByRole('tab', { name: 'Customs archive', exact: true })).toBeVisible();
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'].categories[0])).toMatchObject({ title: 'Customs archive', description: 'Updated customs paperwork and archived duty notices.', color: '#b6cff5' });
  await page.reload();
  await page.getByRole('tab', { name: 'Customs archive', exact: true }).press('F2');
  await expect(page.getByRole('combobox', { name: 'Color', exact: true })).toHaveValue('#b6cff5');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
}

try {
  const page = await context.newPage();
  await page.goto('https://mail.google.com/mail/u/0/#inbox');
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await checkStarterCategories(page, worker);
  await checkExistingCategoryEdits(page, worker);
  await expect(page.getByRole('tab', { name: 'Shipping', exact: true })).toBeVisible();
  await expect(page.locator('.dock-extension-panel, .dock-launcher, .dock-app')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Urgent', exact: true })).toHaveCount(0);
  await expect(page.locator('.dock-native-tab-item')).toHaveCount(4);
  await expect(page.locator('.dock-native-tab svg')).toHaveCount(4);
  const nativeStyle = await page.locator('[data-native=promotions]').evaluate(el => ({ font: getComputedStyle(el).fontFamily, size: getComputedStyle(el).fontSize }));
  const customStyle = await page.getByRole('tab', { name: 'Shipping', exact: true }).evaluate(el => ({ font: getComputedStyle(el).fontFamily, size: getComputedStyle(el).fontSize }));
  expect(customStyle).toEqual(nativeStyle);
  await expect(page.getByRole('slider', { name: 'Days back' })).toHaveValue('30');
  await expect(page.getByRole('button', { name: 'Categorize emails', exact: true })).toBeDisabled();
  await expect(page.locator('dock-inbox-controls')).toHaveAttribute('data-dock-toolbar-placement', 'native');
  await expect(page.getByText(/^Only messages currently in Inbox/)).toHaveCount(0);
  await expect(page.getByText(/^Categorization account:/)).toHaveCount(0);
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'].run)).toBeUndefined();
  await assertNoHorizontalScroll(page);
  await page.screenshot({ path: path.join(artifacts, 'gmail-extension.png') });
  await page.getByRole('tab', { name: 'Shipping', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Connect Dock', exact: true })).toBeVisible();
  await expect(page.locator('.dock-inbox-view')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Open sample message:/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('[data-native=promotions]').click();
  await expect(page.locator('.content')).toBeVisible();
  expect(await page.evaluate(() => window.nativeClicks)).toBe(1);
  expect(await page.evaluate(() => window.nativeMouseDowns)).toBe(1);
  expect(await page.evaluate(() => window.originalPrimary === document.querySelector('[data-native=primary]'))).toBe(true);

  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Create category' })).toBeVisible();
  await assertEditorSurface(page, page.getByRole('button', { name: 'Add category', exact: true }));
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  await fillCategory(page, 'Quality control', 'Inspection results, defects, quality assurance and corrective actions.');
  await expect(page.getByRole('tab', { name: 'Quality control', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Quality control', exact: true }).focus();
  await expect(page.getByRole('button', { name: 'Edit Quality control', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Quality control', exact: true }).press('F2');
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(/Inspection results/);
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Shipping');
  await page.getByRole('button', { name: 'Save category', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('already exists');
  await fillCategory(page, 'Inspection', 'Quality inspection findings and corrective action reports.');
  await expect(page.getByRole('tab', { name: 'Inspection', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.hostKeys)).toBe(0);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Inspection', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Inspection', exact: true }).focus();
  await page.getByRole('button', { name: 'Delete Inspection', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Delete Inspection?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'No', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'No', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Inspection', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Inspection', exact: true }).click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Inspection', exact: true })).toHaveCount(0);
  await expect(page.locator('.dock-inbox-view')).toBeHidden();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Inspection', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Shipping', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Connect Gmail', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Authorize Gmail', exact: true })).toBeEnabled();
  await page.getByText('Import or export categories', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Category JSON', exact: true }).fill(JSON.stringify({ version: 1, categories: [{ id: 'legacy-projects', name: 'Projects', color: 'teal' }], messages: [] }));
  await page.getByRole('button', { name: 'Import categories', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Category JSON', exact: true })).toHaveValue('');
  const exported = JSON.parse(await page.getByRole('textbox', { name: 'Copy your category definitions', exact: true }).inputValue());
  expect(exported.categories.find(category => category.id === 'legacy-projects').description).toBe('');
  expect(JSON.stringify(exported)).not.toMatch(/helperToken|labelId|accountEmail/);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Projects', exact: true })).toBeVisible();
  await expect(page.getByText('Name and describe your categories to begin.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Projects', exact: true }).press('F2');
  await fillCategory(page, 'Projects', 'Project decisions, status reports, milestones and planning discussions.');

  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Discarded draft');
  await page.getByRole('textbox', { name: 'Name', exact: true }).press('Escape');
  await expect(page.getByRole('button', { name: 'Add category', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Discarded draft', exact: true })).toHaveCount(0);
  await page.getByRole('slider', { name: 'Days back' }).fill('45');
  await page.getByRole('slider', { name: 'Days back' }).press('ArrowRight');
  await expect.poll(async () => await worker.evaluate(async () => (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'].daysBack)).toBe(46);
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'].run)).toBeUndefined();

  // A previous browser lifetime is paused, never resumed automatically by mounting or polling.
  await worker.evaluate(async () => {
    const state = (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'];
    const now = Date.now();
    state.accountEmail = 'fixture@example.test';
    state.run = { id: 'fixture-interrupted', owner: 'previous-worker', status: 'running', phase: 'categorizing', daysBack: 30, total: 2, processed: 1, succeeded: 1, failed: 0, skipped: 0, startedAt: now, updatedAt: now, cutoff: now - 30 * 86400000, before: now, query: 'fixture', discovered: true, categories: state.categories, accountEmail: state.accountEmail, items: [{ id: 'fixture-a', status: 'succeeded' }, { id: 'fixture-b', status: 'pending' }] };
    await chrome.storage.local.set({ 'dock-gmail-v2': state });
  });
  await page.reload();
  await expect(page.getByText(/^Categorization account:/)).toHaveCount(0);
  await expect(page.getByText('1 labeled · 1/2 processed · Stopped', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Resume unfinished', exact: true })).toBeChecked();
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'].run.status)).toBe('paused');
  await expect(page.getByRole('button', { name: 'Categorize emails', exact: true })).toBeDisabled();
  await worker.evaluate(async () => { const state = (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2']; delete state.run; delete state.accountEmail; await chrome.storage.local.set({ 'dock-gmail-v2': state }); });
  await page.reload();

  await page.evaluate(() => {
    const old = document.querySelector('[aria-label="Native categories"]');
    const replacement = document.createElement('div');
    replacement.setAttribute('role', 'tablist'); replacement.setAttribute('aria-label', 'Native categories');
    replacement.innerHTML = '<table><tbody><tr><td role="tab" data-native="primary">Primary</td><td role="tab" data-native="promotions">Promotions</td><td role="tab" data-native="social">Social</td><td role="tab" data-native="updates">Updates</td></tr></tbody></table>';
    old.replaceWith(replacement);
    const row = document.createElement('div'); row.className = 'native-mail-row'; row.innerHTML = '<span class="native-gmail-label" style="background:#c9daf8;color:#434343">Dock/Shipping</span> Fixture categorized message'; document.querySelector('.content').append(row);
  });
  await expect(page.locator('dock-inbox-tabs')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: 'Shipping', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Shipping', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Connect Dock', exact: true })).toBeVisible();
  await expect(page.locator('.dock-inbox-view')).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.evaluate(() => { location.hash = '#all'; });
  await expect(page.locator('dock-inbox-tabs')).toHaveCount(0);
  await expect(page.locator('.dock-inbox-view')).toBeHidden();
  await expect(page.locator('.native-gmail-label')).toHaveCount(1);
  expect(await page.locator('.native-gmail-label').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(201, 218, 248)');
  await page.evaluate(() => { location.hash = '#inbox'; });
  await expect(page.locator('dock-inbox-tabs')).toHaveCount(1);
  await expect(page.locator('.native-gmail-label')).toHaveCount(1);
  await page.evaluate(() => {
    window.savedNativeTabs = document.querySelector('[aria-label="Native categories"]');
    location.hash = '#label/Dock%2FShipping';
    window.savedNativeTabs.remove();
  });
  await expect(page.getByRole('tab', { name: 'Shipping', exact: true })).toBeVisible();
  await expect(page.locator('dock-inbox-tabs')).toHaveCount(1);
  await expect(page.locator('dock-inbox-controls')).toHaveCount(1);
  await expect(page.locator('.content')).toBeVisible();
  await expect(page.locator('.dock-inbox-view')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#label/Dock%2FShipping/p2'; });
  await expect(page.getByRole('tab', { name: 'Shipping', exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = '#label/Dock%2FShipping/thread-fixture'; });
  await expect(page.locator('dock-inbox-tabs, dock-inbox-controls')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'Shipping', exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('.content').before(window.savedNativeTabs);
    location.hash = '#inbox';
  });
  await expect(page.locator('dock-inbox-tabs')).toHaveCount(1);
  const freshLabel = await context.newPage();
  await freshLabel.goto('https://mail.google.com/mail/u/0/#label/Dock%2FShipping/p2');
  await expect(freshLabel.getByRole('tab', { name: 'Shipping', exact: true })).toBeVisible();
  await expect(freshLabel.locator('.content')).toBeVisible();
  await expect(freshLabel.locator('.dock-inbox-view')).toHaveCount(0);
  await freshLabel.close();
  await page.setViewportSize({ width: 850, height: 900 });
  await expect(page.getByRole('button', { name: 'Add category', exact: true })).toBeVisible();
  await assertNoHorizontalScroll(page);

  for (const host of ['outlook.office.com', 'outlook.live.com', 'outlook.office365.com', 'outlook.cloud.microsoft']) {
    const outlook = await context.newPage();
    await outlook.goto(`https://${host}/mail/`);
    if (host === 'outlook.office.com') {
      await expect(outlook.getByRole('tab', { name: 'Edit Me!', exact: true })).toHaveCount(3);
      await worker.evaluate(async categories => { await chrome.storage.local.set({ 'dock-demo-v1': { version: 2, categories } }); }, legacyCategories);
      await outlook.reload();
    }
    await expect(outlook.getByRole('tab', { name: 'Shipping', exact: true })).toBeVisible();
    await expect(outlook.getByText('Outlook demo · account connection not available', { exact: true })).toBeVisible();
    await outlook.getByRole('tab', { name: 'Shipping', exact: true }).click();
    await expect(outlook.getByRole('button', { name: /^Open sample message:/ })).toHaveCount(2);
    await outlook.getByRole('button', { name: 'Back to inbox', exact: true }).click();
    await expect(outlook.locator('.dock-inbox-view')).toBeHidden();
    if (host === 'outlook.cloud.microsoft') await checkDemoDeletion(outlook);
    await outlook.close();
  }

  const preview = await context.newPage();
  await preview.goto(pathToFileURL(path.join(output, 'Dock-preview.html')).href);
  await preview.setViewportSize({ width: 1600, height: 1000 });
  await expect(preview.getByRole('tab', { name: 'Edit Me!', exact: true })).toHaveCount(3);
  await preview.evaluate(categories => { localStorage.setItem('dock-preview-v1', JSON.stringify({ version: 2, categories })); }, legacyCategories);
  await preview.reload();
  await expect(preview.getByRole('tab', { name: 'Shipping', exact: true })).toBeVisible();
  await expect(preview.locator('.prototype-panel, .mail-dock-launcher, .dock-app')).toHaveCount(0);
  await preview.screenshot({ path: path.join(output, 'Dock-preview.png'), fullPage: true });
  await preview.getByRole('tab', { name: 'Shipping', exact: true }).click();
  await expect(preview.getByRole('button', { name: /^Open sample message:/ })).toHaveCount(2);
  await preview.getByRole('button', { name: /^Open sample message:/ }).first().click();
  await preview.screenshot({ path: path.join(artifacts, 'preview-detail.png'), fullPage: true });
  await preview.getByRole('tab', { name: 'Primary', exact: true }).click();
  await expect(preview.locator('.mail-backdrop')).toBeVisible();
  await preview.getByRole('button', { name: 'Add category', exact: true }).click();
  await fillCategory(preview, 'Quality', 'Quality reports, inspections and corrective actions.');
  await expect(preview.getByRole('tab', { name: 'Quality', exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Categorize emails', exact: true }).click();
  await expect(preview.getByText(/^Preview only\./)).toBeVisible();
  await preview.getByRole('button', { name: 'Outlook', exact: true }).click();
  await expect(preview.locator('.mail-scene')).toHaveClass(/outlook/);
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(preview.getByRole('button', { name: 'Add category', exact: true })).toBeVisible();
  expect(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const mobileAdd = preview.getByRole('button', { name: 'Add category', exact: true });
  await mobileAdd.click();
  await assertEditorSurface(preview, mobileAdd, false);
  await preview.screenshot({ path: path.join(artifacts, 'category-editor-mobile.png'), fullPage: true });
  await preview.getByRole('textbox', { name: 'Name', exact: true }).press('Escape');
  await expect(mobileAdd).toBeFocused();
  await preview.screenshot({ path: path.join(artifacts, 'preview-mobile.png'), fullPage: true });
  await checkDemoDeletion(preview);
  expect(errors).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
  console.log(JSON.stringify({ result: 'PASS', checks: ['Three independent Edit Me! starters with blank descriptions persist on fresh installs', 'Compact nonmodal editor below each category and Add button, with Icon and Color before Name and Description', 'Outside click dismissal, Escape focus return, and all four edited fields persist after reload', 'Gmail typography, icons, manual-only controls, default 30-day scope, no sidebar', 'native tab DOM and interactions preserved; SPA replacement and routes', 'native label overview, pagination, fresh page and Back preserve controls without a custom message list', 'conversation routes hide controls; disconnected category click opens Connection', 'F2, duplicate validation, cancel, and stable saved categories', 'delete Yes/No confirmation and persistence', 'legacy JSON migration and credential-free definition export', 'interrupted run pauses on reload with saved progress and resume option in the toolbar', 'native colored-label fixture preserved without duplicate chips on Inbox/All Mail routes (not a live Gmail validation)', 'four Outlook hosts remain sample-only and retain saved legacy categories', 'standalone preview controls and editor stay inside a narrow viewport', 'no page errors or unexpected network requests'] }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ pageErrors: errors, unexpectedRequests }, null, 2));
  throw error;
} finally {
  await context.close();
}
