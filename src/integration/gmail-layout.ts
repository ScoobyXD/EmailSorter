/**
 * Gmail page-chrome integration. Only layout, roles and geometry are inspected:
 * this module never reads message text, sender data, search values or bodies.
 * Gmail does not publish a stable DOM API; unrecognized layouts use an overview
 * fallback. Native tabs are kept in place so their listeners and state survive.
 */
import { getGmailLabelFromRoute } from './gmail-navigation';

export interface GmailLayoutOptions {
  /** Detached extension-owned element, optionally containing a shadow root. */
  tabsHost: HTMLElement;
  /** Controls share Gmail's action toolbar, outside the category strip. */
  controlsHost?: HTMLElement;
  /** Notifies the caller of native category clicks and Gmail route changes. */
  onNativeSelect?: () => void;
}

interface NativeTabs {
  list: HTMLElement;
  row: HTMLElement;
  items: HTMLElement[];
  tabs: HTMLElement[];
  table: HTMLTableElement | null;
}

interface NativeToolbar {
  row: HTMLElement;
  items: HTMLElement[];
  before: HTMLElement | null;
  wrappers: HTMLElement[];
}

interface StyleChange {
  value: string;
  priority: string;
  applied: string;
}

const OWNED = 'data-dock-gmail-layout';
const OWNED_SELECTOR = `[${OWNED}]`;
const INBOX_ROUTE = /^#inbox(?:\/p\d+)?(?:\?.*)?$/;
const CATEGORY_ROUTE = /^#category\/(?:primary|social|promotions|updates|forums)(?:\/p\d+)?(?:\?.*)?$/;

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false;
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function visibleMain(): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>('[role="main"]')]
    .find((element) => !element.closest('[role="dialog"], [role="complementary"]') && isVisible(element)) ?? null;
}

function directBranch(element: HTMLElement, parent: HTMLElement): HTMLElement | null {
  let branch: HTMLElement | null = element;
  while (branch && branch.parentElement !== parent) branch = branch.parentElement;
  return branch;
}

function tabBoundary(native: NativeTabs, main: HTMLElement): { branch: HTMLElement; wrappers: HTMLElement[]; safe: boolean } {
  // A tablist may be on the TR, TABLE, or a containing DIV. Never insert a
  // controls DIV into the table, or after a branch that also contains mail.
  let branch = native.table && native.table.contains(native.list) ? native.table : native.list;
  const wrappers: HTMLElement[] = [];
  if (native.table) {
    for (let node = native.table.parentElement; node && branch.contains(node); node = node.parentElement) wrappers.push(node);
  }
  for (let parent = branch.parentElement; parent && parent !== main; parent = branch.parentElement) {
    const otherContent = [...parent.children].some(child => child !== branch && child instanceof HTMLElement &&
      !child.matches(OWNED_SELECTOR) && isVisible(child));
    if (otherContent) break;
    branch = parent;
    if (!wrappers.includes(parent)) wrappers.push(parent);
  }
  // A mixed-content clipping ancestor cannot safely be expanded. In that
  // layout put the whole Dock row before its main branch instead.
  let safe = true;
  for (let parent = branch.parentElement; parent && parent !== main; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if ([style.overflowX, style.overflowY].some(value => value === 'hidden' || value === 'clip')) { safe = false; break; }
  }
  return { branch, wrappers, safe };
}

function findNativeTabs(main: HTMLElement): NativeTabs | null {
  for (const list of main.querySelectorAll<HTMLElement>('[role="tablist"]')) {
    if (!isVisible(list) || list.closest(`${OWNED_SELECTOR}, [role="dialog"], [role="complementary"]`)) continue;
    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')].filter((tab) =>
      tab.closest('[role="tablist"]') === list && !tab.closest(OWNED_SELECTOR) && isVisible(tab));
    if (tabs.length < 2 || tabs.length > 5) continue;
    const first = tabs[0]!.getBoundingClientRect();
    // Exclude vertical utility rails without using localized category names.
    if (list.getAttribute('aria-orientation') === 'vertical') continue;
    // Once attached, our responsive row may legitimately span several lines.
    if (!list.querySelector(`[${OWNED}="native"]`) && tabs.some((tab) => Math.abs(tab.getBoundingClientRect().top - first.top) > 12)) continue;

    // Gmail versions can put tablist on the table, its row, or an outer div.
    const sharedTableRow = tabs[0]!.closest('tr');
    const usesTableRow = sharedTableRow && list.contains(sharedTableRow) &&
      tabs.every((tab) => tab.closest('tr') === sharedTableRow);
    const row = usesTableRow ? sharedTableRow : list;
    const table = usesTableRow ? sharedTableRow.closest('table') : null;
    const branches = tabs.map((tab) => directBranch(tab, row));
    if (branches.some((branch) => !branch) || new Set(branches).size !== tabs.length) continue;
    const items = branches as HTMLElement[];
    if (table && items.some((item) => item.tagName !== 'TD' && item.tagName !== 'TH')) continue;
    return { list, row, items, tabs, table };
  }
  return null;
}

