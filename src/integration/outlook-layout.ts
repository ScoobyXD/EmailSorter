import type { GmailLayoutOptions } from './gmail-layout';

export interface OutlookViewRect { top: number; left: number; width: number; height: number }
type OutlookLayoutOptions = Pick<GmailLayoutOptions, 'tabsHost' | 'onNativeSelect'> & {
  onViewRect?: (rectangle: OutlookViewRect | null) => void;
};

/** Outlook's prototype uses its own scrolling filter row at the top of the mail area. */
export function attachOutlookLayout({ tabsHost, onViewRect, onNativeSelect }: OutlookLayoutOptions): () => void {
  let frame = 0;
  let disposed = false;
  let main: HTMLElement | null = null;
  let lastRect = '';
  const slot = document.createElement('div');
  slot.dataset.dockOutlookLayout = 'tabs';
  Object.assign(slot.style, { display: 'block', width: '100%', minWidth: '0', background: '#fff', borderBottom: '1px solid #e0e3e7' });
  Object.assign(tabsHost.style, { display: 'block', width: '100%', minWidth: '0' });
  tabsHost.style.setProperty('--dock-tab-font-family', '"Segoe UI", Arial, sans-serif');
  tabsHost.style.setProperty('--dock-tab-font-size', '14px');
  tabsHost.style.setProperty('--dock-tab-active-color', '#0f6cbd');
  slot.append(tabsHost);
  const resize = new ResizeObserver(() => schedule());
  const observer = new MutationObserver((records) => {
    if (records.some((record) => !(record.target instanceof Element && record.target.closest('[data-dock-outlook-layout]')))) schedule();
  });
  const observe = () => observer.observe(document.body, { childList: true, subtree: true });

  const update = () => {
    frame = 0;
    if (disposed) return;
    observer.disconnect();
    const next = [...document.querySelectorAll<HTMLElement>('main, [role="main"]')].find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 200 && rect.height > 100 && !element.closest('[hidden], [aria-hidden="true"], [role="dialog"]');
    }) ?? null;
    if (next !== main) {
      main = next;
      resize.disconnect();
      if (main) { resize.observe(main); resize.observe(slot); }
      onNativeSelect?.();
    }
    if (main && !main.contains(slot)) main.prepend(slot);
    if (!main) slot.remove();
    let rect: OutlookViewRect | null = null;
    if (main) {
      const bounds = main.getBoundingClientRect();
      const top = slot.getBoundingClientRect().bottom;
      const left = Math.max(0, bounds.left);
      const width = Math.max(0, Math.min(window.innerWidth, bounds.right) - left);
      const height = Math.max(0, Math.min(window.innerHeight - 8, bounds.bottom) - top);
      if (width > 0 && height > 0) rect = { top, left, width, height };
    }
    const key = JSON.stringify(rect);
    if (key !== lastRect) { lastRect = key; onViewRect?.(rect); }
    observe();
  };
  function schedule() { if (!frame && !disposed) frame = requestAnimationFrame(update); }
  const nativeClick = (event: Event) => {
    if (event.target instanceof Element && !slot.contains(event.target) && event.target.closest('[role="tab"]')) onNativeSelect?.();
  };
  const routeChange = () => { onNativeSelect?.(); schedule(); };
  document.addEventListener('click', nativeClick, true);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('popstate', routeChange);
  window.addEventListener('hashchange', routeChange);
  observe(); schedule();
  return () => {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    observer.disconnect(); resize.disconnect(); slot.remove();
    document.removeEventListener('click', nativeClick, true);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('popstate', routeChange);
    window.removeEventListener('hashchange', routeChange);
  };
}
