import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ClipboardList, ExternalLink, Factory, Inbox, Plus, ReceiptText, RefreshCw, Settings2, ShieldCheck, ShoppingBag, Package, Users, Star, Tag, Truck, X, type LucideIcon } from 'lucide-react';
import type { DemoStorage } from './App';
import { createInitialState, migrateDemoState, type DemoState } from './data';
import { UNCATEGORIZED, type DockCategory, type DockRequest, type DockResponse, type DockState, type GmailMessageSummary } from '../gmail/protocol';
import { canOpenGmailConversationInPlace } from '../integration/gmail-navigation';
import nativeStyles from './workspace.css?inline';

export type DockApi = (request: DockRequest) => Promise<DockResponse>;
export interface WorkspaceProps {
  storage?: DemoStorage;
  api?: DockApi;
  mode?: 'gmail' | 'outlook' | 'preview';
  tabsTarget: HTMLElement | null;
  controlsTarget?: HTMLElement | null;
  viewTarget?: HTMLElement | null;
  onSelectionChange?: (selected: boolean) => void;
  resetSelectionToken?: number;
}
interface Editor { id?: string; title: string; description: string; icon: string }
const categoryIcons: Record<string, LucideIcon> = { shield: ShieldCheck, truck: Truck, clipboard: ClipboardList, factory: Factory, receipt: ReceiptText, 'shopping-bag': ShoppingBag, package: Package, users: Users, star: Star, tag: Tag, customs: ShieldCheck, shipping: Truck, purchasing: ClipboardList, vendors: Factory, invoices: ReceiptText };
const iconNames = ['tag', 'shield', 'truck', 'clipboard', 'factory', 'receipt', 'star', 'package', 'shopping-bag', 'users'];
const EMPTY_STATE: DockState = { version: 2, categories: [], daysBack: 30, helperReady: false, oauthConfigured: false };