function findNativeToolbar(main: HTMLElement, native: NativeTabs | null): NativeToolbar | null {
  const mainBox = main.getBoundingClientRect();
  const tabTop = native?.list.getBoundingClientRect().top ?? mainBox.top + 180;
  const candidates = [...new Set([...document.querySelectorAll<HTMLElement>('[gh="mtb"], [role="toolbar"]')]
    .map((element) => {
      // Current Gmail marks only the compact action group as mtb. Its parent
      // inside the tm toolbar shares the row with pagination.
      const toolbar = element.matches('[gh="mtb"]') ? element.closest<HTMLElement>('[gh="tm"]') : null;
      const parent = element.parentElement;
      return toolbar && parent && toolbar.contains(parent) ? parent : element;
    }))]
    .filter((element) => {
      if (!isVisible(element) || element.closest(`${OWNED_SELECTOR}, [role="dialog"], [role="complementary"]`) ||
        element.querySelector('[role="tablist"], [role="main"]')) return false;
      const box = element.getBoundingClientRect();
      // Sticky actions stay in place while the tabs and main scroll past them.
      // Use their DOM relationship inside Gmail instead of viewport order.
      const shell = element.closest<HTMLElement>('[gh="tm"]');
      const beforeTabs = native && Boolean(element.compareDocumentPosition(native.list) & Node.DOCUMENT_POSITION_FOLLOWING);
      const anchoredInMain = main.contains(element) && (native ? beforeTabs : Boolean(shell && main.contains(shell)));
      const aboveTabs = box.top >= mainBox.top - 80 && box.bottom <= tabTop + 2;
      return box.width >= Math.min(500, mainBox.width * 0.65) && box.left >= mainBox.left - 24 &&
        box.right <= mainBox.right + 24 && (anchoredInMain || aboveTabs);
    })
    .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
  for (const toolbar of candidates) {
    let row = toolbar;
    const wrappers: HTMLElement[] = [];
    const visibleChildren = (element: HTMLElement) => [...element.children].filter((child): child is HTMLElement =>
      child instanceof HTMLElement && !child.matches(OWNED_SELECTOR) && isVisible(child));
    // Gmail can wrap the leading actions and pagination in one full-width row.
    // Keep those native nodes and their listeners, and use that row as the host.
    for (let children = visibleChildren(row); children.length === 1; children = visibleChildren(row)) {
      const child = children[0]!;
      if (child.matches('button, [role="button"], [role="checkbox"], input, select') ||
        child.getBoundingClientRect().width < row.getBoundingClientRect().width * 0.8) break;
      wrappers.push(row);
      row = child;
    }
    const items = visibleChildren(row);
    const actions = row.querySelectorAll('button, [role="button"], [role="checkbox"], input[type="checkbox"]');
    if (!items.length || actions.length < 2) continue;
    // An unknown mixed wrapper can clip a taller controls row. Use the normal
    // flow fallback in that case, without changing any message-list container.
    let branch = toolbar;
    let safe = true;
    for (let parent = toolbar.parentElement; parent && parent !== main && !parent.contains(main); parent = parent.parentElement) {
      const others = visibleChildren(parent).filter((child) => child !== branch);
      if (!others.length) wrappers.push(parent);
      else {
        const style = getComputedStyle(parent);
        if ([style.overflowX, style.overflowY].some((value) => value === 'hidden' || value === 'clip')) { safe = false; break; }
      }
      branch = parent;
    }
    if (!safe) continue;
    const rowBox = row.getBoundingClientRect();
    const middle = rowBox.left + rowBox.width / 2;
    const before = items.find((item, index) => index > 0 && item.getBoundingClientRect().left >= middle) ?? null;
    return { row, items, before, wrappers };
  }
  return null;
}

