import { decodedBody, header, type GmailFullMessage } from './mime';
import { COLORS, initialState, labelName, publicState, recalculate, type Classification, type StoredRun, type StoredState } from './model';
import { HELPER_URL, UNCATEGORIZED, type DockCategory, type DockRequest, type DockResponse, type GmailMessageSummary } from './protocol';
import { ApiError, GmailNetworkError, GmailRequests, RunStoppedError } from './requests';
import type { LogDraft } from './log-types';

export interface EngineDependencies {
  load(): Promise<StoredState | undefined>;
  save(state: StoredState): Promise<void>;
  legacy(): Promise<unknown>;
  token(interactive: boolean): Promise<string>;
  invalidateToken(token: string): Promise<void>;
  disconnect(): Promise<void>;
  fetch: typeof fetch;
  oauthConfigured: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  uuid?: () => string;
  log?: (event: LogDraft) => Promise<void>;
}
interface Label { id: string; name: string; type?: string }
class PauseRunError extends Error {}
const active = (run?: StoredRun) => run?.status === 'running' || run?.status === 'stopping';
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request failed. Try again.';
const categorySignature = (categories: DockCategory[]) => JSON.stringify(categories.map(({ id, title, description }) => ({ id, title, description })));

/** Only an explicit start/resume command enters drain(). No alarms, onStartup work, or mail watchers. */
export class GmailEngine {
  private readonly owner: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly uuid: () => string;
  // These coordinate this worker lifetime only. Every recoverable datum is saved in extension storage.
  private transactionTail: Promise<unknown> = Promise.resolve();
  private commandTail: Promise<unknown> = Promise.resolve();
  private running: Promise<void> | undefined;
  private tokenProfiles = new Map<string, string>();
  private readonly requests: GmailRequests;
  constructor(private readonly deps: EngineDependencies) {
    this.now = deps.now || Date.now;
    this.sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.uuid = deps.uuid || (() => crypto.randomUUID());
    this.owner = this.uuid();
    this.requests = new GmailRequests({
      log: async (event) => await this.log(event), uuid: this.uuid,
      logRunId: async () => { const run = (await this.read()).run; return active(run) ? run!.id : undefined; },
      fetch: (...args) => this.deps.fetch(...args), now: this.now, sleep: (ms) => this.sleep(ms),
      traffic: async (change) => await this.update((state) => change(state.gmailTraffic ||= {})),
      check: async (runId) => {
        const state = await this.read();
        if (runId && (state.run?.id !== runId || state.run.status !== 'running')) throw new RunStoppedError();
      },
      waiting: async (until, runId) => {
        await this.update((state) => {
          if (state.run?.status === 'running' && (!runId || state.run.id === runId)) {
            state.run.retryAt = until;
            state.run.updatedAt = this.now();
          }
        });
      },
      ready: async (runId) => {
        await this.update((state) => {
          if (state.run && (!runId || state.run.id === runId) && (state.run.retryAt || 0) <= this.now()) delete state.run.retryAt;
        });
      },
    });
  }
  private async log(event: Omit<LogDraft, 'at'> & { at?: number }): Promise<void> {
    if (!this.deps.log) return;
    try {
      let runId = event.runId;
      if (!runId) { const run = (await this.read()).run; if (active(run)) runId = run!.id; }
      await this.deps.log({ ...event, at: event.at ?? this.now(), ...(runId ? { runId } : {}) });
    } catch {
      // Diagnostics must never turn an already-applied label into a failed item.
      // Surface a durable coverage warning instead of silently claiming a complete log.
      try { await this.update((state) => { state.logWarning = 'Some activity could not be saved to the browser log. The log may have gaps. Export the available history and check browser storage.'; }); } catch { /* State storage may also be unavailable. */ }
    }
  }
  private async read(): Promise<StoredState> {
    const existing = await this.deps.load();
    if (existing?.version === 2) return existing;
    const state = initialState(await this.deps.legacy(), this.uuid);
    await this.deps.save(state);
    return state;
  }
  private async update<T>(fn: (state: StoredState) => T | Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const state = await this.read();
      const result = await fn(state);
      await this.deps.save(state);
      return result;
    } finally { release(); }
  }
  private async snapshot() {
    let interrupted: StoredRun | undefined;
    const result = await this.update((state) => {
      if (active(state.run) && state.run!.owner !== this.owner) {
        state.run!.status = 'paused';
        state.run!.error = 'Browser or extension restarted. Completed labels are saved. Press Categorize emails to resume.';
        state.run!.updatedAt = this.now();
        interrupted = structuredClone(state.run);
      }
      return publicState(state, this.deps.oauthConfigured);
    });
    if (interrupted) await this.log({ runId: interrupted.id, scope: 'run', level: 'warn', stage: 'run', event: 'run.paused', message: 'The browser worker restarted. Saved progress is paused until you resume.', data: { reason: 'worker_restarted', status: 'paused', succeeded: interrupted.succeeded, pending: interrupted.total - interrupted.processed } });
    return result;
  }
  async handle(request: DockRequest): Promise<DockResponse> {
    if (request.command === 'state' || request.command === 'stop' || request.command === 'listMessages') return await this.dispatch(request);
    const previous = this.commandTail;
    let release!: () => void;
    this.commandTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await this.dispatch(request); } finally { release(); }
  }
  private async dispatch(request: DockRequest): Promise<DockResponse> {
    try {
      if (!['state', 'logs', 'exportLogs', 'syncLogs'].includes(request.command)) await this.log({ scope: request.command === 'listMessages' ? 'browse' : 'system', level: 'info', stage: request.command === 'listMessages' ? 'browse' : 'connection', event: 'command.received', message: `Dock received ${request.command}.`, data: { command: request.command } });
      switch (request.command) {
        case 'state': return { ok: true, state: await this.snapshot() };
        case 'connect': await this.connect(); break;
        case 'disconnect':
          if (active((await this.read()).run)) throw new Error('Stop the current run before disconnecting.');
          await this.deps.disconnect();
          await this.update((state) => { delete state.accountEmail; delete state.error; });
          break;
        case 'pairHelper': await this.pair(request.token); break;
        case 'importCategories': await this.importCategories(request.json); break;
        case 'setDaysBack':
          this.validateDays(request.daysBack);
          await this.update((state) => { state.daysBack = request.daysBack; });
          break;
        case 'saveCategory': await this.saveCategory(request.category); break;
        case 'deleteCategory': await this.deleteCategory(request.categoryId); break;
        case 'start': await this.start(request.daysBack); break;
        case 'resume': await this.resume(); break;
        case 'stop':
          await this.update((state) => {
            if (state.run?.status === 'running') { state.run.status = 'stopping'; state.run.updatedAt = this.now(); }
          });
          await this.log({ scope: 'run', level: 'info', stage: 'run', event: 'run.stop_requested', message: 'Stop requested. Waiting for in-flight requests to finish; no new email will start.' });
          break;
        case 'listMessages': return { ok: true, ...await this.listMessages(request.categoryId, request.pageToken) };
        default: throw new Error('Unknown Dock request.');
      }
      return { ok: true, state: await this.snapshot() };
    } catch (error) {
      await this.log({ scope: request.command === 'listMessages' ? 'browse' : 'system', level: 'error', stage: request.command === 'listMessages' ? 'browse' : 'connection', event: 'command.failed', message: `${request.command} failed.`, data: { command: request.command, error: errorText(error) } });
      return { ok: false, error: errorText(error) };
    }
  }
  private validateDays(days: number): void {
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Choose a days-back window from 1 to 365.');
  }
  private async importCategories(json: string): Promise<void> {
    if (typeof json !== 'string' || json.length > 150000) throw new Error('Paste category JSON under 150 KB.');
    let parsed: { version?: unknown; categories?: unknown };
    try { parsed = JSON.parse(json); } catch { throw new Error('Category JSON is not valid.'); }
    if (!parsed || !Array.isArray(parsed.categories) || parsed.categories.length > 50 || ![1, 2].includes(Number(parsed.version))) throw new Error('Expected a version 1 or 2 category export with up to 50 categories.');
    const categories: DockCategory[] = [];
    const seen = new Set<string>();
    for (const item of parsed.categories) {
      if (!item || typeof item !== 'object') throw new Error('Invalid category in import.');
      const title = parsed.version === 1 ? item.name : item.title;
      if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(item.id) || ['__proto__', 'constructor', 'prototype', '__uncategorized__'].includes(item.id) || typeof title !== 'string' || !title.trim() || title.length > 120 || /[\r\n]/.test(title)) throw new Error('Imported categories need valid IDs and titles.');
      if (item.id === 'urgent' || item.id === UNCATEGORIZED) continue;
      if (seen.has(item.id) || categories.some((category) => category.title.toLowerCase() === title.trim().toLowerCase())) throw new Error('Imported category IDs and titles must be unique.');
      const description = parsed.version === 1 ? '' : item.description;
      if (typeof description !== 'string' || description.length > 1000) throw new Error('Imported descriptions must be text under 1,000 characters.');
      seen.add(item.id);
      categories.push({ id: item.id, title: title.trim(), description: description.trim(), icon: typeof item.icon === 'string' ? item.icon.slice(0, 32) : 'tag', color: COLORS.includes(item.color) ? item.color : COLORS[categories.length % COLORS.length] });
    }
    await this.update((state) => {
      if (active(state.run)) throw new Error('Stop the run before importing categories.');
      // Merge definitions; never detach or delete existing labels merely because an export omitted them.
      const merged = [...state.categories];
      for (const category of categories) {
        const index = merged.findIndex((current) => current.id === category.id);
        if (index >= 0) {
          const current = merged[index]!;
          if (current.labelId && current.title !== category.title) throw new Error('Rename existing connected categories with Edit before importing.');
          merged[index] = { ...category, color: current.color, labelId: current.labelId };
        } else {
          if (merged.some((current) => current.title.toLowerCase() === category.title.toLowerCase())) throw new Error(`A different category already uses the title ${category.title}. Rename it first.`);
          merged.push(category);
        }
      }
      if (merged.length > 50) throw new Error('Import would exceed 50 categories.');
      state.categories = merged;
    });
  }
  private async connect(): Promise<void> {
    if (!this.deps.oauthConfigured) throw new Error('Google OAuth is not configured. Complete the OAuth setup and reload the extension.');
    if (active((await this.read()).run)) throw new Error('Stop the current run before reconnecting Gmail.');
    const token = await this.deps.token(true);
    const profile = await this.profileForToken(token);
    const connected = (await this.read()).accountEmail;
    if (connected && connected !== profile.emailAddress) {
      await this.deps.invalidateToken(token);
      this.tokenProfiles.delete(token);
      throw new Error(`Dock is connected to ${connected}. Disconnect first to change accounts.`);
    }
    await this.update((state) => {
      if (state.accountEmail && state.accountEmail !== profile.emailAddress) throw new Error(`Dock is connected to ${state.accountEmail}. Disconnect first to change accounts.`);
      // Label IDs are mailbox-specific. Retain the owning account even after disconnect.
      const previous = state.labelAccountEmail;
      if (previous && previous !== profile.emailAddress) {
        for (const category of state.categories) delete category.labelId;
        delete state.uncategorizedLabelId;
        delete state.run;
      }
      state.labelAccountEmail = profile.emailAddress;
      state.accountEmail = profile.emailAddress;
      delete state.error;
    });
    await this.log({ scope: 'connection', level: 'info', stage: 'connection', event: 'account.connected', message: 'Verified the Google account used by Dock.' });
  }
  private async pair(token: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('Paste the pairing token copied by helper setup.');
    await this.helper('health', token);
    await this.update((state) => { state.helperToken = token; });
    await this.log({ scope: 'connection', level: 'info', stage: 'connection', event: 'helper.paired', message: 'The local classifier helper is paired and reachable.' });
  }
  private async requireAccount(): Promise<StoredState> {
    const state = await this.read();
    if (!state.accountEmail) throw new Error('Connect Gmail first.');
    const profile = await this.gmail<{ emailAddress: string }>('profile');
    if (profile.emailAddress !== state.accountEmail) throw new Error('The Google account changed. Disconnect and reconnect the intended Gmail account.');
    return state;
  }
  private async saveCategory(input: { id?: string; title: string; description: string; icon?: string }): Promise<void> {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    if (!title || title.length > 120 || /[\r\n]/.test(title)) throw new Error('Give the category a title from 1 to 120 characters.');
    if (description.length > 1000) throw new Error('Keep descriptions under 1,000 characters.');
    const before = await this.read();
    if (active(before.run)) throw new Error('Stop the run before editing categories.');
    if (input.id && !before.categories.some((category) => category.id === input.id)) throw new Error('Category no longer exists.');
    if (before.categories.some((category) => category.id !== input.id && category.title.toLowerCase() === title.toLowerCase())) throw new Error('A category already uses that title.');
    if (!input.id && before.categories.length >= 50) throw new Error('This prototype supports up to 50 categories.');
    const old = before.categories.find((category) => category.id === input.id);
    const category: DockCategory = { id: old?.id || this.uuid(), title, description, icon: input.icon?.slice(0, 32) || old?.icon || 'tag', color: old?.color || COLORS[before.categories.length % COLORS.length]!, ...(old?.labelId ? { labelId: old.labelId } : {}) };
    if (old?.labelId) {
      await this.requireAccount();
      await this.gmail(`labels/${encodeURIComponent(old.labelId)}`, { method: 'PATCH', body: JSON.stringify(this.labelPayload(before, category)) });
    }
    await this.update((state) => {
      if (active(state.run)) throw new Error('Stop the run before editing categories.');
      state.categories = old ? state.categories.map((item) => item.id === old.id ? category : item) : [...state.categories, category];
    });
    await this.log({ scope: 'system', level: 'info', stage: 'labels', event: 'category.saved', message: `${old ? 'Updated' : 'Created'} the category ${category.title}.`, data: { category } });
  }
  private async deleteCategory(id: string): Promise<void> {
    const state = await this.read();
    if (active(state.run)) throw new Error('Stop the run before removing a category.');
    const category = state.categories.find((item) => item.id === id);
    if (!category) throw new Error('Category no longer exists.');
    if (category.labelId) {
      await this.requireAccount();
      try { await this.gmail(`labels/${encodeURIComponent(category.labelId)}`, { method: 'DELETE' }); }
      catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
    }
    // Deleting only a users.labels resource removes memberships; it never deletes messages.
    await this.update((current) => { current.categories = current.categories.filter((item) => item.id !== id); });
    await this.log({ scope: 'system', level: 'info', stage: 'labels', event: 'category.deleted', message: `Removed the category ${category.title} and its Dock label.`, data: { categoryId: id, labelId: category.labelId } });
  }
  private validateRun(state: StoredState): void {
    if (!state.helperToken) throw new Error('Start the local helper and paste its pairing token first.');
    if (!state.categories.length) throw new Error('Create at least one category before categorizing.');
    const missing = state.categories.filter((category) => !category.description.trim());
    if (missing.length) throw new Error(`Add descriptions before categorizing: ${missing.map((category) => category.title).join(', ')}.`);
  }
  private async start(daysBack: number): Promise<void> {
    this.validateDays(daysBack);
    const state = await this.read();
    if (!state.accountEmail) throw new Error('Connect Gmail first.');
    // Each Gmail request validates its token's account inside the cancellable run.
    this.validateRun(state);
    if (active(state.run) || this.running) throw new Error('A run is already active.');
    await this.helper('health', state.helperToken!);
    const now = this.now();
    await this.update((current) => {
      if (active(current.run)) throw new Error('A run is already active.');
      current.daysBack = daysBack;
      current.run = {
        id: this.uuid(), owner: this.owner, status: 'running', phase: 'discovering', daysBack,
        cutoff: now - daysBack * 86400000, before: now,
        query: `after:${Math.floor((now - daysBack * 86400000) / 1000)} before:${Math.ceil(now / 1000)}`,
        total: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, startedAt: now, updatedAt: now,
        categories: structuredClone(current.categories), accountEmail: current.accountEmail!, discovered: false, items: [],
      };
    });
    const run = (await this.read()).run!;
    await this.log({ runId: run.id, scope: 'run', level: 'info', stage: 'run', event: 'run.started', message: `Started a manual run for Inbox emails from the last ${daysBack} days.`, data: { daysBack, startedAt: now, cutoff: run.cutoff, before: run.before, query: run.query, categories: run.categories, maxConcurrentEmails: 3, pacingUnitsPerMinute: 4800 } });
    this.launch();
  }
  private async resume(): Promise<void> {
    await this.snapshot();
    const state = await this.read();
    if (!state.accountEmail) throw new Error('Connect Gmail first.');
    this.validateRun(state);
    if (!state.run || (state.run.status === 'completed' && state.run.failed === 0)) throw new Error('There is no unfinished run. Start a new run.');
    if (active(state.run) || this.running) throw new Error('A run is already active.');
    if (state.run.accountEmail !== state.accountEmail) throw new Error('Reconnect the Gmail account used for this run.');
    await this.helper('health', state.helperToken!, undefined, { runId: state.run.id });
    const changed = categorySignature(state.run.categories) !== categorySignature(state.categories);
    await this.update((current) => {
      const run = current.run!;
      const changed = categorySignature(run.categories) !== categorySignature(current.categories);
      for (const item of run.items) {
        if (item.status === 'failed') { item.status = 'pending'; delete item.error; }
        if (changed && item.status === 'pending') delete item.decision;
      }
      run.categories = structuredClone(current.categories);
      run.owner = this.owner; run.status = 'running'; run.updatedAt = this.now(); delete run.error;
      recalculate(run);
    });
    const resumed = (await this.read()).run!;
    await this.log({ runId: resumed.id, scope: 'run', level: 'info', stage: 'run', event: 'run.resumed', message: `Resuming unfinished work; ${resumed.succeeded} completed emails will be skipped.`, data: { daysBack: resumed.daysBack, startedAt: resumed.startedAt, succeeded: resumed.succeeded, failed: resumed.failed, pending: resumed.total - resumed.processed, categories: resumed.categories, categoryDefinitionsChanged: changed, coverageNote: 'Only steps taken after logging was installed are available; pre-existing work is represented by these saved counts.' } });
    this.launch();
  }
  private launch(): void {
    this.running = this.drain();
    // drain catches all failures and checkpoints; completion bookkeeping is ephemeral only.
    void (async () => { try { await this.running; } finally { this.running = undefined; } })();
  }
  /** Awaited by fixtures; production callers observe persisted progress instead. */
  async whenIdle(): Promise<void> { await this.running; }
  private async pauseIfStopped(runId: string): Promise<boolean> {
    let paused = false;
    const result = await this.update((state) => {
      const run = state.run;
      if (!run || run.id !== runId || run.status !== 'running') {
        if (run?.id === runId && run.status === 'stopping') { run.status = 'paused'; run.error = 'Stopped. Completed labels are saved. Resume when ready.'; run.updatedAt = this.now(); paused = true; }
        return true;
      }
      return false;
    });
    if (paused) await this.log({ runId, scope: 'run', level: 'info', stage: 'run', event: 'run.paused', message: 'The run is stopped. Completed labels and unfinished decisions are saved.', data: { status: 'paused', reason: 'user_stop' } });
    return result;
  }
  private async drain(): Promise<void> {
    const initial = (await this.read()).run!;
    const runId = initial.id;
    try {
      while (!(await this.read()).run!.discovered) {
        if (await this.pauseIfStopped(runId)) return;
        const run = (await this.read()).run!;
        const params = new URLSearchParams({ labelIds: 'INBOX', q: run.query, maxResults: '500' });
        if (run.pageToken) params.set('pageToken', run.pageToken);
        let page: { messages?: { id: string }[]; nextPageToken?: string };
        try { page = await this.gmail(`messages?${params}`, {}, true, runId); }
        catch (error) {
          if (error instanceof ApiError && error.status === 400 && run.pageToken) {
            await this.update((state) => { delete state.run!.pageToken; });
            throw new Error('Gmail pagination changed. Resume to safely rediscover the window; saved progress will be retained.');
          }
          throw error;
        }
        await this.update((state) => {
          const current = state.run!;
          const seen = new Set(current.items.map((item) => item.id));
          for (const message of page.messages || []) if (!seen.has(message.id)) { current.items.push({ id: message.id, status: 'pending' }); seen.add(message.id); }
          if (current.items.length > 50000) throw new Error('This window exceeds 50,000 messages. Choose a smaller window for a new run.');
          current.pageToken = page.nextPageToken;
          current.discovered = !page.nextPageToken;
          current.phase = current.discovered ? 'categorizing' : 'discovering';
          current.updatedAt = this.now(); recalculate(current);
        });
        await this.log({ runId, scope: 'run', level: 'info', stage: 'discovery', event: 'discovery.page', message: `Found ${page.messages?.length || 0} message IDs on this page.`, data: { pageMessages: page.messages?.length || 0, discoveredTotal: (await this.read()).run!.total, hasMore: Boolean(page.nextPageToken), messageIds: (page.messages || []).map((message) => message.id) } });
      }
      await this.log({ runId, scope: 'run', level: 'info', stage: 'discovery', event: 'discovery.completed', message: 'Inbox discovery is complete. Checking category labels before sorting.', data: { total: (await this.read()).run!.total } });
      if (await this.pauseIfStopped(runId)) return;
      await this.ensureLabels();
      while (true) {
        if (await this.pauseIfStopped(runId)) return;
        const run = (await this.read()).run!;
        const batch = run.items.filter((item) => item.status === 'pending').slice(0, 3);
        if (!batch.length) break;
        const results = await Promise.allSettled(batch.map((item) => this.processItem(runId, item.id)));
        const fatal = results.find((result) => result.status === 'rejected');
        if (fatal?.status === 'rejected') throw fatal.reason;
      }
      await this.update((state) => {
        const run = state.run!;
        if (run.id !== runId) return;
        run.status = run.failed ? 'failed' : 'completed';
        run.error = run.failed ? `${run.failed} email(s) failed. Completed labels are saved; retry resumes only unfinished emails. ${run.items.find((item) => item.error)?.error || ''}` : undefined;
        run.updatedAt = this.now();
      });
      const finished = (await this.read()).run!;
      await this.log({ runId, scope: 'run', level: finished.failed ? 'warn' : 'info', stage: 'run', event: 'run.completed', message: `Run finished: ${finished.succeeded} labeled, ${finished.skipped} skipped, ${finished.failed} failed.`, data: { status: finished.status, total: finished.total, succeeded: finished.succeeded, skipped: finished.skipped, failed: finished.failed, durationMs: this.now() - finished.startedAt } });
    } catch (error) {
      if (error instanceof RunStoppedError) { await this.pauseIfStopped(runId); return; }
      await this.update((state) => {
        if (state.run?.id === runId) { state.run.status = 'failed'; state.run.error = errorText(error); state.run.updatedAt = this.now(); }
      });
      const failed = (await this.read()).run!;
      await this.log({ runId, scope: 'run', level: 'error', stage: 'run', event: 'run.failed', message: 'The run stopped because an operation could not recover. Completed work is saved.', data: { status: 'failed', error: errorText(error), succeeded: failed.succeeded, failed: failed.failed, pending: failed.total - failed.processed } });
    }
  }
  private labelPayload(state: StoredState, category: Pick<DockCategory, 'id' | 'title' | 'color'>) {
    return { name: labelName(state, category), messageListVisibility: 'show', labelListVisibility: 'labelShow', color: { backgroundColor: category.color, textColor: '#434343' } };
  }
  private async ensureLabels(): Promise<void> {
    let state = await this.read();
    const runId = state.run!.id;
    const { labels = [] } = await this.gmail<{ labels?: Label[] }>('labels', {}, true, runId);
    const specs: DockCategory[] = [...state.categories, { id: UNCATEGORIZED, title: 'Uncategorized', description: '', icon: 'tag', color: '#e7e7e7', labelId: state.uncategorizedLabelId }];
    for (const category of specs) {
      if (await this.pauseIfStopped(state.run!.id)) return;
      state = await this.read();
      let existing = labels.find((label) => label.id === category.labelId && label.type !== 'system') || labels.find((label) => label.name === labelName(state, category) && label.type !== 'system');
      const payload = this.labelPayload(state, category);
      await this.log({ runId, scope: 'run', level: 'info', stage: 'labels', event: 'label.ensure', message: `${existing ? 'Updating' : 'Creating'} the Gmail label for ${category.title}.`, data: { categoryId: category.id, categoryTitle: category.title, existingLabelId: existing?.id } });
      if (existing) {
        await this.gmail(`labels/${encodeURIComponent(existing.id)}`, { method: 'PATCH', body: JSON.stringify(payload) }, true, runId);
      } else {
        try { existing = await this.gmail<Label>('labels', { method: 'POST', body: JSON.stringify(payload) }, false, runId); }
        catch (error) {
          if (error instanceof RunStoppedError) throw error;
          // Never blindly retry creates: a lost response may already have created the label.
          const current = await this.gmail<{ labels?: Label[] }>('labels', {}, true, runId);
          existing = current.labels?.find((label) => label.name === payload.name && label.type !== 'system');
          await this.log({ runId, scope: 'run', level: existing ? 'info' : 'warn', stage: 'labels', event: 'label.reconciled', message: existing ? 'Recovered the created label after its response was lost.' : 'The label was not found after the failed create.', data: { categoryId: category.id, labelId: existing?.id, error: errorText(error) } });
          if (!existing) throw error;
        }
        labels.push(existing);
      }
      const labelId = existing.id;
      await this.update((current) => {
        if (category.id === UNCATEGORIZED) current.uncategorizedLabelId = labelId;
        else {
          const matching = current.categories.find((item) => item.id === category.id);
          if (matching) matching.labelId = labelId;
        }
        current.run!.categories = structuredClone(current.categories);
      });
      await this.log({ runId, scope: 'run', level: 'info', stage: 'labels', event: 'label.ready', message: `${category.title} is ready in Gmail.`, data: { categoryId: category.id, labelId } });
    }
  }
  private async processItem(runId: string, messageId: string): Promise<void> {
    try {
      let state = await this.read();
      if (state.run?.id !== runId || state.run.status !== 'running') return;
      const run = state.run;
      await this.log({ runId, messageId, scope: 'run', level: 'info', stage: 'read', event: 'email.started', message: 'Reading the next email and rechecking that it belongs in this run.' });
      const message = await this.gmail<GmailFullMessage>(`messages/${encodeURIComponent(messageId)}?format=full`, {}, true, runId);
      await this.log({ runId, messageId, scope: 'run', level: 'info', stage: 'read', event: 'email.read', message: 'Read this email from Gmail.', data: { receivedAt: Number(message.internalDate), threadId: message.threadId, labelIds: message.labelIds } });
      // Re-check INBOX and exact epoch bounds immediately before classifying each message.
      if (!message.labelIds?.includes('INBOX') || Number(message.internalDate) < run.cutoff || Number(message.internalDate) > run.before) {
        await this.log({ runId, messageId, scope: 'run', level: 'info', stage: 'read', event: 'email.ineligible', message: 'Skipping this email because it is no longer in Inbox or outside the saved date window.', data: { inInbox: Boolean(message.labelIds?.includes('INBOX')), receivedAt: Number(message.internalDate), cutoff: run.cutoff, before: run.before } });
        await this.finishItem(runId, messageId, 'skipped'); return;
      }
      let decision = run.items.find((item) => item.id === messageId)?.decision;
      if (!decision) {
        const body = await decodedBody(message.payload, async (id) => (await this.gmail<{ data: string }>(`messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(id)}`, {}, true, runId)).data);
        await this.log({ runId, messageId, scope: 'run', level: 'info', stage: 'read', event: 'email.decoded', message: 'Decoded the email text for classification. File attachments are excluded.', data: { bodyChars: body.length, mimeType: message.payload?.mimeType } });
        if (body.length > 60000) throw new Error('Email body exceeds 60,000 characters. This email was left unchanged.');
        state = await this.read();
        if (state.run?.status !== 'running') {
          await this.log({ runId, messageId, scope: 'run', level: 'info', stage: 'classification', event: 'email.deferred', message: 'Stop was requested before classification. This email remains unfinished.' });
          return;
        }
        await this.log({ runId, messageId, scope: 'run', level: 'info', stage: 'classification', event: 'classification.started', message: 'Asking Jev to choose a category for this email.', data: { bodyChars: body.length, categoryIds: run.categories.map((category) => category.id) } });
        decision = await this.helper<Classification>('classify', state.helperToken!, {
          message: { sender: header(message.payload, 'From'), subject: header(message.payload, 'Subject'), body },
          categories: run.categories.map(({ id, title, description }) => ({ id, title, description })),
        }, { runId, messageId });
        if (decision.categoryId !== null && !run.categories.some((category) => category.id === decision!.categoryId)) throw new Error('The classifier returned an unknown category. Email left unchanged.');
        if (!decision.answer || decision.answer.type !== 'choice' || !Number.isFinite(decision.answer.confidence) || !decision.answer.probabilities || (decision.categoryId === null ? decision.answer.choice !== '__uncategorized__' : decision.answer.choice !== decision.categoryId)) throw new Error('The classifier returned an invalid Choice result. Email left unchanged.');
        await this.update((current) => {
          const item = current.run?.id === runId ? current.run.items.find((entry) => entry.id === messageId) : undefined;
          if (item) item.decision = decision;
        });
        await this.log({ runId, messageId, scope: 'run', level: 'info', stage: 'classification', event: 'classification.saved', message: `Jev chose ${run.categories.find((category) => category.id === decision!.categoryId)?.title || 'Uncategorized'}; the decision is saved before changing Gmail.`, data: { categoryId: decision.categoryId, categoryTitle: run.categories.find((category) => category.id === decision!.categoryId)?.title || 'Uncategorized', model: decision.model, answer: decision.answer, usage: decision.usage, trace: decision.trace } });
      } else {
        await this.log({ runId, messageId, scope: 'run', level: 'info', stage: 'classification', event: 'classification.reused', message: 'Reusing this email’s saved decision; no new classifier call is needed.', data: { categoryId: decision.categoryId, model: decision.model, answer: decision.answer, usage: decision.usage } });
      }
      state = await this.read();
      if (state.run?.status !== 'running') {
        await this.log({ runId, messageId, scope: 'run', level: 'info', stage: 'labels', event: 'email.deferred', message: 'Stop was requested before applying the label. The decision is saved for resume.' });
        return;
      }
      const target = decision.categoryId === null ? state.uncategorizedLabelId : state.categories.find((category) => category.id === decision!.categoryId)?.labelId;
      if (!target) throw new Error('Category label is missing. Resume the run to recreate it.');
      const ownedIds = [...state.categories.map((category) => category.labelId), state.uncategorizedLabelId].filter((id): id is string => Boolean(id));
      const removeLabelIds = ownedIds.filter((id) => id !== target && message.labelIds?.includes(id));
      await this.log({ runId, messageId, scope: 'run', level: 'info', stage: 'labels', event: 'label.apply', message: 'Applying the chosen label and removing only other Dock category labels.', data: { addLabelIds: [target], removeLabelIds, preservedLabelIds: message.labelIds?.filter((id) => !removeLabelIds.includes(id)) } });
      // Never pass INBOX, UNREAD, or any unrelated label as a removal. Applying again is idempotent.
      await this.gmail(`messages/${encodeURIComponent(messageId)}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: [target], removeLabelIds }) }, true, runId);
      await this.finishItem(runId, messageId, 'succeeded');
    } catch (error) {
      if (error instanceof RunStoppedError) {
        await this.log({ runId, messageId, scope: 'run', level: 'info', stage: 'run', event: 'email.deferred', message: 'This email remains unfinished after Stop; its saved decision can be reused.' });
        return;
      }
      await this.finishItem(runId, messageId, error instanceof ApiError && error.status === 404 ? 'skipped' : 'failed', errorText(error));
      if (error instanceof PauseRunError || error instanceof GmailNetworkError || (error instanceof ApiError && [401, 403, 429, 500, 502, 503, 504].includes(error.status))) throw error;
    }
  }
  private async finishItem(runId: string, id: string, status: 'succeeded' | 'failed' | 'skipped', error?: string): Promise<void> {
    await this.update((state) => {
      if (state.run?.id !== runId) return;
      const item = state.run.items.find((entry) => entry.id === id);
      if (item) {
        item.status = status;
        if (error) item.error = error;
        if (status === 'succeeded' && item.decision) {
          // Keep full recent model results while bounding extension storage on very large runs.
          state.recentDecisions = [...(state.recentDecisions || []), { messageId: id, decision: item.decision }].slice(-100);
          delete item.decision;
        }
      }
      state.run.updatedAt = this.now(); recalculate(state.run);
    });
    await this.log({ runId, messageId: id, scope: 'run', level: status === 'failed' ? 'error' : 'info', stage: status === 'succeeded' ? 'labels' : 'run', event: `email.${status}`, message: status === 'succeeded' ? 'The Gmail label was applied and the successful checkpoint was saved.' : status === 'skipped' ? 'This email was skipped and its checkpoint was saved.' : 'This email failed. Any classification decision is retained for retry.', data: { status, ...(error ? { error } : {}) } });
  }
  private async listMessages(categoryId: string, pageToken?: string): Promise<{ messages: GmailMessageSummary[]; nextPageToken?: string }> {
    await this.log({ scope: 'browse', level: 'info', stage: 'browse', event: 'browse.started', message: 'Loading a category preview. These Gmail reads share the sorter’s quota budget.', data: { categoryId, nextPage: Boolean(pageToken), pageSize: 30 } });
    const state = await this.requireAccount();
    const labelId = categoryId === UNCATEGORIZED ? state.uncategorizedLabelId : state.categories.find((category) => category.id === categoryId)?.labelId;
    if (!labelId) {
      await this.log({ scope: 'browse', level: 'info', stage: 'browse', event: 'browse.completed', message: 'This category does not have a Gmail label yet.', data: { categoryId, messages: 0 } });
      return { messages: [] };
    }
    const params = new URLSearchParams({ labelIds: labelId, maxResults: '30' });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await this.gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(`messages?${params}`);
    const summaries: GmailMessageSummary[] = [];
    const ids = page.messages || [];
    for (let i = 0; i < ids.length; i += 4) {
      const batch = await Promise.all(ids.slice(i, i + 4).map(async ({ id }) => {
        try {
          const message = await this.gmail<GmailFullMessage>(`messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
          return { id: message.id, threadId: message.threadId, sender: header(message.payload, 'From'), subject: header(message.payload, 'Subject') || '(no subject)', snippet: message.snippet || '', receivedAt: Number(message.internalDate), unread: Boolean(message.labelIds?.includes('UNREAD')), gmailUrl: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(state.accountEmail!)}#all/${message.threadId}` };
        } catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
      }));
      summaries.push(...batch.filter((message): message is GmailMessageSummary => message !== null));
    }
    await this.log({ scope: 'browse', level: 'info', stage: 'browse', event: 'browse.completed', message: `Loaded ${summaries.length} category preview messages.`, data: { categoryId, messages: summaries.length, hasMore: Boolean(page.nextPageToken) } });
    return { messages: summaries, nextPageToken: page.nextPageToken };
  }
  private async gmail<T = unknown>(path: string, init: RequestInit = {}, retry = true, runId?: string): Promise<T> {
    let refreshed = false;
    while (true) {
      let token: string;
      try { token = await this.deps.token(false); }
      catch {
        await this.log({ runId, scope: 'connection', level: 'error', stage: 'connection', event: 'authorization.failed', message: 'Chrome could not provide Gmail authorization. Reconnection is required.' });
        throw new ApiError('Gmail authorization expired or was denied. Click Reconnect Gmail. Google Testing access needs reconnection after seven days.', 401);
      }
      if (path !== 'profile') {
        const expected = (await this.read()).accountEmail;
        let actual = this.tokenProfiles.get(token);
        if (!actual) {
          try { actual = (await this.profileForToken(token, runId)).emailAddress; }
          catch (error) {
            if (error instanceof ApiError && error.status === 401 && !refreshed) {
              await this.log({ runId, scope: 'connection', level: 'warn', stage: 'connection', event: 'authorization.refresh', message: 'Account verification rejected cached authorization; trying a fresh grant once.' });
              refreshed = true; await this.deps.invalidateToken(token); continue;
            }
            throw error;
          }
        }
        if (!expected || actual !== expected) {
          await this.deps.invalidateToken(token);
          this.tokenProfiles.delete(token);
          throw new ApiError('The Google token belongs to a different account. Stop, disconnect, and reconnect the intended Gmail account. No changes were made with that token.', 401);
        }
      }
      let response: Response;
      try {
        response = await this.requests.request(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, retry, runId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401 && !refreshed) {
          await this.log({ runId, scope: 'connection', level: 'warn', stage: 'connection', event: 'authorization.refresh', message: 'Gmail rejected cached authorization; trying a fresh grant once.' });
          refreshed = true; await this.deps.invalidateToken(token); this.tokenProfiles.delete(token); continue;
        }
        throw error;
      }
      if (response.status === 204 || init.method === 'DELETE') return undefined as T;
      return await response.json() as T;
    }
  }
  private async profileForToken(token: string, runId?: string): Promise<{ emailAddress: string }> {
    let response: Response;
    try { response = await this.requests.request('profile', { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, true, runId); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) { await this.deps.invalidateToken(token); this.tokenProfiles.delete(token); }
      throw error;
    }
    const profile = await response.json() as { emailAddress?: string };
    if (!profile.emailAddress) throw new Error('Gmail returned no account identity. Reconnect Gmail.');
    this.tokenProfiles.set(token, profile.emailAddress);
    await this.log({ runId, scope: 'connection', level: 'info', stage: 'connection', event: 'account.verified', message: 'Verified the account behind this Gmail authorization.' });
    return { emailAddress: profile.emailAddress };
  }
  private async helper<T = unknown>(route: string, token: string, payload?: unknown, context: { runId?: string; messageId?: string } = {}): Promise<T> {
    const requestId = this.uuid();
    const startedAt = this.now();
    const common = { ...context, requestId, scope: context.runId ? 'run' as const : 'connection' as const, stage: route === 'classify' ? 'classification' as const : 'connection' as const };
    await this.log({ ...common, level: 'info', event: 'helper.request', message: `Calling the local helper’s ${route} operation.`, data: { operation: route } });
    let response: Response;
    try {
      // Chromium omits Origin on extension GETs; POST makes the helper's strict Origin check reliable.
      response = await this.deps.fetch(`${HELPER_URL}/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}), signal: AbortSignal.timeout(25000) });
    } catch {
      await this.log({ ...common, level: 'error', event: 'helper.response', message: 'The local helper did not respond.', data: { operation: route, durationMs: this.now() - startedAt, reason: 'network_or_timeout' } });
      throw new PauseRunError('Local helper is unavailable or timed out. Start the helper, confirm its pairing token, and retry.');
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string; retryable?: boolean } };
      await this.log({ ...common, level: 'error', event: 'helper.response', message: `The local helper returned ${response.status}.`, data: { operation: route, status: response.status, durationMs: this.now() - startedAt, code: detail.error?.code, error: detail.error?.message?.slice(0, 600), retryable: detail.error?.retryable } });
      if (response.status === 401 || response.status === 403) throw new PauseRunError('The local helper rejected the pairing token or extension identity. Pair again using the helper token.');
      if (response.status === 413) throw new Error('This email or category description set exceeds the classifier size limit. Email left unchanged.');
      throw new PauseRunError(`Classification helper failed (${response.status}${detail.error?.code ? `: ${detail.error.code}` : ''}). This email was left unchanged; retry later.`);
    }
    const result = await response.json() as T;
    await this.log({ ...common, level: 'info', event: 'helper.response', message: `The local helper’s ${route} operation succeeded.`, data: { operation: route, status: response.status, durationMs: this.now() - startedAt } });
    return result;
  }
}
