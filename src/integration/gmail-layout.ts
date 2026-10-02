/**
 * Gmail page-chrome integration. Only layout, roles and geometry are inspected:
 * this module never reads message text, sender data, search values or bodies.
 * Gmail does not publish a stable DOM API; unrecognized layouts use an inbox-only
 * fallback. Native tabs are kept in place so their listeners and state survive.
 */
export interface GmailViewRect { top: number; left: number; width: number; height: number }

export interface GmailLayoutOptions {
  /** Detached extension-owned element, optionally containing a shadow root. */
  tabsHost: HTMLElement;
  /** Controls live in normal flow outside Gmail's fixed-height category strip. */
  controlsHost?: HTMLElement;
  /** Fixed-position bounds for an extension-owned view below the complete tab row. */
  onViewRect?: (rectangle: GmailViewRect | null) => void;
  /** A native category click or a Gmail route change should close the custom view. */
  onNativeSelect?: () => void;
}

interface NativeTabs {
  list: HTMLElement;
  row: HTMLElement;
  items: HTMLElement[];
  tabs: HTMLElement[];
  table: HTMLTableElement | null;
}

interface StyleChange {
  element: HTMLElement;
  property: string;
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
    if ([style.overflowX, style.overflowY].some(value => value === 'hidden' || value === 'clip')) safe = false;
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
    if (!(row instanceof HTMLElement) || !list.contains(row)) continue;
    const branches = tabs.map((tab) => directBranch(tab, row));
    if (branches.some((branch) => !branch) || new Set(branches).size !== tabs.length) continue;
    const items = branches as HTMLElement[];
    if (table && items.some((item) => item.tagName !== 'TD' && item.tagName !== 'TH')) continue;
    return { list, row, items, tabs, table };
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
export function attachGmailLayout({ tabsHost, controlsHost, onViewRect, onNativeSelect }: GmailLayoutOptions): () => void {
  let disposed = false;
  let frame = 0;
  let slot: HTMLElement | null = null;
  let activeRow: HTMLElement | null = null;
  let activeItems: HTMLElement[] = [];
  let nativeTabs: HTMLElement[] = [];
  let activeMode: 'native' | 'fallback' | null = null;
  let activeBoundary: HTMLElement | null = null;
  let lastRectangle: GmailViewRect | null | undefined;
  let lastRoute = window.location.hash;
  const changes: StyleChange[] = [];
  const originallyStyled = new Map<HTMLElement, boolean>();
  const hostStyle = tabsHost.getAttribute('style');
  const oldMarker = tabsHost.getAttribute(OWNED);
  const controlsStyle = controlsHost?.getAttribute('style') ?? null;
  const controlsMarker = controlsHost?.getAttribute(OWNED) ?? null;
  tabsHost.setAttribute(OWNED, 'tabs');
  if (controlsHost) {
    controlsHost.setAttribute(OWNED, 'controls');
    Object.assign(controlsHost.style, { display: 'block', width: '100%', minWidth: '0', boxSizing: 'border-box', flex: '0 0 auto' });
  }

  const patch = (element: HTMLElement, property: string, value: string) => {
    let change = changes.find((item) => item.element === element && item.property === property);
    if (!change) {
      if (!originallyStyled.has(element)) originallyStyled.set(element, element.hasAttribute('style'));
      change = { element, property, value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property), applied: '' };
      changes.push(change);
    } else if (element.style.getPropertyValue(property) !== change.applied || element.style.getPropertyPriority(property) !== 'important') {
      // If Gmail updated its own style, restore that latest value on detach.
      change.value = element.style.getPropertyValue(property);
      change.priority = element.style.getPropertyPriority(property);
    }
    if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== 'important') {
      element.style.setProperty(property, value, 'important');
    }
    change.applied = element.style.getPropertyValue(property);
  };

  const resetTabs = () => {
    tabsHost.remove();
    controlsHost?.remove();
    slot?.remove();
    slot = null;
    for (const change of changes.splice(0).reverse()) {
      if (change.element.style.getPropertyValue(change.property) !== change.applied || change.element.style.getPropertyPriority(change.property) !== 'important') continue;
      if (change.value) change.element.style.setProperty(change.property, change.value, change.priority);
      else change.element.style.removeProperty(change.property);
    }
    for (const [element, hadStyle] of originallyStyled) {
      if (!hadStyle && element.style.length === 0) element.removeAttribute('style');
    }
    originallyStyled.clear();
    activeRow = null;
    activeItems = [];
    nativeTabs = [];
    activeMode = null;
    activeBoundary = null;
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
      nativeTabs = native?.tabs ?? [];
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
    const overview = INBOX_ROUTE.test(route) || CATEGORY_ROUTE.test(route);
    const native = overview && main ? findNativeTabs(main) : null;
    const boundary = native && main ? tabBoundary(native, main) : null;
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
        patch(native.table, 'display', 'block');
        patch(native.table, 'width', '100%');
        patch(native.table, 'height', 'auto');
        patch(native.table, 'max-height', 'none');
        patch(native.table, 'table-layout', 'auto');
        if (native.row.parentElement && native.row.parentElement !== native.table) {
          patch(native.row.parentElement, 'display', 'block');
          patch(native.row.parentElement, 'width', '100%');
          patch(native.row.parentElement, 'height', 'auto');
          patch(native.row.parentElement, 'max-height', 'none');
        }
      }
      patch(native.row, 'display', 'flex');
      patch(native.row, 'flex-wrap', 'wrap');
      patch(native.row, 'align-items', 'stretch');
      patch(native.row, 'width', '100%');
      patch(native.row, 'height', 'auto');
      patch(native.row, 'max-height', 'none');
      patch(native.row, 'box-sizing', 'border-box');
      for (const item of native.items) {
        patch(item, 'display', 'block');
        patch(item, 'box-sizing', 'border-box');
        patch(item, 'flex', `0 1 ${nativeWidth}px`);
        patch(item, 'width', `${nativeWidth}px`);
        patch(item, 'min-width', '0');
        patch(item, 'max-width', '100%');
        patch(item, 'order', '0');
      }
      for (const tab of native.tabs) {
        patch(tab, 'width', '100%');
        patch(tab, 'max-width', '100%');
        patch(tab, 'box-sizing', 'border-box');
      }
      if (slot) Object.assign(slot.style, {
        width: stacked ? '100%' : `${available}px`,
        flex: stacked ? '1 1 100%' : '1 1 0px',
        order: stacked ? '1' : '0',
      });
      // Only tab-only wrappers are allowed to grow. Leave the main/mail
      // scrollports and their overflow behavior untouched; restore on detach.
      for (const wrapper of boundary.wrappers) {
        patch(wrapper, 'height', 'auto');
        patch(wrapper, 'max-height', 'none');
        patch(wrapper, 'flex-shrink', '0');
      }
      if (controlsHost && boundary.branch.nextElementSibling !== controlsHost) boundary.branch.after(controlsHost);
      nativeTabs = native.tabs;
      hasTabs = true;
    } else if (native && main) {
      const branch = directBranch(native.list, main);
      mount(main, branch?.previousElementSibling instanceof HTMLElement ? branch.previousElementSibling : null, 'fallback');
      if (slot && controlsHost && slot.nextElementSibling !== controlsHost) slot.after(controlsHost);
      nativeTabs = native.tabs;
      hasTabs = true;
    } else if (main && INBOX_ROUTE.test(route)) {
      mount(main, null, 'fallback');
      if (slot) Object.assign(slot.style, { width: '100%', maxWidth: '100%' });
      if (slot && controlsHost && slot.nextElementSibling !== controlsHost) slot.after(controlsHost);
      hasTabs = true;
    }
    if (!hasTabs) resetTabs();

    const targets = [main, native?.row, slot, tabsHost, controlsHost, ...(boundary?.wrappers ?? [])].filter((element): element is HTMLElement => Boolean(element?.isConnected));
    if (targets.length !== resizeTargets.length || targets.some((element, index) => element !== resizeTargets[index])) {
      resizeObserver?.disconnect();
      targets.forEach((element) => resizeObserver?.observe(element));
      resizeTargets = targets;
    }

    let rectangle: GmailViewRect | null = null;
    if (hasTabs && main && slot?.isConnected) {
      const mainBox = main.getBoundingClientRect();
      const top = Math.ceil(Math.max(0, mainBox.top, slot.getBoundingClientRect().bottom, native?.row.getBoundingClientRect().bottom ?? 0, controlsHost?.getBoundingClientRect().bottom ?? 0));
      const left = Math.max(0, Math.ceil(mainBox.left));
      const width = Math.max(0, Math.floor(Math.min(window.innerWidth, mainBox.right) - left));
      const height = Math.max(0, Math.floor(Math.min(window.innerHeight, mainBox.bottom) - top));
      if (width > 0 && height > 0) rectangle = { top, left, width, height };
    }
    if (lastRectangle === undefined || rectangle?.top !== lastRectangle?.top || rectangle?.left !== lastRectangle?.left ||
      rectangle?.width !== lastRectangle?.width || rectangle?.height !== lastRectangle?.height) {
      lastRectangle = rectangle;
      onViewRect?.(rectangle);
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
    if (hostStyle === null) tabsHost.removeAttribute('style');
    else tabsHost.setAttribute('style', hostStyle);
    if (oldMarker === null) tabsHost.removeAttribute(OWNED);
    else tabsHost.setAttribute(OWNED, oldMarker);
    if (controlsHost) {
      if (controlsStyle === null) controlsHost.removeAttribute('style');
      else controlsHost.setAttribute('style', controlsStyle);
      if (controlsMarker === null) controlsHost.removeAttribute(OWNED);
      else controlsHost.setAttribute(OWNED, controlsMarker);
    }
    onViewRect?.(null);
  };
}