function inheritTabTypography(host: HTMLElement, native: NativeTabs | null) {
  const inactive = native?.tabs.find((tab) => tab.getAttribute('aria-selected') === 'false');
  const tab = inactive ?? native?.tabs[0];
  // aKz is the category TITLE; aKx also contains the optional unread snippet.
  // Reading its computed style avoids inheriting the smaller snippet font.
  const title = tab?.querySelector<HTMLElement>('.aKz') ?? tab;
  const style = title ? getComputedStyle(title) : null;
  // Some Gmail wrappers inherit the 12px unread-preview font even though the
  // category title is 14px. Never propagate that smaller wrapper font.
  const fontSize = Math.max(14, Number.parseFloat(style?.fontSize ?? '') || 14);
  const properties: Record<string, string> = {
    '--dock-tab-font-family': style?.fontFamily || '"Google Sans", Roboto, Arial, sans-serif',
    '--dock-tab-font-size': `${fontSize}px`,
    '--dock-tab-font-weight': style?.fontWeight || '500',
    '--dock-tab-line-height': style?.lineHeight || '20px',
    '--dock-tab-color': inactive && style ? style.color : '#444746',
    '--dock-tab-active-color': '#0b57d0',
  };
  for (const [property, value] of Object.entries(properties)) {
    if (host.style.getPropertyValue(property) !== value) host.style.setProperty(property, value);
  }
}

