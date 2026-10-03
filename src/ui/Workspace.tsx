import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ClipboardList, Factory, Inbox, Plus, ReceiptText, Settings2, ShieldCheck, ShoppingBag, Package, Users, Star, Tag, Truck, X, type LucideIcon } from 'lucide-react';
import { createInitialState, migrateDemoState, sampleMessages, type DemoState, type DemoStorage } from './data';
import { GmailUsage } from './GmailUsage';
import { RunErrors } from './RunErrors';
import { useAnchoredPopover } from './useAnchoredPopover';
import { UNCATEGORIZED, type DockCategory, type DockRequest, type DockResponse, type DockState } from '../gmail/protocol';
import { COLORS, DEFAULT_CATEGORY_TITLE, DAYS_BACK_MIN, DAYS_BACK_MAX, clampDaysBack, isStarterCategory } from '../gmail/model';
import { canOpenGmailInPlace, getGmailLabelFromRoute, gmailLabelHash, openGmailRoute } from '../integration/gmail-navigation';
import nativeStyles from './workspace.css?inline';

export type DockApi = (request: DockRequest) => Promise<DockResponse>;
interface WorkspaceProps {
  storage?: DemoStorage;
  api?: DockApi;
  mode?: 'gmail' | 'outlook' | 'preview';
  tabsTarget: HTMLElement | null;
  controlsTarget?: HTMLElement | null;
  viewTarget?: HTMLElement | null;
  onSelectionChange?: (selected: boolean) => void;
  resetSelectionToken?: number;
}
interface Editor extends Pick<DockCategory, 'title' | 'description' | 'icon' | 'color'> { id?: string }
const categoryIcons: Record<string, LucideIcon> = { shield: ShieldCheck, truck: Truck, clipboard: ClipboardList, factory: Factory, receipt: ReceiptText, 'shopping-bag': ShoppingBag, package: Package, users: Users, star: Star, tag: Tag, customs: ShieldCheck, shipping: Truck, purchasing: ClipboardList, vendors: Factory, invoices: ReceiptText };
const iconNames = ['tag', 'shield', 'truck', 'clipboard', 'factory', 'receipt', 'star', 'package', 'shopping-bag', 'users'];
const colorNames = ['Blue', 'Purple', 'Yellow', 'Pink', 'Green', 'Orange', 'Gray'];
const EMPTY_STATE: DockState = { version: 2, categories: [], daysBack: 30, helperReady: false, oauthConfigured: false };