/** Native category tabs and a central mailbox view. Live Gmail and samples stay separate. */
export function Workspace({ storage, api, mode = 'preview', tabsTarget, controlsTarget = tabsTarget, viewTarget = null, onSelectionChange, resetSelectionToken = 0 }: WorkspaceProps) {
  const live = mode === 'gmail' && !!api;
  const [demo, setDemo] = useState<DemoState>(createInitialState);
  const [state, setState] = useState<DockState>(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedMessage, setExpandedMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<GmailMessageSummary[]>([]);
  const [nextPage, setNextPage] = useState<string>();
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageError, setMessageError] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<DockCategory | null>(null);
  const [setup, setSetup] = useState(false);
  const [token, setToken] = useState('');
  const [importJson, setImportJson] = useState('');
  const [resumeRun, setResumeRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [refreshToken, setRefreshToken] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const addRef = useRef<HTMLButtonElement>(null);
  const selectionCallback = useRef(onSelectionChange);
  selectionCallback.current = onSelectionChange;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const categories = live ? state.categories : demo.categories;
  const run = live ? state.run : undefined;
  const running = run?.status === 'running' || run?.status === 'stopping';
  const canResume = run?.status === 'paused' || run?.status === 'failed' || (run?.status === 'completed' && run.failed > 0);
  const scopeDays = canResume && resumeRun ? run!.daysBack : days;
  const missingDescriptions = categories.filter(category => !category.description.trim());
  const dialogOpen = !!editor || !!deleting || setup;

  useEffect(() => {
    let active = true;
    setLoaded(false);
    async function load() {
      try {
        if (live) {
          const result = await api!({ type: 'dock:api', command: 'state' });
          if (!result.ok) throw new Error(result.error);
          if (active && result.state) { setState(result.state); setDays(result.state.daysBack); }
        } else if (storage) {
          const saved = await storage.load();
          if (active) setDemo(migrateDemoState(saved));
        }
      } catch (error) { if (active) setAnnouncement(error instanceof Error ? error.message : 'Dock could not load. Refresh this page to try again.'); }
      finally { if (active) setLoaded(true); }
    }
    void load();
    return () => { active = false; };
  }, [api, live, storage]);

  useEffect(() => {
    if (!live || !running) return;
    let active = true;
    let fetching = false;
    async function poll() {
      if (fetching) return;
      fetching = true;
      try {
        const result = await api!({ type: 'dock:api', command: 'state' });
        if (active && result.ok && result.state) setState(result.state);
      } catch { /* Manual controls still expose actionable failures. */ }
      finally { fetching = false; }
    }
    const interval = setInterval(() => { void poll(); }, 1500);
    return () => { active = false; clearInterval(interval); };
  }, [api, live, running]);

  useEffect(() => {
    setSelectedId(null);
    setExpandedMessage(null);
    selectionCallback.current?.(false);
  }, [resetSelectionToken]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogOpen && !dialog.open) dialog.showModal();
    if (!dialogOpen && dialog.open) dialog.close();
    if (editor) titleRef.current?.focus();
    if (deleting) noRef.current?.focus();
  }, [dialogOpen, editor?.id, !!deleting]);

  useEffect(() => {
    let active = true;
    setMessages([]); setNextPage(undefined); setMessageError('');
    if (!live || !selectedId || !state.accountEmail) { setMessagesLoading(false); return; }
    setMessagesLoading(true);
    async function load() {
      try {
        const result = await api!({ type: 'dock:api', command: 'listMessages', categoryId: selectedId! });
        if (!result.ok) throw new Error(result.error);
        if (active) { setMessages(result.messages ?? []); setNextPage(result.nextPageToken); }
      } catch (error) { if (active) setMessageError(error instanceof Error ? error.message : 'Messages could not be loaded.'); }
      finally { if (active) setMessagesLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [api, live, selectedId, state.accountEmail, run?.status, refreshToken]);

  async function request(message: DockRequest) {
    const result = await api!(message);
    if (!result.ok) throw new Error(result.error);
    if (result.state) setState(result.state);
    return result;
  }
  async function action(message: DockRequest, success?: string) {
    setBusy(true); setFormError(''); setAnnouncement('');
    try { await request(message); if (success) setAnnouncement(success); return true; }
    catch (error) { const text = error instanceof Error ? error.message : 'The action could not be completed.'; setFormError(text); setAnnouncement(text); return false; }
    finally { setBusy(false); }
  }
  async function saveDemo(next: DemoState) {
    if (storage) await storage.save(next);
    setDemo(next);
  }
  function selectSection(id: string) { setSelectedId(id); setExpandedMessage(null); selectionCallback.current?.(true); }
  function backToInbox() { setSelectedId(null); setExpandedMessage(null); selectionCallback.current?.(false); }
  function openConversation(event: MouseEvent<HTMLAnchorElement>, message: GmailMessageSummary) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (canOpenGmailConversationInPlace(state.accountEmail)) {
      event.preventDefault();
      backToInbox();
      // Let Gmail's own router display the conversation without reloading its
      // account path/query. pushState would not emit Gmail's hashchange event.
      window.location.hash = `#all/${encodeURIComponent(message.threadId)}`;
    } else backToInbox();
  }
  function closeDialog() {
    const focusId = editor?.id ?? deleting?.id;
    setEditor(null); setDeleting(null); setSetup(false); setToken(''); setFormError('');
    requestAnimationFrame(() => { if (focusId) tabRefs.current.get(focusId)?.focus(); else addRef.current?.focus(); });
  }
  function editCategory(category?: DockCategory) {
    setFormError('');
    setEditor(category ? { id: category.id, title: category.title, description: category.description, icon: category.icon } : { title: '', description: '', icon: 'tag' });
  }
  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || busy) return;
    const title = editor.title.trim();
    const description = editor.description.trim();
    if (!title || !description) { setFormError('Enter a title and a description so emails can be matched to this category.'); return; }
    if (categories.some(category => category.id !== editor.id && category.title.toLocaleLowerCase() === title.toLocaleLowerCase()) || title.toLocaleLowerCase() === 'uncategorized') { setFormError('A category with that title already exists.'); titleRef.current?.focus(); return; }
    setBusy(true); setFormError('');
    try {
      if (live) await request({ type: 'dock:api', command: 'saveCategory', category: { ...editor, title, description } });
      else {
        const category: DockCategory = { id: editor.id ?? `custom-${crypto.randomUUID()}`, title, description, icon: editor.icon, color: categories.find(item => item.id === editor.id)?.color ?? '#b6cff5' };
        await saveDemo({ ...demo, categories: editor.id ? categories.map(item => item.id === editor.id ? category : item) : [...categories, category] });
      }
      setAnnouncement(`${title} saved.`); closeDialog();
    } catch (error) { setFormError(error instanceof Error ? error.message : 'The category could not be saved.'); }
    finally { setBusy(false); }
  }
  async function deleteCategory() {
    if (!deleting || busy) return;
    setBusy(true); setFormError('');
    try {
      if (live) await request({ type: 'dock:api', command: 'deleteCategory', categoryId: deleting.id });
      else await saveDemo({ ...demo, categories: categories.filter(item => item.id !== deleting.id), messages: demo.messages.map(message => message.categoryId === deleting.id ? { ...message, categoryId: UNCATEGORIZED } : message) });
      if (selectedId === deleting.id) backToInbox();
      setAnnouncement(`${deleting.title} removed. Every email has been kept.`); closeDialog();
    } catch (error) { setFormError(error instanceof Error ? error.message : 'The category could not be removed.'); }
    finally { setBusy(false); }
  }
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'F2' && id !== UNCATEGORIZED && !running) {
      const category = categories.find(item => item.id === id);
      if (category) { event.preventDefault(); editCategory(category); }
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const ids = [...categories.map(category => category.id), UNCATEGORIZED];
    const current = ids.indexOf(id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
    event.preventDefault(); tabRefs.current.get(ids[next]!)?.focus();
  }
  async function categorize() {
    if (!live) { setAnnouncement('Preview only. The installed Gmail extension categorizes your inbox after you connect Gmail and the local helper.'); return; }
    await action(canResume && resumeRun ? { type: 'dock:api', command: 'resume' } : { type: 'dock:api', command: 'start', daysBack: days });
  }
  async function loadMore() {
    if (!nextPage || !selectedId || messagesLoading) return;
    const categoryId = selectedId;
    setMessagesLoading(true); setMessageError('');
    try {
      const result = await request({ type: 'dock:api', command: 'listMessages', categoryId, pageToken: nextPage });
      if (selectedRef.current === categoryId) {
        setMessages(current => [...new Map([...current, ...(result.messages ?? [])].map(message => [message.id, message])).values()]);
        setNextPage(result.nextPageToken);
      }
    } catch (error) { if (selectedRef.current === categoryId) setMessageError(error instanceof Error ? error.message : 'More messages could not be loaded.'); }
    finally { if (selectedRef.current === categoryId) setMessagesLoading(false); }
  }
  const sectionName = selectedId === UNCATEGORIZED ? 'Uncategorized' : categories.find(category => category.id === selectedId)?.title ?? '';
  const demoMessages = demo.messages.filter(message => message.categoryId === selectedId).sort((a, b) => (sort === 'newest' ? -1 : 1) * (a.receivedOrder - b.receivedOrder));
  const orderedMessages = [...messages].sort((a, b) => (sort === 'newest' ? -1 : 1) * (a.receivedAt - b.receivedAt));
  const runText = !run ? '' : run.status === 'running' ? run.retryAt && run.retryAt > Date.now() ? `Waiting for Gmail’s rate limit. Retrying in ${Math.ceil((run.retryAt - Date.now()) / 1000)} seconds; ${run.succeeded} labeled. Completed work is saved.` : run.phase === 'discovering' ? `Finding Inbox messages from the last ${run.daysBack} days…` : `Categorizing: ${run.processed} of ${run.total} messages processed.` : run.status === 'stopping' ? 'Stopping after the current requests finish…' : run.status === 'completed' ? `Finished. ${run.succeeded} labeled, ${run.skipped} skipped, ${run.failed} failed.` : run.status === 'paused' ? `Stopped. ${run.processed} of ${run.total} processed. Completed labels are saved.` : `Run interrupted. ${run.succeeded} labeled; completed work is saved.`;

  function renderTab(category: DockCategory, system = false) {
    const Icon = categoryIcons[category.icon] ?? Tag;
    return <div className={`dock-native-tab-item ${selectedId === category.id ? 'is-active' : ''} ${system ? 'is-system' : ''}`} key={category.id}>
      <button type="button" className="dock-native-tab" role="tab" aria-label={category.title} aria-selected={selectedId === category.id} tabIndex={selectedId === category.id || (!selectedId && category.id === (categories[0]?.id ?? UNCATEGORIZED)) ? 0 : -1} disabled={!loaded} ref={element => { if (element) tabRefs.current.set(category.id, element); else tabRefs.current.delete(category.id); }} onClick={() => selectSection(category.id)} onDoubleClick={() => { if (!system && !running) editCategory(category); }} onKeyDown={event => handleTabKey(event, category.id)}><Icon size={18} aria-hidden="true" /><span>{category.title}</span></button>
      {!system && <span className="dock-tab-actions"><button type="button" aria-label={`Edit ${category.title}`} disabled={running || busy} onClick={() => editCategory(category)}>Edit</button><button type="button" className="dock-tab-delete" aria-label={`Delete ${category.title}`} disabled={running || busy} onClick={() => { setFormError(''); setDeleting(category); }}><X size={14} aria-hidden="true" /></button></span>}
    </div>;
  }

  return <>
    {tabsTarget && createPortal(<>
      <style>{nativeStyles}</style>
      <div className="dock-workspace-controls">
        <div className="dock-native-tabs" role="tablist" aria-label="Dock categories">{categories.map(category => renderTab(category))}{renderTab({ id: UNCATEGORIZED, title: 'Uncategorized', description: '', icon: 'tag', color: '#cccccc' }, true)}<button type="button" className="dock-native-add" aria-label="Add category" ref={addRef} disabled={!loaded || running || busy || categories.length >= 50} onClick={() => editCategory()}><Plus size={20} aria-hidden="true" /></button></div>
      </div>
    </>, tabsTarget)}
    {controlsTarget && createPortal(<>
      <style>{nativeStyles}</style>
      <div className="dock-workspace-controls">
        <div className="dock-controls-row">
          <button type="button" className="dock-button dock-primary" onClick={() => { void categorize(); }} disabled={!loaded || busy || running || (live && (!state.accountEmail || !state.helperReady || !categories.length || !!missingDescriptions.length))}>Categorize emails</button>
          <label className="dock-days" htmlFor="dock-days">Last <output>{scopeDays}</output> days<input id="dock-days" name="days" aria-label="Days back" type="range" min="1" max="365" value={scopeDays} disabled={running || busy || (!!canResume && resumeRun)} onChange={event => { setDays(Number(event.target.value)); }} onPointerUp={() => { if (live) void action({ type: 'dock:api', command: 'setDaysBack', daysBack: days }); }} onKeyUp={event => { if (live && ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) void action({ type: 'dock:api', command: 'setDaysBack', daysBack: days }); }} /></label>
          {running && <button type="button" className="dock-button" disabled={busy || run?.status === 'stopping'} onClick={() => { void action({ type: 'dock:api', command: 'stop' }); }}>Stop</button>}
          {live ? <button type="button" className="dock-button dock-setup-button" onClick={() => { setFormError(''); setSetup(true); }}><Settings2 size={16} aria-hidden="true" />{state.accountEmail ? 'Connection' : 'Connect Gmail'}</button> : <span className="dock-demo-note">{mode === 'outlook' ? 'Outlook demo · account connection not available' : 'Preview · sample messages only'}</span>}
        </div>
        <p className="dock-scope">Only messages currently in Inbox, received in the last {scopeDays} days. Runs only when you press Categorize emails.</p>
        {live && state.accountEmail && <p className="dock-account">Categorization account: {state.accountEmail}</p>}
        {!!missingDescriptions.length && <p className="dock-notice">Add descriptions to {missingDescriptions.map(category => category.title).join(', ')} using Edit before categorizing.</p>}
        {run && <div className="dock-run-status" role="status"><span>{runText}</span>{running && <progress aria-label="Categorization progress" max={Math.max(1, run.total)} value={run.phase === 'discovering' ? undefined : run.processed} />}<span>{canResume && <label className="dock-resume-choice"><input type="checkbox" checked={resumeRun} onChange={event => setResumeRun(event.target.checked)} />Resume unfinished or failed messages when I press Categorize emails</label>}</span>{(run.error || state.error) && <span className="dock-error">{run.error || state.error}</span>}</div>}
        {live && !state.accountEmail && <p className="dock-notice">Connect Gmail and pair the local helper to enable categorization.</p>}
        {announcement && <p className="dock-announcement" role="status">{announcement}</p>}
      </div>
      <dialog ref={dialogRef} className="dock-dialog" aria-labelledby="dock-dialog-title" onCancel={event => { if (busy) event.preventDefault(); else closeDialog(); }}>
        {editor && <form method="dialog" onSubmit={event => { void saveCategory(event); }}><h2 id="dock-dialog-title">{editor.id ? 'Edit category' : 'Create category'}</h2><label htmlFor="dock-category-title">Title<input ref={titleRef} id="dock-category-title" name="title" required maxLength={64} value={editor.title} onChange={event => { setEditor({ ...editor, title: event.target.value }); setFormError(''); }} /></label><label htmlFor="dock-category-description">Description<textarea id="dock-category-description" name="description" required maxLength={1000} rows={3} value={editor.description} aria-describedby="dock-description-help" onChange={event => { setEditor({ ...editor, description: event.target.value }); setFormError(''); }} /></label><p id="dock-description-help" className="dock-field-help">Describe which emails belong here. Jev uses this description to choose among your current categories.</p><label htmlFor="dock-category-icon">Icon<select id="dock-category-icon" name="icon" value={iconNames.includes(editor.icon) ? editor.icon : 'tag'} onChange={event => setEditor({ ...editor, icon: event.target.value })}>{iconNames.map(icon => <option key={icon} value={icon}>{icon[0]!.toUpperCase() + icon.slice(1)}</option>)}</select></label>{formError && <p className="dock-error" role="alert">{formError}</p>}<div className="dock-dialog-actions"><button type="button" className="dock-button" disabled={busy} onClick={closeDialog}>Cancel</button><button type="submit" className="dock-button dock-primary" disabled={busy}>{busy ? 'Saving…' : 'Save category'}</button></div></form>}
        {deleting && <><h2 id="dock-dialog-title">Delete {deleting.title}?</h2><p>Remove this category and its Dock-owned Gmail label from every message? Every email stays in Gmail, including Inbox messages. Unrelated labels stay unchanged.</p><p className="dock-field-help">Messages will no longer appear in this category. A future manual run can categorize them again.</p>{formError && <p className="dock-error" role="alert">{formError}</p>}<div className="dock-dialog-actions"><button type="button" ref={noRef} className="dock-button" disabled={busy} onClick={closeDialog}>No</button><button type="button" className="dock-button dock-primary" disabled={busy} onClick={() => { void deleteCategory(); }}>{busy ? 'Removing…' : 'Yes'}</button></div></>}
        {setup && <><h2 id="dock-dialog-title">Connect Dock</h2><p>Start the local helper, then paste the pairing code copied by helper setup or Copy-Pairing-Code.cmd.</p><form method="dialog" onSubmit={async event => { event.preventDefault(); if (await action({ type: 'dock:api', command: 'pairHelper', token: token.trim() }, 'Local helper paired.')) setToken(''); }}><label htmlFor="dock-helper-token">Helper pairing token<input id="dock-helper-token" name="pairingToken" type="password" autoComplete="off" value={token} required onChange={event => setToken(event.target.value)} /></label><button type="submit" className="dock-button" disabled={busy}>Pair helper</button></form><p className="dock-field-help">{state.helperReady ? 'Helper paired.' : 'Helper not paired.'} {state.oauthConfigured ? 'Google authorization is configured.' : 'Google OAuth setup is required; see INSTALL.md.'}</p><div className="dock-connect-row"><button type="button" className="dock-button dock-primary" disabled={busy || running || !state.oauthConfigured} onClick={() => { void action({ type: 'dock:api', command: 'connect' }, 'Gmail connection updated.'); }}>{state.accountEmail ? 'Reconnect Gmail' : 'Authorize Gmail'}</button>{state.accountEmail && <button type="button" className="dock-button" disabled={busy || running} onClick={() => { void action({ type: 'dock:api', command: 'disconnect' }, 'Gmail disconnected.'); }}>Disconnect</button>}</div>{state.accountEmail && <p className="dock-field-help">Connected as {state.accountEmail}.</p>}<p className="dock-field-help">Google Testing authorization expires after seven days. Return here to reconnect. Google grants the broader gmail.modify permission, which permits reading, changing and sending email. Dock only reads messages and changes its own category labels; it keeps Inbox and unrelated labels.</p><p className="dock-field-help">A manual run sends each selected email’s sender, subject and decoded body to Jev through your local helper for classification.</p><details className="dock-category-transfer"><summary>Import or export categories</summary><p className="dock-field-help">To move categories from the earlier prototype, paste its exported JSON here. Imported categories keep stable IDs. Review and fill in their descriptions before categorizing.</p><form method="dialog" onSubmit={async event => { event.preventDefault(); if (await action({ type: 'dock:api', command: 'importCategories', json: importJson }, 'Categories imported. Review their descriptions before running.')) setImportJson(''); }}><label htmlFor="dock-import-json">Category JSON<textarea id="dock-import-json" name="categoryJson" rows={4} value={importJson} required onChange={event => setImportJson(event.target.value)} /></label><button type="submit" className="dock-button" disabled={busy || running}>Import categories</button></form><label htmlFor="dock-export-json">Copy your category definitions<textarea id="dock-export-json" readOnly rows={4} value={JSON.stringify({ version: 2, categories: categories.map(({ id, title, description, icon, color }) => ({ id, title, description, icon, color })) }, null, 2)} onFocus={event => event.target.select()} /></label><p className="dock-field-help">The export contains definitions only. It contains no Gmail messages, credentials or label memberships.</p></details>{formError && <p className="dock-error" role="alert">{formError}</p>}<div className="dock-dialog-actions"><button type="button" className="dock-button" disabled={busy} onClick={closeDialog}>Done</button></div></>}
      </dialog>
    </>, controlsTarget)}
    {viewTarget && selectedId && createPortal(<>
      <style>{nativeStyles}</style>
      <section className="dock-native-view" aria-label={`${sectionName} ${live ? 'messages' : 'sample messages'}`}>
        <header className="dock-native-view-header"><button type="button" className="dock-native-back" onClick={backToInbox}><ArrowLeft size={18} aria-hidden="true" />Back to inbox</button><span className="dock-native-sample-note">{live ? 'Gmail labels' : 'Sample messages'}</span></header>
        <div className="dock-native-heading"><h1>{sectionName}</h1><div className="dock-message-controls"><label htmlFor="dock-message-sort" className="dock-native-sr-only">Message order</label><select id="dock-message-sort" value={sort} onChange={event => setSort(event.target.value as 'newest' | 'oldest')}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>{live && <button type="button" aria-label="Refresh category messages" disabled={messagesLoading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={17} aria-hidden="true" /></button>}<span>{live ? messages.length : demoMessages.length}{nextPage ? '+' : ''} messages</span></div></div>
        {live && <p className="dock-view-scope">{selectedId === UNCATEGORIZED ? 'Messages explicitly assigned no matching category by a manual run.' : 'All messages carrying this category’s Gmail label, including messages outside the latest run’s date window.'} {nextPage && 'Sort applies to loaded messages.'}</p>}
        {messageError && <p className="dock-error dock-view-scope" role="alert">{messageError}</p>}
        {live ? <>{orderedMessages.length > 0 ? <div className="dock-native-message-list" role="list">{orderedMessages.map(message => <article className="dock-native-message" key={message.id} role="listitem"><a href={message.gmailUrl} className={`dock-native-message-row ${message.unread ? 'is-unread' : ''}`} aria-label={`Open Gmail conversation: ${message.subject}`} onClick={event => openConversation(event, message)}><strong className="dock-native-sender">{message.sender}</strong><span className="dock-native-message-text"><strong>{message.subject || '(no subject)'}</strong><span className="dock-native-snippet"> — {message.snippet}</span></span><time dateTime={new Date(message.receivedAt).toISOString()}>{new Date(message.receivedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time><ExternalLink size={15} aria-hidden="true" /></a></article>)}</div> : !messagesLoading && !messageError && <div className="dock-native-empty"><Inbox size={36} strokeWidth={1.4} aria-hidden="true" /><h2>{state.accountEmail ? 'No messages in this category' : 'Connect Gmail to view messages'}</h2><p>{state.accountEmail ? 'Use Categorize emails to apply your categories to the selected Inbox window.' : 'Open Connect Gmail above to authorize your account.'}</p></div>}{messagesLoading && <p className="dock-view-scope" role="status">Loading messages…</p>}{nextPage && <button type="button" className="dock-button dock-load-more" disabled={messagesLoading} onClick={() => { void loadMore(); }}>Load more messages</button>}<p className="dock-native-content-note"><Check size={14} aria-hidden="true" />Categories are stored as colored Gmail labels. Gmail may need a refresh to show newly applied labels.</p></> : <>{demoMessages.length ? <div className="dock-native-message-list" role="list">{demoMessages.map(message => <article className="dock-native-message" key={message.id} role="listitem"><button type="button" className={`dock-native-message-row ${expandedMessage === message.id ? 'is-expanded' : ''}`} aria-expanded={expandedMessage === message.id} aria-label={`Open sample message: ${message.subject}`} onClick={() => setExpandedMessage(expandedMessage === message.id ? null : message.id)}><Star className="dock-native-row-star" size={18} aria-hidden="true" /><strong className="dock-native-sender">{message.sender}</strong><span className="dock-native-message-text"><strong>{message.subject}</strong><span className="dock-native-snippet"> — {message.preview}</span></span><time>{message.time}</time></button>{expandedMessage === message.id && <div className="dock-native-expanded"><div><span>{message.sender}</span><button type="button" aria-label="Close sample message" onClick={() => setExpandedMessage(null)}><X size={18} /></button></div><p>{message.body}</p></div>}</article>)}</div> : <div className="dock-native-empty"><Inbox size={36} strokeWidth={1.4} aria-hidden="true" /><h2>No sample messages in this category</h2><p>Your category is ready to use.</p></div>}<p className="dock-native-content-note">{mode === 'outlook' ? 'Outlook account and API support are not implemented. These are samples only.' : 'This preview uses sample messages. Your real inbox is unchanged.'}</p></>}
      </section>
    </>, viewTarget)}
  </>;
}
export default Workspace;



