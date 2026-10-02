import sidebarCss from './gmail-sidebar.css?inline';
import { GMAIL_SIDEBAR_MIN_WIDTH, GMAIL_SIDEBAR_MAX_WIDTH, isGmailSidebarWidth } from './gmail-sidebar-preferences';

interface SidebarStorage {
  load(): Promise<number | undefined>;
  save(width: number | undefined): Promise<void>;
}

/** Resize only Gmail's recognized navigation column. Never inspect message content. */
export function attachGmailSidebar(storage: SidebarStorage): () => void {
  let disposed = false;
  let frame = 0;
  let nav: HTMLElement | null = null;
  let preferredWidth: number | undefined;
  let edited = false;
  let saving = false;
  let saveRequested = false;
  let pendingWidth: number | undefined;
  let maximum = GMAIL_SIDEBAR_MAX_WIDTH;
  let assignedId = false;
  let resizeTargets: HTMLElement[] = [];
  let drag: { pointerId: number; x: number; width: number; previous: number | undefined; direction: number } | null = null;
  const style = document.createElement('style');
  style.dataset.dockSidebarStyle = '';
  style.textContent = sidebarCss;
  const handle = document.createElement('div');
  handle.dataset.dockSidebarHandle = '';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', 'Gmail sidebar');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-description', 'Drag or use Left and Right arrows to resize. Double-click or press Enter to restore the default width.');
  handle.title = 'Drag to resize sidebar. Double-click to reset.';

  const visible = (element: HTMLElement) => element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== 'hidden';
  const clamp = (width: number) => Math.round(Math.max(GMAIL_SIDEBAR_MIN_WIDTH, Math.min(maximum, width)));
  const clearWidth = () => {
    nav?.removeAttribute('data-dock-sidebar-width');
    nav?.style.removeProperty('--dock-sidebar-width');
  };
  const stopDrag = (cancel: boolean) => {
    if (!drag) return;
    const previous = drag;
    drag = null;
    if (handle.hasPointerCapture(previous.pointerId)) handle.releasePointerCapture(previous.pointerId);
    document.body.removeAttribute('data-dock-sidebar-dragging');
    if (cancel) preferredWidth = previous.previous;
    else if (preferredWidth !== previous.previous) void save();
    schedule();
  };
  const detach = () => {
    stopDrag(true);
    clearWidth();
    handle.remove();
    if (assignedId && nav?.id === 'dock-gmail-sidebar') nav.removeAttribute('id');
    assignedId = false;
    nav = null;
    resize.disconnect();
    resizeTargets = [];
  };

  async function save() {
    pendingWidth = preferredWidth;
    saveRequested = true;
    if (saving) return;
    saving = true;
    // Coalesce rapid key repeats, and finish each write before a later reset.
    while (saveRequested) {
      saveRequested = false;
      const width = pendingWidth;
      try { await storage.save(width); }
      catch (error) {
        // The current tab can still resize if the extension has been reloaded.
        handle.title = 'Width changed for this tab. Reload Gmail to save sidebar changes.';
        console.warn('Dock could not save the Gmail sidebar width.', error);
      }
    }
    saving = false;
  }

  async function load() {
    try {
      const width = await storage.load();
      if (disposed || edited) return;
      preferredWidth = isGmailSidebarWidth(width) ? width : undefined;
      schedule();
    } catch (error) { console.warn('Dock could not load the Gmail sidebar width.', error); }
  }

  const observe = () => observer.observe(document.body, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-expanded', 'aria-hidden'],
  });
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.target !== style && !handle.contains(record.target))) schedule();
  });
  const resize = new ResizeObserver(() => schedule());

  function update() {
    frame = 0;
    if (disposed) return;
    observer.disconnect();
    // The native navigation is a fixed flex column beside Gmail's mail column.
    // Leave unfamiliar layouts alone instead of moving arbitrary page elements.
    const candidate = [...document.querySelectorAll<HTMLElement>('.aeN[role="navigation"]')].find(visible) ?? null;
    const parent = candidate?.parentElement;
    const main = parent && [...parent.children].find((child): child is HTMLElement =>
      child instanceof HTMLElement && child !== candidate && Boolean(child.matches('[role="main"]') || child.querySelector('[role="main"]')) && visible(child));
    const parentStyle = parent ? getComputedStyle(parent) : null;
    if (!candidate || !parent || !main || parentStyle?.display !== 'flex' || !parentStyle.flexDirection.startsWith('row') || getComputedStyle(candidate).position !== 'relative') {
      detach();
      observe();
      return;
    }
    if (nav !== candidate) {
      detach();
      nav = candidate;
    }
    const targets = [nav, parent, main];
    if (targets.some((target, index) => target !== resizeTargets[index])) {
      resize.disconnect();
      targets.forEach((target) => resize.observe(target));
      resizeTargets = targets;
    }
    if (!style.isConnected) document.head.append(style);
    const box = nav.getBoundingClientRect();
    const mainBox = main.getBoundingClientRect();
    const menu = document.querySelector<HTMLElement>('.gb_ad[role="button"][aria-expanded]');
    const collapsed = menu?.getAttribute('aria-expanded') === 'false' || (!nav.hasAttribute('data-dock-sidebar-width') && box.width < GMAIL_SIDEBAR_MIN_WIDTH);
    const mainMinimum = Math.max(360, Number.parseFloat(getComputedStyle(main).minWidth) || 0);
    // Account for Gmail's right app rail and side panels, plus any page overflow.
    const parentBox = parent.getBoundingClientRect();
    const columns = [...parent.children].map((child) => child.getBoundingClientRect());
    const overflow = Math.max(0, Math.max(parentBox.right, ...columns.map((column) => column.right)) - Math.min(parentBox.right, document.documentElement.clientWidth)) +
      Math.max(0, Math.max(0, parentBox.left) - Math.min(parentBox.left, ...columns.map((column) => column.left)));
    maximum = Math.min(GMAIL_SIDEBAR_MAX_WIDTH, Math.floor(box.width + mainBox.width - mainMinimum - overflow));
    if (collapsed || maximum < GMAIL_SIDEBAR_MIN_WIDTH) {
      stopDrag(true);
      clearWidth();
      handle.remove();
      observe();
      return;
    }
    if (preferredWidth === undefined) clearWidth();
    else {
      const value = `${clamp(preferredWidth)}px`;
      nav.setAttribute('data-dock-sidebar-width', '');
      if (nav.style.getPropertyValue('--dock-sidebar-width') !== value) nav.style.setProperty('--dock-sidebar-width', value);
    }
    if (!nav.id) { nav.id = 'dock-gmail-sidebar'; assignedId = true; }
    handle.setAttribute('aria-controls', nav.id);
    handle.setAttribute('aria-valuemin', String(GMAIL_SIDEBAR_MIN_WIDTH));
    handle.setAttribute('aria-valuemax', String(maximum));
    const width = Math.round(nav.getBoundingClientRect().width);
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', `${width} pixels`);
    if (handle.parentElement !== nav) nav.append(handle);
    observe();
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(update);
  }

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary || !nav || drag) return;
    event.preventDefault();
    event.stopPropagation();
    edited = true;
    // Programmatic pointer focus can retain the browser's keyboard focus ring.
    handle.setAttribute('data-dock-sidebar-pointer-focus', '');
    handle.focus({ preventScroll: true });
    drag = { pointerId: event.pointerId, x: event.clientX, width: nav.getBoundingClientRect().width, previous: preferredWidth, direction: getComputedStyle(nav).direction === 'rtl' ? -1 : 1 };
    handle.setPointerCapture(event.pointerId);
    document.body.setAttribute('data-dock-sidebar-dragging', '');
  });
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.clientX === drag.x && preferredWidth === drag.previous) return;
    preferredWidth = clamp(drag.width + (event.clientX - drag.x) * drag.direction);
    schedule();
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', (event) => {
    if (event.pointerId !== drag?.pointerId) return;
    move(event);
    stopDrag(false);
  });
  handle.addEventListener('pointercancel', () => stopDrag(true));
  handle.addEventListener('lostpointercapture', () => stopDrag(true));
  const reset = () => {
    stopDrag(true);
    edited = true;
    preferredWidth = undefined;
    void save();
    schedule();
  };
  handle.addEventListener('dblclick', reset);
  handle.addEventListener('blur', () => handle.removeAttribute('data-dock-sidebar-pointer-focus'));
  handle.addEventListener('keydown', (event) => {
    handle.removeAttribute('data-dock-sidebar-pointer-focus');
    if (event.key === 'Tab') return;
    event.stopPropagation();
    if (event.key === 'Escape' && drag) { event.preventDefault(); stopDrag(true); return; }
    if (event.key === 'Enter') { event.preventDefault(); reset(); return; }
    if (drag) { event.preventDefault(); return; }
    if (!nav || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    edited = true;
    const direction = getComputedStyle(nav).direction === 'rtl' ? -1 : 1;
    const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 40 : 10) * direction;
    const width = preferredWidth === undefined ? nav.getBoundingClientRect().width : clamp(preferredWidth);
    preferredWidth = event.key === 'Home' ? GMAIL_SIDEBAR_MIN_WIDTH : event.key === 'End' ? maximum : clamp(width + delta);
    void save();
    schedule();
  });
  for (const type of ['click', 'dblclick', 'keyup', 'keypress']) handle.addEventListener(type, (event) => event.stopPropagation());
  const cancel = () => stopDrag(true);
  window.addEventListener('blur', cancel);
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', schedule);
  observe();
  schedule();
  void load();

  return () => {
    disposed = true;
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    detach();
    style.remove();
    window.removeEventListener('blur', cancel);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('hashchange', schedule);
  };
}