/** Returns a disposer which restores only the inline properties this adapter owns. */
export function attachGmailLayout({ tabsHost, controlsHost, onNativeSelect }: GmailLayoutOptions): () => void {
  let disposed = false;
  let frame = 0;
  let slot: HTMLElement | null = null;
  let activeRow: HTMLElement | null = null;
  let activeItems: HTMLElement[] = [];
  let nativeTabs: HTMLElement[] = [];
  let activeMode: 'native' | 'fallback' | null = null;
  let activeBoundary: HTMLElement | null = null;
  let activeToolbar: HTMLElement | null = null;
  let activeToolbarItems: HTMLElement[] = [];
  let lastRoute = window.location.hash;
  const changes = new Map<HTMLElement, { hadStyle: boolean; properties: Map<string, StyleChange> }>();
  const hostAttributes = [tabsHost, controlsHost].filter((host): host is HTMLElement => Boolean(host)).map((host) => ({
    host,
    attributes: ['style', OWNED, ...(host === controlsHost ? ['data-dock-toolbar-placement'] : [])]
      .map((name) => [name, host.getAttribute(name)] as const),
  }));
  tabsHost.setAttribute(OWNED, 'tabs');
  if (controlsHost) {
    controlsHost.setAttribute(OWNED, 'controls');
    // Match native action stacking above Gmail's toolbar background pseudo-element.
    Object.assign(controlsHost.style, { display: 'block', position: 'relative', zIndex: '0', minWidth: '0', minInlineSize: '0', boxSizing: 'border-box', flex: '1 1 0px' });
  }

  const patch = (element: HTMLElement, properties: Record<string, string>) => {
    let record = changes.get(element);
    if (!record) {
      record = { hadStyle: element.hasAttribute('style'), properties: new Map() };
      changes.set(element, record);
    }
    for (const [property, value] of Object.entries(properties)) {
      const current = element.style.getPropertyValue(property);
      const priority = element.style.getPropertyPriority(property);
      let change = record.properties.get(property);
      if (!change) {
        change = { value: current, priority, applied: '' };
        record.properties.set(property, change);
      } else if (current !== change.applied || priority !== 'important') {
        // If Gmail updated its own style, restore that latest value on detach.
        change.value = current;
        change.priority = priority;
      }
      if (current !== value || priority !== 'important') element.style.setProperty(property, value, 'important');
      change.applied = element.style.getPropertyValue(property);
    }
  };

  const resetTabs = () => {
    tabsHost.remove();
    controlsHost?.remove();
    slot?.remove();
    slot = null;
    for (const [element, record] of changes) {
      // Restore shorthand properties after the longhands that followed them.
      for (const [property, change] of [...record.properties].reverse()) {
        if (element.style.getPropertyValue(property) !== change.applied || element.style.getPropertyPriority(property) !== 'important') continue;
        if (change.value) element.style.setProperty(property, change.value, change.priority);
        else element.style.removeProperty(property);
      }
      if (!record.hadStyle && element.style.length === 0) element.removeAttribute('style');
    }
    changes.clear();
    activeRow = null;
    activeItems = [];
    nativeTabs = [];
    activeMode = null;
    activeBoundary = null;
    activeToolbar = null;
    activeToolbarItems = [];
  };

  const observer = new MutationObserver((records) => {
    const external = records.some((record) => {
      if (record.type === 'childList' && [...record.removedNodes].includes(tabsHost)) return true;
      if (record.target instanceof Element && record.target.closest(OWNED_SELECTOR)) return false;
      if (record.type === 'childList') {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        if (nodes.length && nodes.every((node) => node instanceof Element && node.matches(OWNED_SELECTOR))) {
          // A host removal by Gmail needs repair; our own writes occur disconnected.
          return nodes.some((node) => node === slot || node === tabsHost || node === controlsHost);
        }
      }
      return true;
    });
    if (external) schedule();
  });
  const observe = () => {
    if (!disposed && document.body) observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'role', 'aria-hidden', 'aria-selected'],
    });
  };
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule()) : null;
  let resizeTargets: HTMLElement[] = [];

  const mount = (parent: HTMLElement, after: HTMLElement | null, mode: 'native' | 'fallback', native?: NativeTabs) => {
    const changed = activeRow !== parent || activeMode !== mode || !slot?.isConnected || tabsHost.parentElement !== slot ||
      (native && (native.items.length !== activeItems.length || native.items.some((item, index) => item !== activeItems[index])));
    if (changed) {
      // A repaired fallback must not use the old Dock slot as its anchor.
      // resetTabs removes that slot before the new one is inserted.
      while (after?.matches(OWNED_SELECTOR)) {
        after = after.previousElementSibling instanceof HTMLElement ? after.previousElementSibling : null;
      }
      resetTabs();
      slot = document.createElement(native?.table ? 'td' : 'div');
      slot.setAttribute(OWNED, mode);
      slot.className = 'dock-gmail-tabs-slot';
      Object.assign(slot.style, { display: 'block', boxSizing: 'border-box', padding: '0', verticalAlign: 'middle', minWidth: '0', maxWidth: '100%', overflow: 'visible' });
      // Gmail's generic TD rule can otherwise fix our own cell to one row,
      // even when its shadow-root categories need several lines.
      slot.style.setProperty('height', 'auto', 'important');
      slot.style.setProperty('max-height', 'none', 'important');
      Object.assign(tabsHost.style, { display: 'block', width: '100%', minWidth: '0', maxWidth: '100%', boxSizing: 'border-box', overflow: 'visible' });
      slot.append(tabsHost);
      if (after) after.after(slot);
      else parent.prepend(slot);
      activeRow = parent;
      activeItems = native?.items ?? [];
      activeMode = mode;
    }
  };

  const update = () => {
    frame = 0;
    if (disposed) return;
    // All native style/child mutations below are synchronous and owned by us.
    observer.disconnect();
    const main = visibleMain();
    const route = window.location.hash;
    if (route !== lastRoute) {
      lastRoute = route;
      onNativeSelect?.();
    }
    const overview = INBOX_ROUTE.test(route) || CATEGORY_ROUTE.test(route) || getGmailLabelFromRoute(route) !== null;
    const native = overview && main ? findNativeTabs(main) : null;
    const boundary = native && main ? tabBoundary(native, main) : null;
    const toolbar = overview && main && controlsHost ? findNativeToolbar(main, native) : null;
    if (activeToolbar && (activeToolbar !== toolbar?.row || activeToolbarItems.length !== toolbar.items.length ||
      toolbar.items.some((item, index) => item !== activeToolbarItems[index]))) resetTabs();
    let hasTabs = false;
    inheritTabTypography(tabsHost, native);

    if (native && boundary?.safe) {
      if (activeBoundary && activeBoundary !== boundary.branch) resetTabs();
      const width = native.list.getBoundingClientRect().width;
      const nativeWidth = Math.min(156, Math.max(128, Math.floor(width / (native.items.length + 1))));
      const available = Math.floor(width - native.items.length * nativeWidth);
      const stacked = available < 740;
      mount(native.row, native.items[0]!, 'native', native);
      activeBoundary = boundary.branch;
      // Keep the original DOM and listeners; only change its layout model so
      // categories can wrap naturally rather than introducing any scroll strip.
      if (native.table) {
        patch(native.table, { display: 'block', width: '100%', height: 'auto', 'max-height': 'none', 'table-layout': 'auto' });
        if (native.row.parentElement && native.row.parentElement !== native.table) {
          patch(native.row.parentElement, { display: 'block', width: '100%', height: 'auto', 'max-height': 'none' });
        }
      }
      patch(native.row, {
        display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'stretch', width: '100%',
        height: 'auto', 'max-height': 'none', 'box-sizing': 'border-box',
      });
      for (const item of native.items) {
        patch(item, {
          display: 'block', 'box-sizing': 'border-box', flex: `0 1 ${nativeWidth}px`,
          width: `${nativeWidth}px`, 'min-width': '0', 'max-width': '100%', order: '0',
        });
      }
      for (const tab of native.tabs) {
        patch(tab, { width: '100%', 'max-width': '100%', 'box-sizing': 'border-box' });
      }
      if (slot) Object.assign(slot.style, {
        width: stacked ? '100%' : `${available}px`,
        flex: stacked ? '1 1 100%' : '1 1 0px',
        order: stacked ? '1' : '0',
      });
      // Only tab-only wrappers are allowed to grow. Leave the main/mail
      // scrollports and their overflow behavior untouched; restore on detach.
      for (const wrapper of boundary.wrappers) {
        patch(wrapper, { height: 'auto', 'max-height': 'none', 'flex-shrink': '0' });
      }
      nativeTabs = native.tabs;
      hasTabs = true;
    } else if (native && main) {
      const branch = directBranch(native.list, main);
      mount(main, branch?.previousElementSibling instanceof HTMLElement ? branch.previousElementSibling : null, 'fallback');
      nativeTabs = native.tabs;
      hasTabs = true;
    } else if (main && overview) {
      // Label lists do not have Gmail's category strip. Reuse the normal-flow
      // slot, leaving Gmail's message list and action controls in place.
      const toolbarBranch = toolbar ? directBranch(toolbar.row, main) : null;
      mount(main, toolbarBranch, 'fallback');
      if (slot) Object.assign(slot.style, { width: '100%', maxWidth: '100%' });
      hasTabs = true;
    }
    if (!hasTabs) resetTabs();

    if (hasTabs && controlsHost) {
      if (toolbar) {
        const attachingToolbar = activeToolbar !== toolbar.row;
        if (attachingToolbar) {
          // Capture the native height before our controls can make it taller.
          patch(toolbar.row, { 'min-height': `${toolbar.row.getBoundingClientRect().height}px` });
        }
        activeToolbar = toolbar.row;
        activeToolbarItems = toolbar.items;
        patch(toolbar.row, {
          display: 'flex', 'align-items': 'center', 'flex-wrap': 'nowrap', gap: '8px',
          'box-sizing': 'border-box', height: 'auto', 'max-height': 'none', overflow: 'visible',
        });
        for (const item of toolbar.items) {
          patch(item, { 'flex-shrink': '0', float: 'none' });
        }
        for (const wrapper of toolbar.wrappers) {
          if (attachingToolbar) patch(wrapper, { 'min-height': `${wrapper.getBoundingClientRect().height}px` });
          patch(wrapper, { height: 'auto', 'max-height': 'none', overflow: 'visible', 'flex-shrink': '0' });
        }
        Object.assign(controlsHost.style, { width: 'auto', maxWidth: '100%', marginInline: '4px', flex: '1 1 0px' });
        controlsHost.setAttribute('data-dock-toolbar-placement', 'native');
        if (controlsHost.parentElement !== toolbar.row || controlsHost.nextElementSibling !== toolbar.before) {
          toolbar.row.insertBefore(controlsHost, toolbar.before);
        }
      } else {
        Object.assign(controlsHost.style, { width: '100%', maxWidth: '100%', marginInline: '0', flex: '0 0 auto' });
        controlsHost.setAttribute('data-dock-toolbar-placement', 'fallback');
        const anchor = activeMode === 'native' ? boundary?.branch : slot;
        if (anchor && anchor.previousElementSibling !== controlsHost) anchor.before(controlsHost);
      }
    }

    const targets = [main, native?.row, slot, tabsHost, controlsHost, toolbar?.row, ...(toolbar?.wrappers ?? []), ...(boundary?.wrappers ?? [])].filter((element): element is HTMLElement => Boolean(element?.isConnected));
    if (targets.length !== resizeTargets.length || targets.some((element, index) => element !== resizeTargets[index])) {
      resizeObserver?.disconnect();
      targets.forEach((element) => resizeObserver?.observe(element));
      resizeTargets = targets;
    }

    observe();
  };

  function schedule() {
    if (!disposed && !frame) frame = window.requestAnimationFrame(update);
  }

  const nativeSelect = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
    const path = event.composedPath();
    if (nativeTabs.some((tab) => path.includes(tab))) onNativeSelect?.();
  };

  document.addEventListener('click', nativeSelect, true);
  document.addEventListener('keydown', nativeSelect, true);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('popstate', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  observe();
  schedule();

  return () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    resizeObserver?.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    document.removeEventListener('click', nativeSelect, true);
    document.removeEventListener('keydown', nativeSelect, true);
    window.removeEventListener('hashchange', schedule);
    window.removeEventListener('popstate', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
    resetTabs();
    for (const { host, attributes } of hostAttributes) {
      for (const [name, value] of attributes) {
        if (value === null) host.removeAttribute(name);
        else host.setAttribute(name, value);
      }
    }
  };
}
