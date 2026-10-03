import { useId, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { DockState } from '../gmail/protocol';
import { gmailMessageHash, gmailRouteUrl, openGmailRoute } from '../integration/gmail-navigation';
import { useAnchoredPopover } from './useAnchoredPopover';

export function RunErrors({ run, accountEmail, layoutTarget, onRefresh }: {
  run: NonNullable<DockState['run']>;
  accountEmail?: string;
  layoutTarget: HTMLElement | null;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();
  const failures = run.failures ?? [];
  const count = Math.max(failures.length, run.failed, 1);
  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }
  async function refresh() {
    if (loading || !failures.some(item => item.subject === undefined || item.sender === undefined)) return;
    setLoading(true);
    setDetailsError('');
    try { await onRefresh(); }
    catch { setDetailsError('Email details could not be loaded. The saved errors and message links are still available.'); }
    finally { setLoading(false); }
  }
  useAnchoredPopover({
    open, panelRef, anchorRef: triggerRef, layoutTarget, onClose: () => close(),
    onOpen: () => { panelRef.current?.focus({ preventScroll: true }); void refresh(); },
  });
  return <>
    <button type="button" ref={triggerRef} className="dock-button dock-errors-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(value => !value)}>
      {count} {count === 1 ? 'error' : 'errors'}<ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <div ref={panelRef} id={panelId} popover="auto" role="dialog" aria-labelledby={titleId} tabIndex={-1} className="dock-dialog dock-errors-popover" onToggle={event => { if (event.newState === 'closed') close(); }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    }}>
      <header className="dock-errors-heading"><h2 id={titleId}>Email errors</h2><button type="button" className="dock-button" aria-label="Close email errors" onClick={() => close(true)}><X size={16} aria-hidden="true" /></button></header>
      {accountEmail && <p className="dock-field-help">{accountEmail}</p>}
      {run.error && <p className="dock-error dock-run-error">{run.error}</p>}
      {loading && <p className="dock-field-help" role="status">Loading email details…</p>}
      {detailsError && <p className="dock-field-help" role="status">{detailsError}</p>}
      {!!failures.length && <ol className="dock-error-list">{failures.map(failure => {
        const title = failure.subject || `Message ID: ${failure.id}`;
        const hash = gmailMessageHash(failure.id);
        return <li key={failure.id}>
          {accountEmail ? <a className="dock-error-email" href={gmailRouteUrl(accountEmail, hash)} aria-label={`Open email in Gmail: ${title}`} onClick={event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            close();
            openGmailRoute(accountEmail, hash);
          }}>{title}</a> : <strong>{title}</strong>}
          {failure.sender && <span className="dock-error-sender">{failure.sender}</span>}
          {failure.subject && <span className="dock-error-id">Message ID: {failure.id}</span>}
          <p className="dock-error">{failure.error}</p>
        </li>;
      })}</ol>}
    </div>}
  </>;
}
