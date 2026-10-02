/** Geometry regression for Dock controls in clipped Gmail category wrappers.
 * Loads only the built extension and synthetic pages. No live mailbox or OAuth.
 */
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const project = process.cwd();
const extension = path.resolve(project, 'outputs/dock-extension');
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
const artifacts = path.join(project, 'test-results', 'clipping', `${manifest.version}-${Date.now()}`);
await mkdir(artifacts, { recursive: true });
const issues = [];
const reports = [];
const pageErrors = [];
const unexpectedRequests = [];

function fixture(outerRole, mixedContent = false, directMode = '') {
  const tableRole = outerRole ? '' : 'role="tablist" aria-label="Native categories"';
  const outer = outerRole ? 'role="tablist" aria-label="Native categories"' : '';
  const markup = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clipped Gmail layout fixture</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f8fc;font:14px Arial,sans-serif;color:#202124}header{height:72px;padding:24px}main{margin:0 24px 0 190px;height:calc(100vh - 96px);min-height:600px;background:#fff;overflow:auto}.tools{height:48px;padding:15px 18px;border-bottom:1px solid #eee}
#tab-envelope{height:58px;max-height:58px;overflow:hidden;width:100%;position:relative}#tab-frame{height:58px;max-height:58px;overflow:hidden;width:100%}.native-table{width:100%;height:58px;border-collapse:collapse;table-layout:fixed}.native-table td{height:58px;padding:0 18px;border-bottom:1px solid #dadce0;cursor:pointer;font:14px Arial,sans-serif}.native-table td[aria-selected=true]{color:#0b57d0;border-bottom:3px solid #0b57d0}.native-table td:focus-visible{outline:2px solid #0b57d0;outline-offset:-3px}.fixture-mail-row{height:46px;padding:12px 20px;border-bottom:1px solid #e0e3e7;position:relative;background:#f2f6fc;display:flex;align-items:center;gap:20px}.fixture-mail-row strong{width:170px;flex-shrink:0}.fixture-mail-row span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fixture-mail-row button{margin-left:auto;border:0;background:transparent;cursor:pointer}.fixture-summary{padding:20px;color:#5f6368;font-size:12px}@media(max-width:900px){main{margin-left:24px}}
</style></head><body><header>Synthetic Gmail geometry fixture · no real email</header><main role="main"><div class="tools">□　↻　⋮</div><div id="tab-envelope"><div id="tab-frame" ${outer}><table class="native-table" ${tableRole}><tbody><tr><td role="tab" tabindex="0" aria-selected="true" data-native="primary">Primary</td><td role="tab" tabindex="0" aria-selected="false" data-native="promotions">Promotions</td><td role="tab" tabindex="0" aria-selected="false" data-native="social">Social</td><td role="tab" tabindex="0" aria-selected="false" data-native="updates">Updates</td></tr></tbody></table></div></div><div id="fixture-mail-list">${Array.from({length:7},(_,i)=>`<div class="fixture-mail-row"><strong>Fixture sender ${i+1}</strong><span>Unchanged native mail row ${i+1} · test-only content</span><button aria-label="Open fixture row ${i+1}">Open</button></div>`).join('')}</div><p class="fixture-summary">The native mail list must stay below all category controls.</p></main><script>
window.fixtureClicks={primary:0,promotions:0,social:0,updates:0};window.fixtureRowClicks=0;window.originalPrimary=document.querySelector('[data-native=primary]');
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

const context = await chromium.launchPersistentContext(path.join(artifacts, 'profile'), {
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
await context.route(/^https?:\/\//, async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.isNavigationRequest() && url.hostname === 'mail.google.com') {
    await route.fulfill({ contentType: 'text/html', body: fixture(url.searchParams.has('outerRole'), url.searchParams.has('mixed'), url.searchParams.get('direct') || '') });
  } else { unexpectedRequests.push(request.url()); await route.abort(); }
});

async function settle(page) {
  await expect(page.getByRole('slider', { name: 'Days back', exact: true })).toBeAttached();
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
  const controls = {};
  const targets = [
    ['days', page.getByRole('slider', { name: 'Days back', exact: true })],
    ['connect', page.getByRole('button', { name: 'Connect Gmail', exact: true })],
    ['categorize', page.getByRole('button', { name: 'Categorize emails', exact: true })],
    ['add-category', page.getByRole('button', { name: 'Add category', exact: true })],
  ];
  for (const tab of await page.locator('.dock-native-tab').all()) targets.push([`tab:${await tab.getAttribute('aria-label')}`, tab]);
  expect(targets.filter(([name]) => name.startsWith('tab:')).length).toBe(6);
  for (const [name, locator] of targets) {
    controls[name] = await inspectControl(locator);
    if (!controls[name].fullHit) issues.push(`${scenario}: ${name} misses one or more center/corner hit tests`);
    if (controls[name].clipped) issues.push(`${scenario}: ${name} crosses a clipping ancestor`);
  }
  const layout = await page.evaluate(() => {
    const roots = [...document.querySelectorAll('*')].filter(element => element.shadowRoot).map(element => element.shadowRoot);
    const dockElements = roots.flatMap(root => [...root.querySelectorAll('.dock-workspace-controls, .dock-controls-row, .dock-scope, .dock-notice, .dock-account, .dock-run-status')]);
    const bottoms = dockElements.map(element => element.getBoundingClientRect().bottom);
    const mail = document.querySelector('#fixture-mail-list').getBoundingClientRect();
    return { controlsBottom: Math.max(...bottoms), mailTop: mail.top, mailBottom: mail.bottom, pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, primaryUnchanged: window.originalPrimary === document.querySelector('[data-native=primary]'), wrappers: ['tab-envelope','tab-frame','direct-native'].filter(id => document.getElementById(id)).map(id => { const element=document.getElementById(id), style=getComputedStyle(element), box=element.getBoundingClientRect(); return { id, top:box.top, bottom:box.bottom, height:box.height, cssHeight:style.height, maxHeight:style.maxHeight, overflow:style.overflow }; }) };
  });
  if (layout.mailTop < layout.controlsBottom - 1) issues.push(`${scenario}: mail starts at ${layout.mailTop} before controls end at ${layout.controlsBottom}`);
  if (layout.pageWidth > layout.viewportWidth + 1) issues.push(`${scenario}: horizontal page overflow`);
  if (!layout.primaryUnchanged) issues.push(`${scenario}: primary native node was replaced`);
  reports.push({ scenario, controls, layout });
  await page.screenshot({ path: path.join(artifacts, `${scenario}.png`), fullPage: true });
  return controls;
}

try {
  for (const { outerRole, mixedContent } of [{ outerRole: false, mixedContent: false }, { outerRole: true, mixedContent: false }, { outerRole: false, mixedContent: true }]) {
    const page = await context.newPage();
    const label = mixedContent ? 'mixed-content' : outerRole ? 'outer-tablist' : 'table-tablist';
    await page.goto(`https://mail.google.com/mail/u/0/${mixedContent ? '?mixed=1' : outerRole ? '?outerRole=1' : ''}#inbox`);
    await writeFile(path.join(artifacts, `${label}-fixture.html`), fixture(outerRole, mixedContent));
    const controls = await assess(page, `${label}-wide`);
    await expect(page.getByRole('button', { name: 'Categorize emails', exact: true })).toBeDisabled();
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
      const overlay = await page.locator('.dock-inbox-view').boundingBox();
      const latest = await inspectControl(page.getByRole('button', { name: 'Connect Gmail', exact: true }));
      if (overlay && overlay.y < latest.bounds.bottom - 1) issues.push(`${label}: custom view covers the toolbar`);
      await page.locator('[data-native=primary]').click();
      await expect(page.locator('.dock-inbox-view')).toBeHidden();
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
    if (mixedContent) {
      expect(await page.locator('#mixed-envelope').evaluate(element => getComputedStyle(element).height)).toBe('500px');
      expect(await page.locator('#mixed-envelope').evaluate(element => getComputedStyle(element).overflow)).toBe('hidden');
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      await worker.evaluate(async () => {
        const state = (await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2'];
        const now = Date.now();
        state.accountEmail = 'clipping-fixture@example.test';
        state.run = { id: 'clipping-run', owner: 'previous-fixture-worker', status: 'paused', phase: 'categorizing', daysBack: 30, total: 2, processed: 1, succeeded: 1, failed: 0, skipped: 0, startedAt: now, updatedAt: now, cutoff: now - 30 * 86400000, before: now, query: 'fixture', discovered: true, categories: state.categories, accountEmail: state.accountEmail, items: [{ id: 'fixture-a', status: 'succeeded' }, { id: 'fixture-b', status: 'pending' }], error: 'Fixture paused run. No real mail was read.' };
        await chrome.storage.local.set({ 'dock-gmail-v2': state });
      });
      await page.reload();
      await expect(page.getByText('Categorization account: clipping-fixture@example.test', { exact: true })).toBeVisible();
      // Connection replaces Connect Gmail once an account is present; this harmless text state is still synthetic.
      await settle(page);
      const statusReport = await page.locator('.dock-run-status').evaluate(element => {
        const box = element.getBoundingClientRect();
        const point = { x: box.left + 10, y: box.top + 8 };
        let hit = document.elementFromPoint(point.x, point.y);
        while (hit?.shadowRoot) { const next = hit.shadowRoot.elementFromPoint(point.x, point.y); if (!next || next === hit) break; hit = next; }
        return { bottom: box.bottom, mailTop: document.querySelector('#fixture-mail-list').getBoundingClientRect().top, hit: element === hit || element.contains(hit) };
      });
      if (!statusReport.hit || statusReport.mailTop < statusReport.bottom - 1) issues.push(`${label}-status: saved account/run notice is clipped or overlaps mail`);
      reports.push({ scenario: `${label}-saved-account-and-run`, statusReport });
      await page.screenshot({ path: path.join(artifacts, `${label}-saved-account-and-run.png`), fullPage: true });
    }
    await page.close();
  }
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => { const state=(await chrome.storage.local.get('dock-gmail-v2'))['dock-gmail-v2']; delete state.run; delete state.accountEmail; await chrome.storage.local.set({'dock-gmail-v2':state}); });
  for (const directMode of ['table','div']) {
    const page = await context.newPage();
    await page.goto(`https://mail.google.com/mail/u/0/?direct=${directMode}#inbox`);
    await writeFile(path.join(artifacts, `direct-${directMode}-fixture.html`), fixture(false, false, directMode));
    await assess(page, `direct-${directMode}-wide`);
    await page.setViewportSize({width:800,height:1100});
    await assess(page, `direct-${directMode}-narrow`);
    await page.getByRole('tab', {name:'Shipping',exact:true}).click();
    await expect(page.locator('.dock-inbox-view')).toBeVisible();
    await page.locator('[data-native=promotions]').click();
    expect(await page.evaluate(()=>window.fixtureClicks.promotions)).toBe(1);
    await expect(page.locator('.dock-inbox-view')).toBeHidden();
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
