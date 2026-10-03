import { seedStoredState } from './extension-fixture.mjs';
/** Geometry regression for Dock controls in clipped Gmail category wrappers.
 * Loads only the built extension and synthetic pages. No live mailbox or OAuth.
 */
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const project = process.cwd();
const extension = path.resolve(project, process.env.DOCK_EXTENSION_PATH || 'outputs/dock-extension');
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
const artifacts = path.join(project, 'test-results', 'clipping', `${manifest.version}-${Date.now()}`);
await mkdir(artifacts, { recursive: true });
const issues = [];
const reports = [];
const pageErrors = [];
const unexpectedRequests = [];
const nestedToolbarOnly = process.argv.includes('--nested-toolbar');

function fixture(outerRole, mixedContent = false, directMode = '', rowCount = 7) {
  const tableRole = outerRole ? '' : 'role="tablist" aria-label="Native categories"';
  const outer = outerRole ? 'role="tablist" aria-label="Native categories"' : '';
  const markup = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clipped Gmail layout fixture</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f8fc;font:14px Arial,sans-serif;color:#202124}header{height:72px;padding:24px}main{margin:0 24px 0 190px;height:calc(100vh - 96px);min-height:600px;background:#fff;overflow:auto}.tools{min-height:48px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid #eee}.native-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}.native-actions button,.native-pagination button{width:28px;height:32px;border:0;background:none;font:16px Arial;color:#5f6368}.native-pagination{display:flex;align-items:center;gap:8px;margin-left:auto;white-space:nowrap;flex-shrink:0}
#tab-envelope{height:58px;max-height:58px;overflow:hidden;width:100%;position:relative}#tab-frame{height:58px;max-height:58px;overflow:hidden;width:100%}.native-table{width:100%;height:58px;border-collapse:collapse;table-layout:fixed}.native-table td{height:58px;padding:0 18px;border-bottom:1px solid #dadce0;cursor:pointer;font:14px Arial,sans-serif}.native-table td[aria-selected=true]{color:#0b57d0;border-bottom:3px solid #0b57d0}.native-table td:focus-visible{outline:2px solid #0b57d0;outline-offset:-3px}.fixture-mail-row{height:46px;padding:12px 20px;border-bottom:1px solid #e0e3e7;position:relative;background:#f2f6fc;display:flex;align-items:center;gap:20px}.fixture-mail-row strong{width:170px;flex-shrink:0}.fixture-mail-row span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fixture-mail-row button{margin-left:auto;border:0;background:transparent;cursor:pointer}.fixture-summary{padding:20px;color:#5f6368;font-size:12px}@media(max-width:900px){main{margin-left:24px}}
</style></head><body><header>Synthetic Gmail geometry fixture · no real email</header><main role="main"><div class="tools" role="toolbar" aria-label="Mail toolbar"><div class="native-actions"><button aria-label="Select messages">□</button><button aria-label="Refresh inbox">↻</button><button aria-label="More mail actions">⋮</button></div><div class="native-pagination"><span>1–50 of 731</span><button aria-label="Previous page">‹</button><button aria-label="Next page">›</button></div></div><div id="tab-envelope"><div id="tab-frame" ${outer}><table class="native-table" ${tableRole}><tbody><tr><td role="tab" tabindex="0" aria-selected="true" data-native="primary">Primary</td><td role="tab" tabindex="0" aria-selected="false" data-native="promotions">Promotions</td><td role="tab" tabindex="0" aria-selected="false" data-native="social">Social</td><td role="tab" tabindex="0" aria-selected="false" data-native="updates">Updates</td></tr></tbody></table></div></div><div id="fixture-mail-list">${Array.from({length:rowCount},(_,i)=>`<div class="fixture-mail-row"><strong>Fixture sender ${i+1}</strong><span>Unchanged native mail row ${i+1} · test-only content</span><button aria-label="Open fixture row ${i+1}">Open</button></div>`).join('')}</div><p class="fixture-summary">The native mail list must stay below all category controls.</p></main><script>
window.fixtureClicks={primary:0,promotions:0,social:0,updates:0};window.fixtureRowClicks=0;window.originalPrimary=document.querySelector('[data-native=primary]');window.originalNativeActions=document.querySelector('.native-actions');window.nativeActionClicks=0;document.querySelector('[aria-label="Refresh inbox"]').addEventListener('click',()=>window.nativeActionClicks++);
for(const tab of document.querySelectorAll('[data-native]'))tab.addEventListener('click',()=>{window.fixtureClicks[tab.dataset.native]++;for(const item of document.querySelectorAll('[data-native]'))item.setAttribute('aria-selected',String(item===tab));});
for(const row of document.querySelectorAll('.fixture-mail-row button'))row.addEventListener('click',()=>window.fixtureRowClicks++);
</script></body></html>`;
  if (directMode) {
    const nativeStart = markup.indexOf('<div id="tab-envelope">');
    const nativeEnd = markup.indexOf('<div id="fixture-mail-list">');
    const native = directMode === 'table'
      ? markup.slice(nativeStart, nativeEnd).match(/<table[\s\S]*?<\/table>/)[0].replace('<table ', '<table id="direct-native" style="display:block;max-height:58px;overflow:hidden" ')
      : `<div id="direct-native" role="tablist" aria-label="Native categories" style="display:flex;height:58px;max-height:58px;overflow:hidden">${['primary','promotions','social','updates'].map((name,index)=>`<button type="button" role="tab" data-native="${name}" aria-selected="${index===0}" style="font:14px Arial;padding:0 18px;height:58px;width:156px;flex-shrink:0;background:white;border:0;border-bottom:1px solid #dadce0;cursor:pointer">${name[0].toUpperCase()+name.slice(1)}</button>`).join('')}</div>`;
    return markup.slice(0, nativeStart) + native + markup.slice(nativeEnd);
  }
  return mixedContent ? markup.replace('<div id="tab-envelope">', '<div id="mixed-envelope" style="height:500px;overflow:hidden"><div id="tab-envelope">').replace('<p class="fixture-summary">', '</div><p class="fixture-summary">') : markup;
}

function nestedToolbarFixture(scrollOnLoad = false) {
  const base = fixture(false, false, '', 40);
  const toolbarStart = base.indexOf('<div class="tools"');
  const toolbarEnd = base.indexOf('<div id="tab-envelope">');
  const toolbar = '<div gh="tm" class="D E G-atb tools"><div class="nH aqK"><div gh="mtb" class="Cq aqL native-actions"><div class="native-action-wrap"><button aria-label="Select messages">□</button></div><div class="native-action-wrap"><button aria-label="Refresh inbox">↻</button></div><div class="native-action-wrap"><button aria-label="More mail actions">⋮</button></div></div><div class="Cr aqJ native-pagination"><span>1–50 of 731</span><button aria-label="Previous page">‹</button><button aria-label="Next page">›</button></div><div class="dJ" aria-hidden="true"></div></div></div>';
  const styles = 'header{height:64px}.tools[gh=tm]{position:sticky;top:0;z-index:2;background:white;display:flex;align-items:center;height:48px;min-height:48px;padding:0 16px;border:0;gap:0}.tools[gh=tm]::before{content:"";position:absolute;inset:0;z-index:auto;pointer-events:auto}.native-actions button,.native-pagination{position:relative;z-index:0}.aqK{display:flex;align-items:center;width:100%;height:20px;min-height:20px}.native-actions[gh=mtb]{width:140px;min-width:140px;height:20px;min-height:20px}.native-action-wrap{display:flex;align-items:center;height:20px;min-height:20px}.native-actions button,.native-pagination button{height:20px;min-height:20px}.native-pagination.Cr{width:154px;min-width:154px;height:20px;min-height:20px;margin-left:auto;gap:4px}.dJ{width:0;height:0;visibility:hidden}';
  const markup = (base.slice(0, toolbarStart) + toolbar + base.slice(toolbarEnd)).replace('</style>', `${styles}</style>`);
  return scrollOnLoad ? markup.replace('</script>', 'document.querySelector("main").scrollTop=800;window.fixtureInitialScroll=document.querySelector("main").scrollTop;window.fixtureDockPresentAtInitialScroll=!!document.querySelector("dock-inbox-controls");</script>') : markup;
}

const context = await chromium.launchPersistentContext(path.join(artifacts, 'profile'), {
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
  ignoreDefaultArgs: ['--hide-scrollbars'],
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
await context.route(/^https?:\/\//, async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.isNavigationRequest() && url.hostname === 'mail.google.com') {
    await route.fulfill({ contentType: 'text/html', body: url.searchParams.has('nestedToolbar') ? nestedToolbarFixture(url.searchParams.has('scrollOnLoad')) : fixture(url.searchParams.has('outerRole'), url.searchParams.has('mixed'), url.searchParams.get('direct') || '') });
  } else { unexpectedRequests.push(request.url()); await route.abort(); }
});

async function settle(page) {
  await expect(page.getByRole('slider', { name: 'Days back', exact: true })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Gmail usage', exact: true })).toBeEnabled();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}


async function inspectControl(locator) {
  return await locator.evaluate(element => {
    const shape = rectangle => ({ left: rectangle.left, top: rectangle.top, right: rectangle.right, bottom: rectangle.bottom, width: rectangle.width, height: rectangle.height });
    const describe = item => item ? `${item.tagName.toLowerCase()}${item.id ? `#${item.id}` : ''}${item.classList?.length ? `.${[...item.classList].join('.')}` : ''}` : null;
    const bounds = element.getBoundingClientRect();
    const insetX = Math.min(4, bounds.width / 4), insetY = Math.min(4, bounds.height / 4);
    const points = [[bounds.left + bounds.width / 2, bounds.top + bounds.height / 2], [bounds.left + insetX, bounds.top + insetY], [bounds.right - insetX, bounds.top + insetY], [bounds.left + insetX, bounds.bottom - insetY], [bounds.right - insetX, bounds.bottom - insetY]];
    const hits = points.map(([x,y]) => {
      let hit = document.elementFromPoint(x,y);
      const chain = [];
      while (hit?.shadowRoot) {
        chain.push(describe(hit));
        const next = hit.shadowRoot.elementFromPoint(x,y);
        if (!next || next === hit) break;
        hit = next;
      }
      const ownTabItem = element.getAttribute('role') === 'tab' ? element.closest('.dock-native-tab-item') : null;
      return { x, y, hit: describe(hit), shadowHosts: chain, reachesControl: hit === element || element.contains(hit) || Boolean(ownTabItem?.contains(hit)) };
    });
    const ancestors = [];
    let parent = element.parentElement || element.getRootNode().host;
    while (parent instanceof Element) {
      const style = getComputedStyle(parent);
      const rectangle = parent.getBoundingClientRect();
      const edge = { left: rectangle.left + parent.clientLeft, top: rectangle.top + parent.clientTop, right: rectangle.left + parent.clientLeft + parent.clientWidth, bottom: rectangle.top + parent.clientTop + parent.clientHeight };
      const clipsX = ['hidden','clip','scroll','auto'].includes(style.overflowX);
      const clipsY = ['hidden','clip','scroll','auto'].includes(style.overflowY);
      const cutX = clipsX && (bounds.left < edge.left - 1 || bounds.right > edge.right + 1);
      const cutY = clipsY && (bounds.top < edge.top - 1 || bounds.bottom > edge.bottom + 1);
      if (clipsX || clipsY) ancestors.push({ element: describe(parent), bounds: shape(rectangle), overflowX: style.overflowX, overflowY: style.overflowY, cutX, cutY });
      parent = parent.parentElement || parent.getRootNode().host;
    }
    return { element: describe(element), bounds: shape(bounds), hits, clippingAncestors: ancestors, clipped: ancestors.some(item => item.cutX || item.cutY), fullHit: hits.every(hit => hit.reachesControl) };
  });
}

async function assess(page, scenario) {
  await settle(page);
  await page.mouse.move(0, 0);
  await expect(page.getByText(/^Only messages currently in Inbox/)).toHaveCount(0);
  await expect(page.getByText(/^Categorization account:/)).toHaveCount(0);
  const controls = {};
  const targets = [
    ['days', page.getByRole('slider', { name: 'Days back', exact: true })],
    ['connect', page.getByRole('button', { name: /^(Connect Gmail|Connection)$/ })],
    ['categorize', page.getByRole('button', { name: 'Categorize emails', exact: true })],
    ['add-category', page.getByRole('button', { name: 'Add category', exact: true })],
  ];
  if (await page.locator('.tools').count()) {
    targets.push(['native-refresh', page.getByRole('button', { name: 'Refresh inbox', exact: true })]);
    targets.push(['native-next', page.getByRole('button', { name: 'Next page', exact: true })]);
  }
  for (const tab of await page.locator('.dock-native-tab').all()) targets.push([`tab:${await tab.getAttribute('aria-label')}`, tab]);
  expect(targets.filter(([name]) => name.startsWith('tab:')).length).toBe(6);
  for (const [name, locator] of targets) {
    await locator.scrollIntoViewIfNeeded();
    controls[name] = await inspectControl(locator);
    if (!controls[name].fullHit) issues.push(`${scenario}: ${name} misses one or more center/corner hit tests`);
    if (controls[name].clipped) issues.push(`${scenario}: ${name} crosses a clipping ancestor`);
  }
  const layout = await page.evaluate(() => {
    const roots = [...document.querySelectorAll('*')].filter(element => element.shadowRoot).map(element => element.shadowRoot);
    const dockElements = roots.flatMap(root => [...root.querySelectorAll('.dock-workspace-controls, .dock-controls-row, .dock-notice, .dock-run-status')]);
    const bottoms = dockElements.map(element => element.getBoundingClientRect().bottom);
    const mail = document.querySelector('#fixture-mail-list').getBoundingClientRect();
    const toolbar = document.querySelector('.tools');
    const controlHost = document.querySelector('dock-inbox-controls');
    const controlBounds = controlHost.getBoundingClientRect();
    const primary = document.querySelector('[data-native=primary]').getBoundingClientRect();
    const actions = document.querySelector('.native-actions')?.getBoundingClientRect();
    const pagination = document.querySelector('.native-pagination')?.getBoundingClientRect();
    const tabsHost = document.querySelector('dock-inbox-tabs');
    const customTabs = tabsHost.shadowRoot.querySelector('.dock-native-tabs');
    const nativeSlot = tabsHost.closest('[data-dock-gmail-layout="native"]');
    const categoryScrollport = nativeSlot?.parentElement ?? customTabs;
    const categoryControls = [...(nativeSlot ? categoryScrollport.querySelectorAll('[role="tab"]') : []), ...customTabs.querySelectorAll('.dock-native-tab, .dock-native-add')];
    const categoryTops = categoryControls.map(element => element.getBoundingClientRect().top);
    const previousScroll = categoryScrollport.scrollLeft;
    categoryScrollport.scrollLeft = categoryScrollport.scrollWidth;
    const categoryCanScroll = categoryScrollport.scrollLeft > 0;
    categoryScrollport.scrollLeft = previousScroll;
    const categoryStyle = getComputedStyle(categoryScrollport);
    const categories = { oneRow: Math.max(...categoryTops) - Math.min(...categoryTops) <= 2, overflowX: categoryStyle.overflowX, scrollbarWidth: categoryStyle.scrollbarWidth, overflows: categoryScrollport.scrollWidth > categoryScrollport.clientWidth + 1, canScroll: categoryCanScroll };
    return { categories, controlsBottom: Math.max(...bottoms), mailTop: mail.top, mailBottom: mail.bottom, pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, primaryUnchanged: window.originalPrimary === document.querySelector('[data-native=primary]'), nativeActionsUnchanged: !toolbar || window.originalNativeActions === document.querySelector('.native-actions'), placement: controlHost.dataset.dockToolbarPlacement, controlsInsideToolbar: Boolean(toolbar?.contains(controlHost)), controlsAboveTabs: controlBounds.bottom <= primary.top + 1, actionsOverlap: actions ? actions.right > controlBounds.left + 1 : false, paginationOverlap: pagination ? controlBounds.right > pagination.left + 1 : false, wrappers: ['tab-envelope','tab-frame','direct-native'].filter(id => document.getElementById(id)).map(id => { const element=document.getElementById(id), style=getComputedStyle(element), box=element.getBoundingClientRect(); return { id, top:box.top, bottom:box.bottom, height:box.height, cssHeight:style.height, maxHeight:style.maxHeight, overflow:style.overflow }; }) };
  });
  if (!layout.categories.oneRow) issues.push(`${scenario}: category tabs or Add wrap to another row`);
  if (!['auto', 'scroll'].includes(layout.categories.overflowX)) issues.push(`${scenario}: category strip does not allow horizontal scrolling`);
  if (layout.categories.scrollbarWidth !== 'thin') issues.push(`${scenario}: category strip must use a thin scrollbar`);
  if (layout.categories.overflows && !layout.categories.canScroll) issues.push(`${scenario}: overflowing categories cannot scroll horizontally`);
  if (scenario.endsWith('-narrow') && !layout.categories.overflows) issues.push(`${scenario}: narrow category strip must overflow locally`);
  if (layout.mailTop < layout.controlsBottom - 1) issues.push(`${scenario}: mail starts at ${layout.mailTop} before controls end at ${layout.controlsBottom}`);
  if (layout.pageWidth > layout.viewportWidth + 1) issues.push(`${scenario}: horizontal page overflow`);
  if (!layout.primaryUnchanged) issues.push(`${scenario}: primary native node was replaced`);
  if (!layout.nativeActionsUnchanged) issues.push(`${scenario}: native action nodes were replaced`);
  if (!layout.controlsAboveTabs) issues.push(`${scenario}: controls must stay above category tabs`);
  if (layout.placement === 'native' && !layout.controlsInsideToolbar) issues.push(`${scenario}: controls are outside the native toolbar`);
  if (layout.actionsOverlap || layout.paginationOverlap) issues.push(`${scenario}: controls overlap native actions or pagination`);
  if (layout.viewportWidth >= 1200 && controls['native-refresh']) {
    const center = control => control.bounds.top + control.bounds.height / 2;
    if (Math.abs(center(controls.categorize) - center(controls['native-refresh'])) > 2 || Math.abs(center(controls.days) - center(controls['native-refresh'])) > 2) issues.push(`${scenario}: categorize, days, and native actions do not share a horizontal row`);
  }
  reports.push({ scenario, controls, layout });
  await page.screenshot({ path: path.join(artifacts, `${scenario}.png`), fullPage: true });
  return controls;
}

async function checkStickyToolbar(page, scenario, scrollTop) {
  const host = await page.locator('dock-inbox-controls').elementHandle();
  const scrolling = await page.locator('main').evaluate((main, target) => {
    main.scrollTop = target;
    return { scrollHeight: main.scrollHeight, clientHeight: main.clientHeight, scrollTop: main.scrollTop };
  }, scrollTop);
  expect(scrolling.scrollHeight).toBeGreaterThan(scrolling.clientHeight + 800);
  expect(scrolling.scrollTop).toBe(scrollTop);
  await settle(page);
  await expect(page.locator('.aqK > dock-inbox-controls')).toHaveAttribute('data-dock-toolbar-placement', 'native');
  expect(await host.evaluate(element => element === document.querySelector('dock-inbox-controls')), 'Scrolling must preserve the controls host').toBe(true);
  const targets = [
    ['categorize', page.getByRole('button', { name: 'Categorize emails', exact: true })],
    ['days', page.getByRole('slider', { name: 'Days back', exact: true })],
    ['connection', page.getByRole('button', { name: /^(Connect Gmail|Connection)$/ })],
    ['native-refresh', page.getByRole('button', { name: 'Refresh inbox', exact: true })],
  ];
  const controls = {};
  for (const [name, locator] of targets) {
    await expect(locator).toBeVisible();
    controls[name] = await inspectControl(locator);
    expect(controls[name].fullHit, `${scenario}: ${name} must receive pointer input`).toBe(true);
    expect(controls[name].clipped, `${scenario}: ${name} must stay inside the scrollport`).toBe(false);
  }
  const nativeClicks = await page.evaluate(() => window.nativeActionClicks);
  await page.getByRole('button', { name: 'Refresh inbox', exact: true }).click();
  expect(await page.evaluate(() => window.nativeActionClicks)).toBe(nativeClicks + 1);
  const resume = page.getByRole('checkbox', { name: 'Resume unfinished', exact: true });
  const hasResume = await resume.count() > 0;
  if (hasResume) await resume.uncheck();
  const days = page.getByRole('slider', { name: 'Days back', exact: true });
  const previousDays = await days.inputValue();
  const midpoint = await days.evaluate(input => (Number(input.min) + Number(input.max)) / 2);
  await days.click({ position: { x: Number(previousDays) < midpoint ? 70 : 10, y: 8 } });
  await expect(days).not.toHaveValue(previousDays);
  if (hasResume) await resume.check();
  await page.getByRole('button', { name: /^(Connect Gmail|Connection)$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Connect Dock', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Connect Dock', exact: true })).toBeHidden();
  expect(await host.evaluate(element => element === document.querySelector('dock-inbox-controls')), 'Toolbar interaction must preserve the controls host').toBe(true);
  const scrollAfterDialog = await page.locator('main').evaluate(main => main.scrollTop);
  expect(scrollAfterDialog, 'Closing Connection must preserve the inbox scroll position').toBe(scrollTop);
  reports.push({ scenario, scrolling, controls, scrollAfterDialog });
  await page.screenshot({ path: path.join(artifacts, `${scenario}.png`), fullPage: true });
}

async function checkNestedGmailToolbar() {
  const page = await context.newPage();
  await page.goto('https://mail.google.com/mail/u/0/?nestedToolbar=1#inbox');
  await expect(page.getByRole('tab', { name: 'Edit Me!', exact: true })).toHaveCount(3);
  // Retain the wider layout and migration coverage with saved category definitions.
  await seedStoredState(context, page, async () => {
    const state = (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'];
    state.categories = [['customs', 'Customs'], ['shipping', 'Shipping'], ['purchasing', 'Purchase orders'], ['vendors', 'Vendors'], ['invoices', 'Invoices']].map(([id, title]) => ({ id, title, description: `${title} fixture messages.`, icon: 'tag', color: '#c9daf8' }));
    await chrome.storage.local.set({ 'dock-gmail-v2': state });
  });
  await page.reload();
  await writeFile(path.join(artifacts, 'nested-toolbar-fixture.html'), nestedToolbarFixture());
  await assess(page, 'nested-toolbar-wide');
  await expect(page.locator('.aqK > dock-inbox-controls')).toHaveAttribute('data-dock-toolbar-placement', 'native');
  await expect(page.locator('.aqK > dock-inbox-controls + .Cr')).toHaveCount(1);
  const nativeShell = await page.locator('[gh=tm]').evaluate(shell => {
    const actions = shell.querySelector('[gh=mtb]').getBoundingClientRect();
    const hidden = shell.querySelector('.dJ').getBoundingClientRect();
    const bounds = shell.getBoundingClientRect();
    return { top: bounds.top, height: bounds.height, actionWidth: actions.width, actionCenter: actions.top + actions.height / 2, hiddenWidth: hidden.width, hiddenHeight: hidden.height };
  });
  expect(nativeShell).toEqual({ top: 64, height: 48, actionWidth: 140, actionCenter: 88, hiddenWidth: 0, hiddenHeight: 0 });
  reports.push({ scenario: 'nested-toolbar-native-shell', nativeShell });
  await page.getByRole('button', { name: 'Refresh inbox', exact: true }).click();
  expect(await page.evaluate(() => window.nativeActionClicks)).toBe(1);
  await checkStickyToolbar(page, 'nested-toolbar-clicks-at-top', 0);
  await checkStickyToolbar(page, 'nested-toolbar-scrolled-clicks', 800);
  await checkStickyToolbar(page, 'nested-toolbar-returned-to-top', 0);

  const scrolledPage = await context.newPage();
  await scrolledPage.goto('https://mail.google.com/mail/u/0/?nestedToolbar=1&scrollOnLoad=1#inbox');
  await settle(scrolledPage);
  expect(await scrolledPage.evaluate(() => ({ scroll: window.fixtureInitialScroll, dockPresent: window.fixtureDockPresentAtInitialScroll }))).toEqual({ scroll: 800, dockPresent: false });
  await checkStickyToolbar(scrolledPage, 'nested-toolbar-initially-scrolled', 800);
  await scrolledPage.close();

  const error = '3 email(s) failed. Completed labels are saved; retry resumes only unfinished emails. Email body exceeds 60,000 characters. This email was left unchanged.';
  await seedStoredState(context, page, async error => {
    const state = (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'];
    const now = Date.now();
    state.accountEmail = 'nested-toolbar@example.test';
    state.run = { id: 'nested-toolbar-run', owner: 'previous-fixture-worker', status: 'failed', phase: 'categorizing', daysBack: 30, total: 267, processed: 264, succeeded: 264, failed: 3, skipped: 0, startedAt: now, updatedAt: now, cutoff: now - 30 * 86400000, before: now, query: 'fixture', discovered: true, categories: state.categories, accountEmail: state.accountEmail, items: Array.from({ length: 267 }, (_, index) => ({ id: `fixture-${index}`, status: index < 264 ? 'succeeded' : 'failed', ...(index < 264 ? {} : { subject: `Synthetic failed email ${index}`, sender: 'Fixture <sender@example.test>', error: `Synthetic message ${index} failed. The completed labels stay saved. ${'Full error details wrap inside the dropdown. '.repeat(8)}` }) })), error };
    await chrome.storage.local.set({ 'dock-gmail-v2': state });
  }, error);
  await page.setViewportSize({ width: 1920, height: 1000 });
  // A harmless settings response delivers the synthetic saved run. Reloading a
  // fake connected account would request Gmail label metadata on mount.
  await page.getByRole('slider', { name: 'Days back', exact: true }).fill('31');
  await page.getByRole('slider', { name: 'Days back', exact: true }).press('ArrowRight');
  // This synthetic account has no token. Dismiss its boot error before measuring the saved-run error.
  await expect(page.getByRole('tab', { name: 'Shipping', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('264 labeled · 264/267 processed · Interrupted · 3 failed', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Resume unfinished', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: '3 errors', exact: true })).toBeVisible();
  await assess(page, 'nested-toolbar-saved-run-wide');
  const statusAlignment = await page.locator('dock-inbox-controls').evaluate(host => {
    const native = document.querySelector('[gh=mtb]').getBoundingClientRect();
    const nativeCenter = native.top + native.height / 2;
    const centers = ['.dock-primary', '.dock-days', '.dock-run-status', '.dock-errors-trigger'].map(selector => {
      const bounds = host.shadowRoot.querySelector(selector).getBoundingClientRect();
      return { selector, center: bounds.top + bounds.height / 2 };
    });
    return { nativeCenter, centers, aligned: centers.every(item => Math.abs(item.center - nativeCenter) <= 2) };
  });
  expect(statusAlignment.aligned, 'Nested Gmail controls, status, and error must share the native action row').toBe(true);
  reports.push({ scenario: 'nested-toolbar-status-alignment', statusAlignment });
  await checkStickyToolbar(page, 'nested-toolbar-saved-run-scrolled', 800);
  await page.locator('main').evaluate(main => { main.scrollTop = 0; });
  await settle(page);
  await page.setViewportSize({ width: 800, height: 1100 });
  await assess(page, 'nested-toolbar-saved-run-narrow');
  await expect(page.locator('.aqK > dock-inbox-controls')).toHaveAttribute('data-dock-toolbar-placement', 'native');
  const errorTrigger = page.getByRole('button', { name: '3 errors', exact: true });
  await errorTrigger.click();
  const errorDialog = page.getByRole('dialog', { name: 'Email errors', exact: true });
  await expect(errorDialog).toBeVisible();
  await expect(errorDialog.getByRole('listitem')).toHaveCount(3);
  await expect(errorDialog.getByText(error, { exact: true })).toBeVisible();
  await expect(errorDialog.getByRole('link').first()).toHaveAttribute('href', 'https://mail.google.com/mail/u/?authuser=nested-toolbar%40example.test#all/fixture-264');
  const popoverGeometry = await errorDialog.evaluate(element => {
    const box = element.getBoundingClientRect();
    let hit = document.elementFromPoint(box.left + 20, box.top + 20);
    while (hit?.shadowRoot) { const next = hit.shadowRoot.elementFromPoint(box.left + 20, box.top + 20); if (!next || next === hit) break; hit = next; }
    return { nativePopover: element.matches(':popover-open'), hit: element === hit || element.contains(hit), withinViewport: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, noHorizontalOverflow: element.scrollWidth <= element.clientWidth + 1 };
  });
  expect(popoverGeometry).toEqual({ nativePopover: true, hit: true, withinViewport: true, noHorizontalOverflow: true });
  reports.push({ scenario: 'nested-toolbar-error-popover-shadow-root', popoverGeometry });
  await page.screenshot({ path: path.join(artifacts, 'nested-toolbar-error-popover.png'), fullPage: true });
  await errorDialog.press('Escape');
  await expect(errorDialog).not.toBeVisible();
  await expect(errorTrigger).toBeFocused();
  const editTrigger = page.getByRole('button', { name: 'Edit Shipping', exact: true });
  await editTrigger.focus();
  await editTrigger.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Edit category', exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
  expect(await editor.evaluate(element => element.matches(':popover-open'))).toBe(true);
  await editor.press('Escape');
  await expect(editor).not.toBeVisible();
  await expect(editTrigger).toBeFocused();
  await page.evaluate(() => { location.hash = '#all'; });
  await expect(page.locator('dock-inbox-controls')).toHaveCount(0);
  expect(await page.locator('[gh=tm]').evaluate(element => element.getBoundingClientRect().height)).toBe(48);
  expect(await page.locator('.aqK').evaluate(element => element.getBoundingClientRect().height)).toBe(20);
  await page.evaluate(() => { location.hash = '#inbox'; });
  await expect(page.locator('.aqK > dock-inbox-controls')).toHaveAttribute('data-dock-toolbar-placement', 'native');
  await assess(page, 'nested-toolbar-route-restored');
  await seedStoredState(context, page, async () => {
    const state = (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'];
    delete state.run;
    delete state.accountEmail;
    await chrome.storage.local.set({ 'dock-gmail-v2': state });
  });
  await page.close();
}

try {
  await checkNestedGmailToolbar();
  for (const { outerRole, mixedContent } of nestedToolbarOnly ? [] : [{ outerRole: false, mixedContent: false }, { outerRole: true, mixedContent: false }, { outerRole: false, mixedContent: true }]) {
    const page = await context.newPage();
    const label = mixedContent ? 'mixed-content' : outerRole ? 'outer-tablist' : 'table-tablist';
    await page.goto(`https://mail.google.com/mail/u/0/${mixedContent ? '?mixed=1' : outerRole ? '?outerRole=1' : ''}#inbox`);
    await writeFile(path.join(artifacts, `${label}-fixture.html`), fixture(outerRole, mixedContent));
    const controls = await assess(page, `${label}-wide`);
    await expect(page.locator('dock-inbox-controls')).toHaveAttribute('data-dock-toolbar-placement', 'native');
    await expect(page.getByRole('button', { name: 'Categorize emails', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Refresh inbox', exact: true }).click();
    expect(await page.evaluate(() => window.nativeActionClicks)).toBe(1);
    // No categorize or OAuth action: native handlers and harmless settings prove pointer routing.
    for (const name of ['promotions','social','updates','primary']) {
      await page.locator(`[data-native=${name}]`).click();
      expect(await page.evaluate(key => window.fixtureClicks[key], name)).toBe(1);
    }
    if (controls.connect.fullHit) {
      await page.getByRole('button', { name: 'Connect Gmail', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Connect Dock', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page.getByRole('slider', { name: 'Days back', exact: true }).click({ position: { x: 70, y: 8 } });
      expect(Number(await page.getByRole('slider', { name: 'Days back', exact: true }).inputValue())).toBeGreaterThan(30);
      await page.getByRole('tab', { name: 'Shipping', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Connect Dock', exact: true })).toBeVisible();
      await expect(page.locator('.dock-inbox-view')).toHaveCount(0);
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page.locator('[data-native=primary]').click();
      await expect(page.locator('#fixture-mail-list')).toBeVisible();
    }
    await page.setViewportSize({ width: 800, height: 1100 });
    await assess(page, `${label}-narrow`);
    await page.getByRole('button', { name: 'Open fixture row 1', exact: true }).click();
    expect(await page.evaluate(() => window.fixtureRowClicks)).toBe(1);
    await page.evaluate(() => { location.hash = '#category/promotions'; });
    await assess(page, `${label}-native-route`);
    await page.evaluate(() => { location.hash = '#all'; });
    await expect(page.getByRole('slider', { name: 'Days back', exact: true })).toHaveCount(0);
    expect(await page.locator('#tab-envelope').evaluate(element => getComputedStyle(element).height)).toBe('58px');
    expect(await page.locator('#tab-frame').evaluate(element => getComputedStyle(element).maxHeight)).toBe('58px');
    await page.evaluate(() => { location.hash = '#inbox'; });
    await assess(page, `${label}-route-restored`);
    await page.evaluate(html => {
      const replacement = new DOMParser().parseFromString(html, 'text/html').getElementById('tab-envelope');
      document.getElementById('tab-envelope').replaceWith(document.adoptNode(replacement));
      window.originalPrimary = document.querySelector('[data-native=primary]');
      for (const tab of document.querySelectorAll('[data-native]')) tab.addEventListener('click', () => { window.fixtureClicks[tab.dataset.native]++; });
    }, fixture(outerRole));
    await assess(page, `${label}-wrapper-replaced`);
    const nativeBefore = await page.evaluate(() => window.fixtureClicks.updates);
    await page.locator('[data-native=updates]').click();
    expect(await page.evaluate(() => window.fixtureClicks.updates)).toBe(nativeBefore + 1);
    await page.locator('dock-inbox-tabs').evaluate(element => element.remove());
    await expect(page.getByRole('tab', { name: 'Shipping', exact: true })).toBeAttached();
    await assess(page, `${label}-tabs-host-repaired`);
    await page.locator('dock-inbox-controls').evaluate(element => element.remove());
    await expect(page.getByRole('button', { name: 'Connect Gmail', exact: true })).toBeAttached();
    await assess(page, `${label}-controls-host-repaired`);
    if (!outerRole && !mixedContent) {
      await page.evaluate(html => {
        const toolbar = new DOMParser().parseFromString(html, 'text/html').querySelector('.tools');
        document.querySelector('.tools').replaceWith(document.adoptNode(toolbar));
        window.originalNativeActions = document.querySelector('.native-actions');
        document.querySelector('[aria-label="Refresh inbox"]').addEventListener('click', () => window.nativeActionClicks++);
      }, fixture(false));
      await assess(page, `${label}-toolbar-replaced`);
      await expect(page.locator('dock-inbox-controls')).toHaveCount(1);
      await expect(page.locator('dock-inbox-controls')).toHaveAttribute('data-dock-toolbar-placement', 'native');
      await page.getByRole('button', { name: 'Refresh inbox', exact: true }).click();
      expect(await page.evaluate(() => window.nativeActionClicks)).toBe(2);
      await page.locator('.tools').evaluate(element => element.remove());
      await expect(page.locator('dock-inbox-controls')).toHaveAttribute('data-dock-toolbar-placement', 'fallback');
      await assess(page, `${label}-missing-toolbar-fallback`);
      await page.evaluate(html => {
        const toolbar = new DOMParser().parseFromString(html, 'text/html').querySelector('.tools');
        document.querySelector('main').prepend(document.adoptNode(toolbar));
        window.originalNativeActions = document.querySelector('.native-actions');
      }, fixture(false));
      await expect(page.locator('dock-inbox-controls')).toHaveAttribute('data-dock-toolbar-placement', 'native');
      await assess(page, `${label}-toolbar-restored`);
    }
    if (mixedContent) {
      expect(await page.locator('#mixed-envelope').evaluate(element => getComputedStyle(element).height)).toBe('500px');
      expect(await page.locator('#mixed-envelope').evaluate(element => getComputedStyle(element).overflow)).toBe('hidden');
      await seedStoredState(context, page, async () => {
        const state = (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'];
        const now = Date.now();
        state.accountEmail = 'clipping-fixture@example.test';
        state.run = { id: 'clipping-run', owner: 'previous-fixture-worker', status: 'paused', phase: 'categorizing', daysBack: 30, total: 2, processed: 1, succeeded: 1, failed: 0, skipped: 0, startedAt: now, updatedAt: now, cutoff: now - 30 * 86400000, before: now, query: 'fixture', discovered: true, categories: state.categories, accountEmail: state.accountEmail, items: [{ id: 'fixture-a', status: 'succeeded' }, { id: 'fixture-b', status: 'pending' }], error: 'Fixture paused run. No real mail was read.' };
        await chrome.storage.local.set({ 'dock-gmail-v2': state });
      });
      await page.getByRole('slider', { name: 'Days back', exact: true }).fill('31');
      await page.getByRole('slider', { name: 'Days back', exact: true }).press('ArrowRight');
      await expect(page.getByRole('tab', { name: 'Shipping', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Connection', exact: true }).click();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(page.getByText(/^Categorization account:/)).toHaveCount(0);
      await expect(page.getByText('1 labeled · 1/2 processed · Stopped', { exact: true })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: 'Resume unfinished', exact: true })).toBeChecked();
      // Connection replaces Connect Gmail once an account is present; this harmless text state is still synthetic.
      await settle(page);
      const statusReport = await page.locator('.dock-run-status').evaluate(element => {
        const box = element.getBoundingClientRect();
        const point = { x: box.left + 10, y: box.top + 8 };
        let hit = document.elementFromPoint(point.x, point.y);
        while (hit?.shadowRoot) { const next = hit.shadowRoot.elementFromPoint(point.x, point.y); if (!next || next === hit) break; hit = next; }
        return { bottom: box.bottom, mailTop: document.querySelector('#fixture-mail-list').getBoundingClientRect().top, hit: element === hit || element.contains(hit) };
      });
      if (!statusReport.hit || statusReport.mailTop < statusReport.bottom - 1) issues.push(`${label}-status: saved run status is clipped or overlaps mail`);
      reports.push({ scenario: `${label}-saved-run-status`, statusReport });
      await page.screenshot({ path: path.join(artifacts, `${label}-saved-run-status.png`), fullPage: true });
      await page.setViewportSize({ width: 1920, height: 1000 });
      await settle(page);
      const savedToolbar = await page.locator('dock-inbox-controls').evaluate(host => {
        const root = host.shadowRoot;
        const names = ['.dock-primary', '.dock-days', '.dock-run-status', '.dock-errors-trigger'];
        const bounds = names.map(name => { const box = root.querySelector(name).getBoundingClientRect(); return { name, top: box.top, bottom: box.bottom, center: box.top + box.height / 2 }; });
        const native = document.querySelector('.native-actions').getBoundingClientRect();
        const nativeCenter = native.top + native.height / 2;
        return { bounds, nativeCenter, aligned: bounds.every(box => Math.abs(box.center - nativeCenter) <= 2) };
      });
      if (!savedToolbar.aligned) issues.push(`${label}-saved-run-wide: controls, status, error, and native actions do not share a horizontal row`);
      await expect(page.getByRole('button', { name: '1 error', exact: true })).toBeVisible();
      reports.push({ scenario: `${label}-saved-run-wide`, savedToolbar });
      await page.screenshot({ path: path.join(artifacts, `${label}-saved-run-wide.png`), fullPage: true });
      await seedStoredState(context, page, async () => {
        const state = (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'];
        delete state.run;
        delete state.accountEmail;
        await chrome.storage.local.set({ 'dock-gmail-v2': state });
      });
    }
    await page.close();
  }
  for (const directMode of nestedToolbarOnly ? [] : ['table','div']) {
    const page = await context.newPage();
    await page.goto(`https://mail.google.com/mail/u/0/?direct=${directMode}#inbox`);
    await writeFile(path.join(artifacts, `direct-${directMode}-fixture.html`), fixture(false, false, directMode));
    await assess(page, `direct-${directMode}-wide`);
    await page.setViewportSize({width:800,height:1100});
    await assess(page, `direct-${directMode}-narrow`);
    await page.getByRole('tab', {name:'Shipping',exact:true}).click();
    await expect(page.getByRole('dialog', {name:'Connect Dock',exact:true})).toBeVisible();
    await expect(page.locator('.dock-inbox-view')).toHaveCount(0);
    await page.getByRole('button', {name:'Done',exact:true}).click();
    await page.locator('[data-native=promotions]').click();
    expect(await page.evaluate(()=>window.fixtureClicks.promotions)).toBe(1);
    await expect(page.locator('#fixture-mail-list')).toBeVisible();
    await page.evaluate(()=>{location.hash='#all';});
    await expect(page.getByRole('slider',{name:'Days back',exact:true})).toHaveCount(0);
    expect(await page.locator('#direct-native').evaluate(element=>getComputedStyle(element).maxHeight)).toBe('58px');
    await page.evaluate(()=>{location.hash='#inbox';});
    await assess(page, `direct-${directMode}-route-restored`);
    await page.close();
  }
  if (pageErrors.length) issues.push(...pageErrors.map(error => `page error: ${error}`));
  if (unexpectedRequests.length) issues.push(...unexpectedRequests.map(url => `unexpected network: ${url}`));
} catch (error) {
  issues.push(error instanceof Error ? error.message : String(error));
} finally {
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ version: manifest.version, result: issues.length ? 'FAIL' : 'PASS', issues, pageErrors, unexpectedRequests, reports }, null, 2));
  await context.close();
}
console.log(JSON.stringify({ version: manifest.version, result: issues.length ? 'FAIL' : 'PASS', issues, artifacts, scenarios: reports.length }, null, 2));
expect(issues, 'Gmail controls must remain fully visible and reachable through clipping wrappers').toEqual([]);
