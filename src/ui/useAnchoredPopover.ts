import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Shared placement and light dismissal for Dock's nonmodal popovers. */
export function useAnchoredPopover({ open, resetKey, panelRef, anchorRef, triggerRef = anchorRef, layoutTarget, onClose, onOpen }: {
  open: boolean;
  resetKey?: string;
  panelRef: RefObject<HTMLElement | null>;
  anchorRef: RefObject<HTMLElement | null>;
  triggerRef?: RefObject<HTMLElement | null>;
  layoutTarget?: HTMLElement | null;
  onClose: () => void;
  onOpen?: () => void;
}) {
  const callbacks = useRef({ onClose, onOpen });
  callbacks.current = { onClose, onOpen };
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!open || !panel || !anchor) return;
    const nativePopover = 'popover' in HTMLElement.prototype;
    if (nativePopover) panel.showPopover();
    let frame = 0;
    const close = () => callbacks.current.onClose();
    const position = () => {
      frame = 0;
      if (!anchor.isConnected || !anchor.getClientRects().length) { close(); return; }
      const target = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const right = left + (viewport?.width ?? innerWidth);
      const bottom = top + (viewport?.height ?? innerHeight);
      const box = panel.getBoundingClientRect();
      const below = target.bottom + 4;
      const above = target.top - box.height - 4;
      const y = below + box.height <= bottom - 8 || above < top + 8 ? below : above;
      panel.style.left = `${Math.max(left + 8, Math.min(target.left, right - box.width - 8))}px`;
      panel.style.top = `${Math.max(top + 8, Math.min(y, bottom - box.height - 8))}px`;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(position); };
    const dismissOutside = (event: PointerEvent) => {
      if (!event.composedPath().includes(panel) && !event.composedPath().includes(triggerRef.current!)) close();
    };
    position();
    callbacks.current.onOpen?.();
    const observer = new ResizeObserver(schedule);
    observer.observe(anchor);
    observer.observe(panel);
    if (layoutTarget) observer.observe(layoutTarget);
    // Native popovers escape Gmail's clipping wrappers. Older browsers retain
    // fixed placement and use an outside-pointer listener to dismiss.
    if (!nativePopover) document.addEventListener('pointerdown', dismissOutside, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('hashchange', close);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      if (nativePopover && panel.matches(':popover-open')) panel.hidePopover();
      document.removeEventListener('pointerdown', dismissOutside, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('hashchange', close);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [open, resetKey, panelRef, anchorRef, triggerRef, layoutTarget]);
}
