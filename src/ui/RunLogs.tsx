import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import type { LogEvent, LogPage } from '../gmail/log-types';
import type { RunProgress } from '../gmail/protocol';
import type { DockApi } from './Workspace';

const PAGE_SIZE = 100;
const number = (value: number) => value.toLocaleString();
const time = (value: number) => new Date(value).toLocaleString();
const readable = (error: unknown) => error instanceof Error ? error.message : 'Logs could not be loaded. Try again.';


export function RunLogs({ api, currentRun, onClose }: { api: DockApi; currentRun?: RunProgress; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [selectedRun, setSelectedRun] = useState(currentRun?.id || '');
  const [page, setPage] = useState<LogPage>();
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('all');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<'export' | 'sync' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastUpdated, setLastUpdated] = useState<number>();
  const generation = useRef(0);
  const loaded = useRef<LogEvent[]>([]);
  const busy = useRef(false);
  const refresh = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    closeButton.current?.focus();
    return () => { element?.close(); };
  }, []);

  useEffect(() => {
    const session = ++generation.current;
    loaded.current = [];
    busy.current = false;
    setEvents([]); setPage(undefined); setLoading(true); setError(''); setNotice('');
    const update = async () => {
      if (busy.current || generation.current !== session) return;
      busy.current = true;
      try {
        const previousNewest = loaded.current[0]?.seq;
        const incoming: LogEvent[] = [];
        let latest: LogPage | undefined;
        let before: number | undefined;
        // Catch up to the previous newest event so a busy run cannot leave gaps
        // between refreshes. Pagination uses the journal's exclusive sequence.
        do {
          const result = await api({ type: 'dock:api', command: 'logs', runId: selectedRun || undefined, before, limit: PAGE_SIZE });
          if (!result.ok) throw new Error(result.error);
          if (!result.logPage) throw new Error('The extension did not return its logs. Reload the updated extension and refresh Gmail.');
          if (generation.current !== session) return;
          latest ||= result.logPage;
          incoming.push(...result.logPage.events);
          const oldest = result.logPage.events.at(-1)?.seq;
          before = previousNewest !== undefined && oldest !== undefined && oldest > previousNewest && result.logPage.hasMore ? result.logPage.nextBefore : undefined;
        } while (before !== undefined);
        if (generation.current !== session || !latest) return;
        const initial = loaded.current.length === 0;
        loaded.current = [...new Map([...loaded.current, ...incoming].map(event => [event.seq, event])).values()]
          .filter(event => event.seq >= latest!.persistence.firstAvailableSequence).sort((a, b) => b.seq - a.seq);
        setEvents(loaded.current);
        setPage(previous => ({ ...latest!, hasMore: initial ? latest!.hasMore : previous?.hasMore ?? latest!.hasMore, nextBefore: initial ? latest!.nextBefore : previous?.nextBefore }));
        setLastUpdated(Date.now()); setError('');
      } catch (problem) { if (generation.current === session) setError(readable(problem)); }
      finally { if (generation.current === session) { busy.current = false; setLoading(false); } }
    };
    refresh.current = update;
    void update();
    const interval = setInterval(() => { void update(); }, 2000);
    return () => { generation.current++; clearInterval(interval); };
  }, [api, selectedRun]);

  async function loadOlder() {
    if (!page?.hasMore || page.nextBefore === undefined || busy.current) return;
    const session = generation.current;
    busy.current = true; setLoading(true);
    try {
      const result = await api({ type: 'dock:api', command: 'logs', runId: selectedRun || undefined, before: page.nextBefore, limit: PAGE_SIZE });
      if (!result.ok) throw new Error(result.error);
      if (!result.logPage) throw new Error('No older log page was returned.');
      if (generation.current !== session) return;
      loaded.current = [...new Map([...loaded.current, ...result.logPage.events].map(event => [event.seq, event])).values()].sort((a, b) => b.seq - a.seq);
      setEvents(loaded.current); setPage(result.logPage); setError('');
    } catch (problem) { if (generation.current === session) setError(readable(problem)); }
    finally { if (generation.current === session) { busy.current = false; setLoading(false); } }
  }

  async function exportLogs() {
    setWorking('export'); setError(''); setNotice('');
    try {
      const result = await api({ type: 'dock:api', command: 'exportLogs', runId: selectedRun || undefined });
      if (!result.ok) throw new Error(result.error);
      if (!result.logExport) throw new Error('No log export was returned.');
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.logExport, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `dock-logs-${(selectedRun || 'all-activity').replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}.json`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setNotice(`Exported ${number(result.logExport.events.length)} retained events. The export includes all events for this selection, regardless of the search filter.`);
    } catch (problem) { setError(readable(problem)); }
    finally { setWorking(null); }
  }

  async function syncLogs() {
    setWorking('sync'); setError(''); setNotice('');
    try {
      const result = await api({ type: 'dock:api', command: 'syncLogs' });
      if (!result.ok) throw new Error(result.error);
      if (result.logPage) setPage(previous => previous ? { ...previous, persistence: result.logPage!.persistence } : previous);
      setNotice('Local log copy checked. Its status is shown below.');
      await refresh.current();
    } catch (problem) { setError(readable(problem)); }
    finally { setWorking(null); }
  }

  const runs = page?.runs || [];
  const chosen = selectedRun ? runs.filter(run => run.id === selectedRun) : runs;
  const totals = chosen.reduce((sum, run) => ({ requests: sum.requests + run.gmailRequests, units: sum.units + run.estimatedQuotaUnits, labeled: sum.labeled + run.labeled }), { requests: 0, units: 0, labeled: 0 });
  const needle = query.trim().toLocaleLowerCase();
  const visible = events.filter(event => (level === 'all' || (level === 'problems' ? event.level !== 'info' : event.level === 'error')) && (!needle || [event.messageId, event.requestId, event.message, event.event, event.stage, JSON.stringify(event.data || {})].join(' ').toLocaleLowerCase().includes(needle)));
  const persistence = page?.persistence;
  const activeRun = selectedRun && currentRun?.id === selectedRun ? currentRun : undefined;

  return <dialog ref={dialog} className="dock-dialog dock-logs" aria-labelledby="dock-logs-title" aria-describedby="dock-logs-description" onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose}>
    <header className="dock-logs-header"><div><h2 id="dock-logs-title">Run logs</h2><p id="dock-logs-description">Follow each step, inspect requests, and see where a run paused.</p></div><button ref={closeButton} type="button" className="dock-button" aria-label="Close run logs" onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
    <details className="dock-logs-guide"><summary>How sorting works and uses Gmail quota</summary><ol>
      <li><strong>Find messages.</strong> Dock lists Inbox message IDs inside your chosen date window. Each list request costs 5 Gmail units, for up to 500 IDs.</li>
      <li><strong>Prepare labels.</strong> It checks your account and creates or updates the category labels. These requests also use quota.</li>
      <li><strong>Read and classify.</strong> Reading an email costs 20 units. An external text-body fetch adds 20 units when needed. The local helper sends the sender, subject, body, and category descriptions to Jev, then records the returned choice and confidence.</li>
      <li><strong>Apply and save.</strong> Applying the category label costs 5 units. Dock saves the result after each email; a resumed run skips completed emails and reuses saved choices.</li>
      <li><strong>Wait when needed.</strong> All Gmail requests share pacing. A rate-limit response starts a cooldown, then Dock retries. Opening category messages also uses Gmail quota; reading these logs does not.</li>
    </ol><p>A normal sort uses about 25 Gmail units, plus setup, extra body reads, retries, and category browsing. The counters are Dock’s estimates, not Google’s quota balance. Logs show recorded actions, configured category rules, and model results. Logs use message IDs; email subjects, senders, bodies and credentials are excluded. Runs from before this update have no detailed history; resuming them records new steps and keeps their existing progress.</p></details>
    <div className="dock-logs-toolbar"><label htmlFor="dock-log-run">Run history<select id="dock-log-run" value={selectedRun} onChange={event => setSelectedRun(event.target.value)}><option value="">All activity</option>{selectedRun && !runs.some(run => run.id === selectedRun) && <option value={selectedRun}>Current run · {selectedRun}</option>}{runs.map(run => <option key={run.id} value={run.id}>{time(run.startedAt)} · {run.status} · {run.daysBack ? `${run.daysBack} days` : run.id}</option>)}</select></label><button type="button" className="dock-button" disabled={working !== null} onClick={() => { void exportLogs(); }}><Download size={15} aria-hidden="true" />{working === 'export' ? 'Exporting…' : 'Export JSON'}</button></div>
    <dl className="dock-log-totals" aria-label="Run totals"><div><dt>Gmail requests</dt><dd>{number(totals.requests)}</dd></div><div><dt>Estimated quota units</dt><dd>{number(totals.units)}</dd></div><div><dt>Emails labeled</dt><dd>{number(totals.labeled)}</dd></div></dl>
    {!selectedRun && <p className="dock-log-help">Totals summarize retained run histories. The timeline also includes browsing and connection activity.</p>}
    {activeRun && <p className="dock-log-current">Run status: <strong>{activeRun.status}</strong> · {number(activeRun.succeeded)} of {number(activeRun.total)} emails labeled{activeRun.retryAt && activeRun.retryAt > Date.now() ? ` · Waiting for Gmail; retry in ${Math.ceil((activeRun.retryAt - Date.now()) / 1000)} seconds.` : ''}</p>}
    {persistence && <details className="dock-log-persistence"><summary>Log storage · {persistence.mirror === 'saved' ? 'Local copy saved' : persistence.mirror === 'pending' ? 'Local copy pending' : 'Local copy unavailable'}</summary><p>Browser storage: {persistence.browser}. Local copy covers events through #{number(persistence.mirroredThrough)} of #{number(persistence.latestSequence)}.</p>{persistence.path && <p>Local file: <code>{persistence.path}</code></p>}{persistence.error && <p className="dock-error">{persistence.error}</p>}<p>The browser retains up to {number(persistence.retentionLimit)} events. The first available event is #{number(persistence.firstAvailableSequence)}; older browser events may have been removed. Export includes the retained browser history and its coverage details. Browser retention does not delete files already saved by the local helper.</p><button type="button" className="dock-button" disabled={working !== null} onClick={() => { void syncLogs(); }}><RefreshCw size={15} aria-hidden="true" />{working === 'sync' ? 'Checking copy…' : 'Retry local copy'}</button></details>}
    <div className="dock-log-filters"><label htmlFor="dock-log-search">Search loaded events<input id="dock-log-search" type="search" placeholder="Message ID, request ID, or event" value={query} onChange={event => setQuery(event.target.value)} /></label><label htmlFor="dock-log-level">Show<select id="dock-log-level" value={level} onChange={event => setLevel(event.target.value)}><option value="all">All events</option><option value="problems">Warnings and errors</option><option value="error">Errors only</option></select></label></div>
    <p className="dock-log-help" role="status">{loading && !events.length ? 'Loading saved logs…' : `${number(visible.length)} of ${number(events.length)} loaded events · Newest first · Updates every 2 seconds${lastUpdated ? ` · Updated ${new Date(lastUpdated).toLocaleTimeString()}` : ''}`}. Search applies to loaded events; use Load older to include earlier events.</p>
    {error && <p className="dock-error" role="alert">{error} <button type="button" className="dock-button" onClick={() => { void refresh.current(); }}>Refresh logs</button></p>}
    {notice && <p className="dock-log-help" role="status">{notice}</p>}
    <ol className="dock-log-events" aria-label="Log events">{visible.map(event => <li key={event.seq} className={`dock-log-event dock-log-${event.level}`}><details><summary><span className="dock-log-event-meta"><time dateTime={new Date(event.at).toISOString()}>{time(event.at)}</time><span>{event.level} · {event.stage} · #{event.seq}</span></span><strong>{event.message}</strong>{(event.messageId || event.requestId) && <span className="dock-log-event-identifiers">{event.messageId}{event.messageId && event.requestId ? ' · ' : ''}{event.requestId}</span>}</summary><pre aria-label={`Event ${event.seq} JSON`}>{JSON.stringify(event, null, 2)}</pre></details></li>)}</ol>
    {!loading && !visible.length && <p className="dock-log-empty">{events.length ? 'No loaded events match this filter.' : 'No recorded events for this selection yet. Older runs from before logging was added cannot be reconstructed.'}</p>}
    {page?.hasMore && <button type="button" className="dock-button dock-log-older" disabled={loading} onClick={() => { void loadOlder(); }}>{loading ? 'Loading older…' : 'Load older'}</button>}
  </dialog>;
}