/** Live category tabs open Gmail labels. Only demos render a Dock message list. */
export function Workspace({ storage, api, mode = 'preview', tabsTarget, controlsTarget = tabsTarget, viewTarget = null, onSelectionChange, resetSelectionToken = 0 }: WorkspaceProps) {
  const live = mode === 'gmail' && !!api;
  const [demo, setDemo] = useState<DemoState>(createInitialState);
  const [state, setState] = useState<DockState>(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedMessage, setExpandedMessage] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<DockCategory | null>(null);
  const [setup, setSetup] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [token, setToken] = useState('');
  const [importJson, setImportJson] = useState('');
  const [resumeRun, setResumeRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const editorAnchorRef = useRef<HTMLElement | null>(null);
  const editorTriggerRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const addRef = useRef<HTMLButtonElement>(null);
  const usageRef = useRef<HTMLButtonElement>(null);
  const selectionCallback = useRef(onSelectionChange);
  selectionCallback.current = onSelectionChange;
  const previousLabelView = useRef<{ id: string; name: string; accountEmail: string } | null>(null);
  const categories = live ? state.categories : demo.categories;
  const run = live ? state.run : undefined;
  const running = run?.status === 'running' || run?.status === 'stopping';
  const canResume = run?.status === 'paused' || run?.status === 'failed' || (run?.status === 'completed' && run.failed > 0);
  const scopeDays = run && (running || (canResume && resumeRun)) ? run.daysBack : days;
  const incompleteCategories = categories.filter(category => isStarterCategory(category) || !category.description.trim());
  const dialogOpen = !!deleting || setup || usageOpen;

  useEffect(() => {
    let active = true;
    setLoaded(false);
    async function load() {
      try {
        if (live) {
          const result = await api!({ type: 'dock:api', command: 'state' });
          if (!result.ok) throw new Error(result.error);
          if (active && result.state) { setState(result.state); setDays(clampDaysBack(result.state.daysBack)); }
          if (active && result.state?.accountEmail) {
            const labels = await api!({ type: 'dock:api', command: 'refreshLabels' });
            if (!labels.ok) throw new Error(labels.error);
            if (active && labels.state) setState(labels.state);
          }
        } else if (storage) {
          const saved = await storage.load();
          if (active) setDemo(migrateDemoState(saved));
        }
      } catch (error) { if (active) setFormError(error instanceof Error ? error.message : 'Dock could not load. Refresh this page to try again.'); }
      finally { if (active) setLoaded(true); }
    }
    void load();
    return () => { active = false; };
  }, [api, live, storage]);

  useEffect(() => {
    if (!live || (!running && !usageOpen)) return;
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
  }, [api, live, running, usageOpen]);

  useEffect(() => {
    if (live) return;
    setSelectedId(null);
    setExpandedMessage(null);
    selectionCallback.current?.(false);
  }, [live, resetSelectionToken]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogOpen && !dialog.open) dialog.showModal();
    if (!dialogOpen && dialog.open) dialog.close();
    if (deleting) noRef.current?.focus();
  }, [dialogOpen, !!deleting]);

  useAnchoredPopover({
    open: !!editor, resetKey: editor?.id, panelRef: editorRef, anchorRef: editorAnchorRef,
    triggerRef: editorTriggerRef, layoutTarget: tabsTarget, onClose: () => closeEditor(false),
    onOpen: () => {
      titleRef.current?.focus({ preventScroll: true });
      if (editor?.title === DEFAULT_CATEGORY_TITLE) titleRef.current?.select();
    },
  });
  useEffect(() => {
    if (!live) return;
    function syncSelection() {
      const label = canOpenGmailInPlace(state.accountEmail) ? getGmailLabelFromRoute(window.location.hash) : null;
      const id = label === null ? null : categories.find(category => category.labelName === label)?.id
        ?? (state.uncategorizedLabelName === label ? UNCATEGORIZED : null);
      const previous = previousLabelView.current;
      if (!id && label && previous?.name === label && previous.accountEmail === state.accountEmail) {
        const renamed = previous.id === UNCATEGORIZED ? state.uncategorizedLabelName : categories.find(category => category.id === previous.id)?.labelName;
        if (renamed) {
          openGmailRoute(previous.accountEmail, gmailLabelHash(renamed));
          return;
        }
      }
      previousLabelView.current = id && label && state.accountEmail ? { id, name: label, accountEmail: state.accountEmail } : null;
      setSelectedId(id);
      selectionCallback.current?.(false);
    }
    syncSelection();
    window.addEventListener('hashchange', syncSelection);
    window.addEventListener('popstate', syncSelection);
    return () => { window.removeEventListener('hashchange', syncSelection); window.removeEventListener('popstate', syncSelection); };
  }, [live, state.accountEmail, categories, state.uncategorizedLabelName, resetSelectionToken]);

  async function request(message: DockRequest) {
    const result = await api!(message);
    if (!result.ok) throw new Error(result.error);
    if (result.state) setState(result.state);
    if (message.command === 'connect' || message.command === 'importCategories') {
      if (result.state?.accountEmail) {
        const labels = await api!({ type: 'dock:api', command: 'refreshLabels' });
        if (!labels.ok) throw new Error(labels.error);
        if (labels.state) setState(labels.state);
      }
    }
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
  function selectSection(id: string) {
    setFormError('');
    const category = categories.find(item => item.id === id);
    if (category && isStarterCategory(category)) { editCategory(category); return; }
    if (live) {
      if (!state.accountEmail) { setSetup(true); return; }
      const label = id === UNCATEGORIZED ? state.uncategorizedLabelName : categories.find(category => category.id === id)?.labelName;
      if (!label) { setFormError('This category has no available Gmail label. Refresh Gmail to reload labels, or press Categorize emails to create missing labels.'); return; }
      openGmailRoute(state.accountEmail, gmailLabelHash(label));
      return;
    }
    setSelectedId(id); setExpandedMessage(null); selectionCallback.current?.(true);
  }
  function backToInbox() {
    setSelectedId(null); setExpandedMessage(null); selectionCallback.current?.(false);
    if (live && state.accountEmail) openGmailRoute(state.accountEmail, '#inbox');
  }
  function closeDialog() {
    const focusId = deleting?.id;
    setDeleting(null); setSetup(false); setUsageOpen(false); setToken(''); setFormError('');
    requestAnimationFrame(() => {
      const target = usageOpen ? usageRef.current : setup ? controlsTarget?.querySelector<HTMLButtonElement>('.dock-setup-button')
        : focusId ? tabRefs.current.get(focusId) : addRef.current;
      target?.focus({ preventScroll: true });
    });
  }
  function closeEditor(restoreFocus = true) {
    setEditor(null); setFormError('');
    if (restoreFocus) {
      const trigger = editorTriggerRef.current;
      requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); });
    }
  }
  function editCategory(category?: DockCategory, trigger?: HTMLElement) {
    if (busy || running) return;
    setFormError('');
    const tab = category ? tabRefs.current.get(category.id) : addRef.current;
    editorAnchorRef.current = tab?.closest<HTMLElement>('.dock-native-tab-item') ?? tab ?? null;
    editorTriggerRef.current = trigger ?? tab ?? null;
    setEditor(category ? { id: category.id, title: category.title, description: category.description, icon: category.icon, color: category.color } : { title: '', description: '', icon: 'tag', color: COLORS[categories.length % COLORS.length]! });
  }
  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || busy) return;
    const title = editor.title.trim();
    const description = editor.description.trim();
    if (!title || !description) { setFormError('Enter a name and description.'); return; }
    if (title.toLocaleLowerCase() === DEFAULT_CATEGORY_TITLE.toLocaleLowerCase()) { setFormError('Replace Edit Me! with a category name.'); titleRef.current?.focus(); return; }
    if (categories.some(category => category.id !== editor.id && category.title.toLocaleLowerCase() === title.toLocaleLowerCase()) || title.toLocaleLowerCase() === 'uncategorized') { setFormError('A category with that name already exists.'); titleRef.current?.focus(); return; }
    setBusy(true); setFormError('');
    try {
      if (live) {
        const result = await request({ type: 'dock:api', command: 'saveCategory', category: { ...editor, title, description } });
        const renamed = result.state?.categories.find(category => category.id === editor.id)?.labelName;
        if (selectedId === editor.id && renamed && state.accountEmail) openGmailRoute(state.accountEmail, gmailLabelHash(renamed));
      }
      else {
        const category: DockCategory = { id: editor.id ?? `custom-${crypto.randomUUID()}`, title, description, icon: editor.icon, color: editor.color };
        await saveDemo({ ...demo, categories: editor.id ? categories.map(item => item.id === editor.id ? category : item) : [...categories, category] });
      }
      setAnnouncement(`${title} saved.`); closeEditor();
    } catch (error) { setFormError(error instanceof Error ? error.message : 'The category could not be saved.'); }
    finally { setBusy(false); }
  }
  async function deleteCategory() {
    if (!deleting || busy) return;
    setBusy(true); setFormError('');
    try {
      if (live) await request({ type: 'dock:api', command: 'deleteCategory', categoryId: deleting.id });
      else await saveDemo({ ...demo, categories: categories.filter(item => item.id !== deleting.id) });
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
  const sectionName = selectedId === UNCATEGORIZED ? 'Uncategorized' : categories.find(category => category.id === selectedId)?.title ?? '';
  const demoMessages = live ? [] : sampleMessages.filter(message => selectedId === UNCATEGORIZED
    ? !categories.some(category => category.id === message.categoryId)
    : message.categoryId === selectedId).sort((a, b) => (sort === 'newest' ? -1 : 1) * (a.receivedOrder - b.receivedOrder));
  const runDetails = !run ? '' : run.status === 'running'
    ? run.retryAt && run.retryAt > Date.now()
      ? `Retry in ${Math.ceil((run.retryAt - Date.now()) / 1000)}s`
      : run.phase === 'discovering' ? 'Finding emails…' : `${run.processed}/${run.total} processed`
    : run.status === 'completed' ? 'Done'
      : `${run.processed}/${run.total} processed · ${run.status === 'stopping' ? 'Stopping…' : run.status === 'paused' ? 'Stopped' : 'Interrupted'}`;
  const runText = run ? [`${run.succeeded} labeled`, runDetails, ...(run.skipped ? [`${run.skipped} skipped`] : []), ...(run.failed ? [`${run.failed} failed`] : [])].join(' · ') : '';
  const toolbarError = (!dialogOpen && !editor && formError) || state.error;
  const EditorIcon = categoryIcons[editor?.icon ?? 'tag'] ?? Tag;

  function renderTab(category: DockCategory, system = false) {
    const Icon = categoryIcons[category.icon] ?? Tag;
    return <div className={`dock-native-tab-item ${selectedId === category.id ? 'is-active' : ''} ${system ? 'is-system' : ''}`} key={category.id}>
      <button type="button" className="dock-native-tab" role="tab" aria-label={category.title} aria-selected={selectedId === category.id} tabIndex={selectedId === category.id || (!selectedId && category.id === (categories[0]?.id ?? UNCATEGORIZED)) ? 0 : -1} disabled={!loaded} ref={element => { if (element) tabRefs.current.set(category.id, element); else tabRefs.current.delete(category.id); }} onClick={() => selectSection(category.id)} onDoubleClick={() => { if (!system && !running) editCategory(category); }} onKeyDown={event => handleTabKey(event, category.id)}><Icon className={system ? undefined : 'dock-category-icon'} style={system ? undefined : { backgroundColor: category.color }} size={18} aria-hidden="true" /><span>{category.title}</span></button>
      {!system && <span className="dock-tab-actions"><button type="button" aria-label={`Edit ${category.title}`} aria-haspopup="dialog" aria-expanded={editor?.id === category.id} disabled={running || busy} onClick={event => editCategory(category, event.currentTarget)}>Edit</button><button type="button" className="dock-tab-delete" aria-label={`Delete ${category.title}`} disabled={running || busy} onClick={() => { closeEditor(false); setFormError(''); setDeleting(category); }}><X size={14} aria-hidden="true" /></button></span>}
    </div>;
  }

  return <>
    {tabsTarget && createPortal(<>
      <style>{nativeStyles}</style>
      <div className="dock-workspace-controls">
        <div className="dock-native-tabs" role="tablist" aria-label="Dock categories">{categories.map(category => renderTab(category))}{renderTab({ id: UNCATEGORIZED, title: 'Uncategorized', description: '', icon: 'tag', color: '#cccccc' }, true)}<button type="button" className="dock-native-add" aria-label="Add category" ref={addRef} disabled={!loaded || running || busy || categories.length >= 50} onClick={() => editCategory()}><Plus size={20} aria-hidden="true" /></button></div>
      </div>
      {editor && <div ref={editorRef} id="dock-category-editor" popover="auto" role="dialog" aria-labelledby="dock-editor-title" className="dock-dialog dock-category-editor" onToggle={event => { if (event.newState === 'closed') closeEditor(false); }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeEditor(); } }}>
        <form onSubmit={event => { void saveCategory(event); }}>
          <h2 id="dock-editor-title" className="dock-native-sr-only">{editor.id ? 'Edit category' : 'Create category'}</h2>
          <div className="dock-editor-options">
            <label htmlFor="dock-category-icon">Icon<span className="dock-editor-select"><EditorIcon size={16} aria-hidden="true" /><select id="dock-category-icon" name="icon" value={iconNames.includes(editor.icon) ? editor.icon : 'tag'} disabled={busy} onChange={event => setEditor({ ...editor, icon: event.target.value })}>{iconNames.map(icon => <option key={icon} value={icon}>{icon[0]!.toUpperCase() + icon.slice(1).replace('-', ' ')}</option>)}</select></span></label>
            <label htmlFor="dock-category-color">Color<span className="dock-editor-select"><span className="dock-color-swatch" style={{ backgroundColor: editor.color }} aria-hidden="true" /><select id="dock-category-color" name="color" value={editor.color} disabled={busy} onChange={event => setEditor({ ...editor, color: event.target.value })}>{!COLORS.includes(editor.color) && <option value={editor.color}>Current color</option>}{COLORS.map((color, index) => <option key={color} value={color}>{colorNames[index]}</option>)}</select></span></label>
          </div>
          <label htmlFor="dock-category-title">Name<input ref={titleRef} id="dock-category-title" name="title" required maxLength={64} autoComplete="off" disabled={busy} value={editor.title} onChange={event => { setEditor({ ...editor, title: event.target.value }); setFormError(''); }} /></label>
          <label htmlFor="dock-category-description">Description<textarea id="dock-category-description" name="description" required maxLength={1000} rows={2} placeholder="Which emails belong here?" disabled={busy} value={editor.description} onChange={event => { setEditor({ ...editor, description: event.target.value }); setFormError(''); }} /></label>
          {formError && <p className="dock-error" role="alert">{formError}</p>}
          <div className="dock-dialog-actions"><button type="button" className="dock-button" disabled={busy} onClick={() => closeEditor()}>Cancel</button><button type="submit" className="dock-button dock-primary" disabled={busy}>{busy ? 'Saving…' : 'Save category'}</button></div>
        </form>
      </div>}
    </>, tabsTarget)}
    {controlsTarget && createPortal(<>
      <style>{nativeStyles}</style>
      <div className="dock-workspace-controls">
        <div className="dock-controls-row">
          <button type="button" className="dock-button dock-primary" onClick={() => { void categorize(); }} disabled={!loaded || busy || running || (live && (!state.accountEmail || !state.helperReady || !categories.length || !!incompleteCategories.length))}>Categorize emails</button>
          <label className="dock-days" htmlFor="dock-days">Last <output>{scopeDays}</output> days<input id="dock-days" name="days" aria-label="Days back" aria-valuetext={`${scopeDays} days`} type="range" min={DAYS_BACK_MIN} max={DAYS_BACK_MAX} value={clampDaysBack(scopeDays)} disabled={running || busy || (!!canResume && resumeRun)} onChange={event => { setDays(Number(event.target.value)); }} onPointerUp={() => { if (live) void action({ type: 'dock:api', command: 'setDaysBack', daysBack: days }); }} onKeyUp={event => { if (live && ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) void action({ type: 'dock:api', command: 'setDaysBack', daysBack: days }); }} /></label>
          {running && <progress className="dock-run-progress" aria-label="Categorization progress" max={Math.max(1, run.total)} value={run.phase === 'discovering' ? undefined : run.processed} />}
          {run && <div className="dock-run-status" role="status"><span className="dock-run-summary">{runText}</span>{canResume && <label className="dock-resume-choice" title="Resume unfinished or failed messages when I press Categorize emails"><input type="checkbox" checked={resumeRun} onChange={event => setResumeRun(event.target.checked)} />Resume unfinished</label>}</div>}
          {running && <button type="button" className="dock-button" disabled={busy || run?.status === 'stopping'} onClick={() => { void action({ type: 'dock:api', command: 'stop' }); }}>Stop</button>}
          {live && <button type="button" className="dock-button" ref={usageRef} disabled={!loaded} aria-haspopup="dialog" onClick={() => setUsageOpen(true)}>Gmail usage</button>}
          {toolbarError && <span className="dock-error dock-toolbar-error" role="alert" title={toolbarError}>{toolbarError}</span>}
          {run && (run.error || run.failed > 0 || !!run.failures?.length) && <RunErrors key={run.id} run={run} accountEmail={run.accountEmail || state.accountEmail} layoutTarget={controlsTarget} onRefresh={async () => {
            const result = await api!({ type: 'dock:api', command: 'refreshRunErrors', runId: run.id });
            if (!result.ok) throw new Error(result.error);
            const refreshed = result.state?.run;
            if (refreshed) setState(current => current.run?.id === refreshed.id && current.run.updatedAt === refreshed.updatedAt
              ? { ...current, run: { ...current.run, failures: refreshed.failures } } : current);
          }} />}
          {!!incompleteCategories.length && <span className="dock-notice">Name and describe your categories to begin.</span>}
          {live ? <button type="button" className={`dock-button dock-setup-button ${state.accountEmail ? 'is-connected' : ''}`} aria-label={state.accountEmail ? 'Connection' : 'Connect Gmail'} title={state.accountEmail ? 'Connection' : 'Connect Gmail'} onClick={() => { setFormError(''); setSetup(true); }}><Settings2 size={16} aria-hidden="true" />{!state.accountEmail && 'Connect Gmail'}</button> : <span className="dock-demo-note">{mode === 'outlook' ? 'Outlook demo · account connection not available' : 'Preview · sample messages only'}</span>}
        </div>
        {announcement && <span className={live ? 'dock-native-sr-only' : 'dock-announcement'} role="status">{announcement}</span>}
      </div>
      <dialog ref={dialogRef} className={`dock-dialog${usageOpen ? ' dock-usage-dialog' : ''}`} aria-labelledby="dock-dialog-title" onCancel={event => { if (busy && !usageOpen) event.preventDefault(); else closeDialog(); }}>
        {usageOpen && <GmailUsage run={run} runHistory={state.runHistory} onClose={closeDialog} />}
        {deleting && <><h2 id="dock-dialog-title">Delete {deleting.title}?</h2><p>Remove this category and its Dock-owned Gmail label from every message? Every email stays in Gmail, including Inbox messages. Unrelated labels stay unchanged.</p><p className="dock-field-help">Messages will no longer appear in this category. A future manual run can categorize them again.</p>{formError && <p className="dock-error" role="alert">{formError}</p>}<div className="dock-dialog-actions"><button type="button" ref={noRef} className="dock-button" disabled={busy} onClick={closeDialog}>No</button><button type="button" className="dock-button dock-primary" disabled={busy} onClick={() => { void deleteCategory(); }}>{busy ? 'Removing…' : 'Yes'}</button></div></>}
        {setup && <><h2 id="dock-dialog-title">Connect Dock</h2><p>Start the local helper, then paste the pairing code copied by helper setup or Copy-Pairing-Code.cmd.</p><form method="dialog" onSubmit={async event => { event.preventDefault(); if (await action({ type: 'dock:api', command: 'pairHelper', token: token.trim() }, 'Local helper paired.')) setToken(''); }}><label htmlFor="dock-helper-token">Helper pairing token<input id="dock-helper-token" name="pairingToken" type="password" autoComplete="off" value={token} required onChange={event => setToken(event.target.value)} /></label><button type="submit" className="dock-button" disabled={busy}>Pair helper</button></form><p className="dock-field-help">{state.helperReady ? 'Helper paired.' : 'Helper not paired.'} {state.oauthConfigured ? 'Google authorization is configured.' : 'Google OAuth setup is required; see INSTALL.md.'}</p><div className="dock-connect-row"><button type="button" className="dock-button dock-primary" disabled={busy || running || !state.oauthConfigured} onClick={() => { void action({ type: 'dock:api', command: 'connect' }, 'Gmail connection updated.'); }}>{state.accountEmail ? 'Reconnect Gmail' : 'Authorize Gmail'}</button>{state.accountEmail && <button type="button" className="dock-button" disabled={busy || running} onClick={() => { void action({ type: 'dock:api', command: 'disconnect' }, 'Gmail disconnected.'); }}>Disconnect</button>}</div>{state.accountEmail && <p className="dock-field-help">Connected as {state.accountEmail}.</p>}<p className="dock-field-help">Google Testing authorization expires after seven days. Return here to reconnect. Google grants the broader gmail.modify permission, which permits reading, changing and sending email. Dock only reads messages and changes its own category labels; it keeps Inbox and unrelated labels.</p><p className="dock-field-help">A manual run sends each selected email’s sender, subject and decoded body to Jev through your local helper for classification.</p><details className="dock-category-transfer"><summary>Import or export categories</summary><p className="dock-field-help">To move categories from the earlier prototype, paste its exported JSON here. Imported categories keep stable IDs. Review and fill in their descriptions before categorizing.</p><form method="dialog" onSubmit={async event => { event.preventDefault(); if (await action({ type: 'dock:api', command: 'importCategories', json: importJson }, 'Categories imported. Review their descriptions before running.')) setImportJson(''); }}><label htmlFor="dock-import-json">Category JSON<textarea id="dock-import-json" name="categoryJson" rows={4} value={importJson} required onChange={event => setImportJson(event.target.value)} /></label><button type="submit" className="dock-button" disabled={busy || running}>Import categories</button></form><label htmlFor="dock-export-json">Copy your category definitions<textarea id="dock-export-json" readOnly rows={4} value={JSON.stringify({ version: 2, categories: categories.map(({ id, title, description, icon, color }) => ({ id, title, description, icon, color })) }, null, 2)} onFocus={event => event.target.select()} /></label><p className="dock-field-help">The export contains definitions only. It contains no Gmail messages, credentials or label memberships.</p></details>{formError && <p className="dock-error" role="alert">{formError}</p>}<div className="dock-dialog-actions"><button type="button" className="dock-button" disabled={busy} onClick={closeDialog}>Done</button></div></>}
      </dialog>
    </>, controlsTarget)}
    {!live && viewTarget && selectedId && createPortal(<>
      <style>{nativeStyles}</style>
      <section className="dock-native-view" aria-label={`${sectionName} sample messages`}>
        <header className="dock-native-view-header"><button type="button" className="dock-native-back" onClick={backToInbox}><ArrowLeft size={18} aria-hidden="true" />Back to inbox</button><span className="dock-native-sample-note">Sample messages</span></header>
        <div className="dock-native-heading"><h1>{sectionName}</h1><div className="dock-message-controls"><label htmlFor="dock-message-sort" className="dock-native-sr-only">Message order</label><select id="dock-message-sort" value={sort} onChange={event => setSort(event.target.value as 'newest' | 'oldest')}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select><span>{demoMessages.length} messages</span></div></div>
        {demoMessages.length ? <div className="dock-native-message-list" role="list">{demoMessages.map(message => <article className="dock-native-message" key={message.id} role="listitem"><button type="button" className={`dock-native-message-row ${expandedMessage === message.id ? 'is-expanded' : ''}`} aria-expanded={expandedMessage === message.id} aria-label={`Open sample message: ${message.subject}`} onClick={() => setExpandedMessage(expandedMessage === message.id ? null : message.id)}><Star className="dock-native-row-star" size={18} aria-hidden="true" /><strong className="dock-native-sender">{message.sender}</strong><span className="dock-native-message-text"><strong>{message.subject}</strong><span className="dock-native-snippet"> — {message.preview}</span></span><time>{message.time}</time></button>{expandedMessage === message.id && <div className="dock-native-expanded"><div><span>{message.sender}</span><button type="button" aria-label="Close sample message" onClick={() => setExpandedMessage(null)}><X size={18} /></button></div><p>{message.body}</p></div>}</article>)}</div> : <div className="dock-native-empty"><Inbox size={36} strokeWidth={1.4} aria-hidden="true" /><h2>No sample messages in this category</h2><p>Your category is ready to use.</p></div>}<p className="dock-native-content-note">{mode === 'outlook' ? 'Outlook account and API support are not implemented. These are samples only.' : 'This preview uses sample messages. Your real inbox is unchanged.'}</p>
      </section>
    </>, viewTarget)}
  </>;
}
