import { decodedBody, header, type GmailFullMessage } from './mime';
import { archiveRun, COLORS, initialState, isStarterCategory, labelName, legacyLabelName, publicState, recalculate, type Classification, type StoredRun, type StoredState } from './model';
import { HELPER_URL, UNCATEGORIZED, type DockCategory, type DockRequest, type DockResponse } from './protocol';
import { GMAIL_QUOTA_METHODS } from './quota';
import { ApiError, GmailNetworkError, GmailRequests, RunStoppedError } from './requests';

interface EngineDependencies {
  load(): Promise<StoredState | undefined>;
  save(state: StoredState): Promise<void>;
  legacy(): Promise<unknown>;
  token(interactive: boolean): Promise<string>;
  invalidateToken(token: string): Promise<void>;
  disconnect(): Promise<void>;
  fetch: typeof fetch;
  oauthConfigured: boolean;
}
interface Label { id: string; name: string; type?: string }
class PauseRunError extends Error {}
const active = (run?: StoredRun) => run?.status === 'running' || run?.status === 'stopping';
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request failed. Try again.';
const categoryDefinitions = (categories: DockCategory[]) => categories.map(({ id, title, description }) => ({ id, title, description }));
const sameLabelName = (first: string, second: string) => first.toLowerCase() === second.toLowerCase();

function validateCategoryTitles(categories: DockCategory[]): void {
  const names = new Set(['uncategorized']);
  for (const category of categories) {
    if (isStarterCategory(category)) continue;
    const name = labelName(category).toLowerCase();
    if (names.has(name)) throw new Error(`A category already uses the title "${category.title}". Choose another title.`);
    names.add(name);
  }
}

function checkLabelConflict(labels: Label[], name: string, ownedId?: string): void {
  if (labels.some((label) => label.id !== ownedId && sameLabelName(label.name, name))) {
    throw new Error(`Gmail already has a different label named "${name}". Rename that label or this category, then retry.`);
  }
}

/** Only an explicit start/resume command enters drain(). No alarms, onStartup work, or mail watchers. */
export class GmailEngine {
  private readonly owner = crypto.randomUUID();
  // These coordinate this worker lifetime only. Every recoverable datum is saved in extension storage.
  private transactionTail: Promise<unknown> = Promise.resolve();
  private commandTail: Promise<unknown> = Promise.resolve();
  private running: Promise<void> | undefined;
  private tokenProfiles = new Map<string, string>();
  private readonly requests: GmailRequests;
  constructor(private readonly deps: EngineDependencies) {
    this.requests = new GmailRequests({
      fetch: (...args) => this.deps.fetch(...args),
      traffic: async (change) => await this.update((state) => change(state.gmailTraffic ||= {})),
      check: async (runId) => {
        const state = await this.read();
        if (runId && (state.run?.id !== runId || state.run.status !== 'running')) throw new RunStoppedError();
      },
      waiting: async (until, runId) => {
        await this.update((state) => {
          if (state.run?.status === 'running' && (!runId || state.run.id === runId)) {
            state.run.retryAt = until;
            state.run.updatedAt = Date.now();
          }
        });
      },
      ready: async (runId) => {
        await this.update((state) => {
          if (state.run && (!runId || state.run.id === runId) && (state.run.retryAt || 0) <= Date.now()) delete state.run.retryAt;
        });
      },
      record: async (method, event, runId) => {
        if (!runId) return;
        await this.update((state) => {
          const run = state.run;
          if ('retry' in event && (run?.id !== runId || run.status !== 'running')) throw new RunStoppedError();
          if (run?.id !== runId) return;
          const usage = run.gmailUsage ||= { startedAt: Date.now(), complete: false, methods: [] };
          let entry = usage.methods.find((item) => item.method === method);
          if (!entry) {
            entry = { method, unitsPerRequest: GMAIL_QUOTA_METHODS[method].units, requests: 0, retries: 0, succeeded: 0, httpErrors: 0, networkErrors: 0 };
            usage.methods.push(entry);
          }
          if ('retry' in event) {
            entry.requests++;
            if (event.retry) entry.retries++;
          } else {
            entry[event.outcome]++;
          }
          run.updatedAt = Date.now();
        });
      },
    });
  }
  private async read(): Promise<StoredState> {
    const existing = await this.deps.load();
    if (existing?.version === 2) return existing;
    const state = initialState(await this.deps.legacy());
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
    return await this.update((state) => {
      if (active(state.run) && state.run!.owner !== this.owner) {
        state.run!.status = 'paused';
        state.run!.error = 'Browser or extension restarted. Completed labels are saved. Press Categorize emails to resume.';
        state.run!.updatedAt = Date.now();
      }
      return publicState(state, this.deps.oauthConfigured);
    });
  }
  async handle(request: DockRequest): Promise<DockResponse> {
    if (request.command === 'state' || request.command === 'stop') return await this.dispatch(request);
    const previous = this.commandTail;
    let release!: () => void;
    this.commandTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await this.dispatch(request); } finally { release(); }
  }
  private async dispatch(request: DockRequest): Promise<DockResponse> {
    try {
      switch (request.command) {
        case 'state': return { ok: true, state: await this.snapshot() };
        case 'connect': await this.connect(); break;
        case 'disconnect':
          if (active((await this.read()).run)) throw new Error('Stop the current run before disconnecting.');
          await this.deps.disconnect();
          await this.update((state) => {
            delete state.accountEmail;
            delete state.error;
            delete state.uncategorizedLabelName;
            for (const category of state.categories) delete category.labelName;
          });
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
            if (state.run?.status === 'running') { state.run.status = 'stopping'; state.run.updatedAt = Date.now(); }
          });
          break;
        case 'refreshLabels': await this.refreshLabels(); break;
        default: throw new Error('Unknown Dock request.');
      }
      return { ok: true, state: await this.snapshot() };
    } catch (error) { return { ok: false, error: errorText(error) }; }
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
      if (seen.has(item.id)) throw new Error('Imported category IDs must be unique.');
      const description = parsed.version === 1 ? '' : item.description;
      if (typeof description !== 'string' || description.length > 1000) throw new Error('Imported descriptions must be text under 1,000 characters.');
      seen.add(item.id);
      categories.push({ id: item.id, title: title.trim(), description: description.trim(), icon: typeof item.icon === 'string' ? item.icon.slice(0, 32) : 'tag', color: COLORS.includes(item.color) ? item.color : COLORS[categories.length % COLORS.length] });
    }
    validateCategoryTitles(categories);
    await this.update((state) => {
      if (active(state.run)) throw new Error('Stop the run before importing categories.');
      // Merge definitions; never detach or delete existing labels merely because an export omitted them.
      const merged = [...state.categories];
      for (const category of categories) {
        const index = merged.findIndex((current) => current.id === category.id);
        if (index >= 0) {
          const current = merged[index]!;
          if (current.labelId && current.title !== category.title) throw new Error('Rename existing connected categories with Edit before importing.');
          merged[index] = { ...category, color: current.color, labelId: current.labelId, labelName: current.labelId ? current.labelName : undefined };
        } else {
          merged.push(category);
        }
      }
      if (merged.length > 50) throw new Error('Import would exceed 50 categories.');
      validateCategoryTitles(merged);
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
      // Label IDs are mailbox-specific. Keep proven ownership when switching accounts.
      const previous = state.labelAccountEmail || state.accountEmail;
      if (previous && previous !== profile.emailAddress) {
        state.labelIdsByAccount ||= {};
        state.labelIdsByAccount[previous] = {
          categories: state.categories.flatMap(({ id, labelId }) => labelId ? [{ id, labelId }] : []),
          ...(state.uncategorizedLabelId ? { uncategorizedLabelId: state.uncategorizedLabelId } : {}),
        };
        const saved = state.labelIdsByAccount[profile.emailAddress];
        for (const category of state.categories) {
          const labelId = saved?.categories.find((item) => item.id === category.id)?.labelId;
          if (labelId) category.labelId = labelId;
          else delete category.labelId;
          delete category.labelName;
        }
        if (saved?.uncategorizedLabelId) state.uncategorizedLabelId = saved.uncategorizedLabelId;
        else delete state.uncategorizedLabelId;
        delete state.uncategorizedLabelName;
        delete state.labelIdsByAccount[profile.emailAddress];
        archiveRun(state);
        delete state.run;
      }
      state.labelAccountEmail = profile.emailAddress;
      state.accountEmail = profile.emailAddress;
      delete state.error;
    });
  }
  private async pair(token: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('Paste the pairing token copied by helper setup.');
    await this.helper('health', token);
    await this.update((state) => { state.helperToken = token; });
  }
  private async requireAccount(): Promise<StoredState> {
    const state = await this.read();
    if (!state.accountEmail) throw new Error('Connect Gmail first.');
    const profile = await this.gmail<{ emailAddress: string }>('profile');
    if (profile.emailAddress !== state.accountEmail) throw new Error('The Google account changed. Disconnect and reconnect the intended Gmail account.');
    return state;
  }
  private async saveCategory(input: Extract<DockRequest, { command: 'saveCategory' }>['category']): Promise<void> {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    if (!title || title.length > 120 || /[\r\n]/.test(title)) throw new Error('Give the category a title from 1 to 120 characters.');
    if (description.length > 1000) throw new Error('Keep descriptions under 1,000 characters.');
    const before = await this.read();
    if (active(before.run)) throw new Error('Stop the run before editing categories.');
    const old = before.categories.find((category) => category.id === input.id);
    if (input.id && !old) throw new Error('Category no longer exists.');
    if (input.color !== undefined && input.color !== old?.color && !COLORS.includes(input.color)) throw new Error('Choose one of the available category colors.');
    if (old && isStarterCategory({ id: old.id, title })) throw new Error('Replace Edit Me! with a category title before saving.');
    if (!input.id && before.categories.length >= 50) throw new Error('This prototype supports up to 50 categories.');
    const category: DockCategory = { id: old?.id || crypto.randomUUID(), title, description, icon: input.icon?.slice(0, 32) || old?.icon || 'tag', color: input.color ?? old?.color ?? COLORS[before.categories.length % COLORS.length]!, ...(old?.labelId ? { labelId: old.labelId } : {}) };
    validateCategoryTitles(old ? before.categories.map((item) => item.id === old.id ? category : item) : [...before.categories, category]);
    if (old?.labelId) {
      await this.requireAccount();
      const { labels = [] } = await this.gmail<{ labels?: Label[] }>('labels');
      checkLabelConflict(labels, labelName(category), old.labelId);
      const renamed = await this.gmail<Label>(`labels/${encodeURIComponent(old.labelId)}`, { method: 'PATCH', body: JSON.stringify(this.labelPayload(category)) });
      category.labelName = renamed.name;
    }
    await this.update((state) => {
      if (active(state.run)) throw new Error('Stop the run before editing categories.');
      state.categories = old ? state.categories.map((item) => item.id === old.id ? category : item) : [...state.categories, category];
    });
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
  }
  private validateRun(state: StoredState): void {
    if (!state.helperToken) throw new Error('Start the local helper and paste its pairing token first.');
    if (!state.categories.length) throw new Error('Create at least one category before categorizing.');
    if (state.categories.some(isStarterCategory)) throw new Error('Rename each Edit Me! category and add its description before categorizing.');
    validateCategoryTitles(state.categories);
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
    const now = Date.now();
    await this.update((current) => {
      if (active(current.run)) throw new Error('A run is already active.');
      current.daysBack = daysBack;
      archiveRun(current);
      current.run = {
        id: crypto.randomUUID(), owner: this.owner, status: 'running', phase: 'discovering', daysBack,
        cutoff: now - daysBack * 86400000, before: now,
        query: `after:${Math.floor((now - daysBack * 86400000) / 1000)} before:${Math.ceil(now / 1000)}`,
        total: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, startedAt: now, updatedAt: now,
        categories: structuredClone(current.categories), accountEmail: current.accountEmail!, discovered: false, items: [],
        gmailUsage: { startedAt: now, complete: true, methods: [] },
      };
    });
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
    await this.helper('health', state.helperToken!);
    await this.update((current) => {
      const run = current.run!;
      run.gmailUsage ||= { startedAt: Date.now(), complete: false, methods: [] };
      const changed = JSON.stringify(categoryDefinitions(run.categories)) !== JSON.stringify(categoryDefinitions(current.categories));
      for (const item of run.items) {
        if (item.status === 'failed') { item.status = 'pending'; delete item.error; }
        if (changed && item.status === 'pending') delete item.decision;
      }
      run.categories = structuredClone(current.categories);
      run.owner = this.owner; run.status = 'running'; run.updatedAt = Date.now(); delete run.error;
      recalculate(run);
    });
    this.launch();
  }
  private launch(): void {
    this.running = this.drain();
    // drain catches all failures and checkpoints; completion bookkeeping is ephemeral only.
    void (async () => { try { await this.running; } finally { this.running = undefined; } })();
  }
  private async pauseIfStopped(runId: string): Promise<boolean> {
    return await this.update((state) => {
      const run = state.run;
      if (!run || run.id !== runId || run.status !== 'running') {
        if (run?.id === runId && run.status === 'stopping') { run.status = 'paused'; run.error = 'Stopped. Completed labels are saved. Resume when ready.'; run.updatedAt = Date.now(); }
        return true;
      }
      return false;
    });
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
          current.updatedAt = Date.now(); recalculate(current);
        });
      }
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
        run.updatedAt = Date.now();
      });
    } catch (error) {
      if (error instanceof RunStoppedError) { await this.pauseIfStopped(runId); return; }
      await this.update((state) => {
        if (state.run?.id === runId) { state.run.status = 'failed'; state.run.error = errorText(error); state.run.updatedAt = Date.now(); }
      });
    }
  }
  private labelPayload(category: Pick<DockCategory, 'title' | 'color'>) {
    return { name: labelName(category), messageListVisibility: 'show', labelListVisibility: 'labelShow', color: { backgroundColor: category.color, textColor: '#434343' } };
  }
  private async ensureLabels(): Promise<void> {
    let state = await this.read();
    const runId = state.run!.id;
    const { labels = [] } = await this.gmail<{ labels?: Label[] }>('labels', {}, true, runId);
    const specs: DockCategory[] = [...state.categories, { id: UNCATEGORIZED, title: 'Uncategorized', description: '', icon: 'tag', color: '#e7e7e7', labelId: state.uncategorizedLabelId }];
    const ownedLabel = (category: DockCategory) => labels.find((label) => label.id === category.labelId && label.type !== 'system')
      || labels.find((label) => label.name === legacyLabelName(state, category) && label.type !== 'system');
    // Detect collisions before renaming any labels. A plain name alone does not prove ownership.
    for (const category of specs) checkLabelConflict(labels, labelName(category), ownedLabel(category)?.id);
    for (const category of specs) {
      if (await this.pauseIfStopped(state.run!.id)) return;
      state = await this.read();
      let existing = ownedLabel(category);
      const payload = this.labelPayload(category);
      if (!existing) {
        // Use the old identity name only until the immutable ID is saved. This makes a lost
        // create response recoverable without taking ownership of an unrelated plain label.
        const creationPayload = { ...payload, name: legacyLabelName(state, category) };
        try { existing = await this.gmail<Label>('labels', { method: 'POST', body: JSON.stringify(creationPayload) }, false, runId); }
        catch (error) {
          if (error instanceof RunStoppedError) throw error;
          // Never blindly retry creates: a lost response may already have created the label.
          const current = await this.gmail<{ labels?: Label[] }>('labels', {}, true, runId);
          existing = current.labels?.find((label) => label.name === creationPayload.name && label.type !== 'system');
          if (!existing) throw error;
        }
        labels.push(existing);
      }
      const labelId = existing.id;
      // Save ownership before PATCH: a rename can succeed even when its response is lost.
      await this.update((current) => {
        if (category.id === UNCATEGORIZED) {
          if (current.uncategorizedLabelId !== labelId) delete current.uncategorizedLabelName;
          current.uncategorizedLabelId = labelId;
        }
        else {
          const matching = current.categories.find((item) => item.id === category.id);
          if (matching) {
            if (matching.labelId !== labelId) delete matching.labelName;
            matching.labelId = labelId;
          }
        }
        current.run!.categories = structuredClone(current.categories);
      });
      const renamed = await this.gmail<Label>(`labels/${encodeURIComponent(labelId)}`, { method: 'PATCH', body: JSON.stringify(payload) }, true, runId);
      existing.name = renamed.name;
      await this.update((current) => {
        if (category.id === UNCATEGORIZED) {
          if (current.uncategorizedLabelId === labelId) current.uncategorizedLabelName = renamed.name;
        } else {
          const matching = current.categories.find((item) => item.id === category.id && item.labelId === labelId);
          if (matching) matching.labelName = renamed.name;
        }
        if (current.run?.id === runId) current.run.categories = structuredClone(current.categories);
      });
    }
  }
  private async processItem(runId: string, messageId: string): Promise<void> {
    try {
      let state = await this.read();
      if (state.run?.id !== runId || state.run.status !== 'running') return;
      const run = state.run;
      const message = await this.gmail<GmailFullMessage>(`messages/${encodeURIComponent(messageId)}?format=full`, {}, true, runId);
      // Re-check INBOX and exact epoch bounds immediately before classifying each message.
      if (!message.labelIds?.includes('INBOX') || Number(message.internalDate) < run.cutoff || Number(message.internalDate) > run.before) {
        await this.finishItem(runId, messageId, 'skipped'); return;
      }
      let decision = run.items.find((item) => item.id === messageId)?.decision;
      if (!decision) {
        const body = await decodedBody(message.payload, async (id) => (await this.gmail<{ data: string }>(`messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(id)}`, {}, true, runId)).data);
        if (body.length > 60000) throw new Error('Email body exceeds 60,000 characters. This email was left unchanged.');
        state = await this.read();
        if (state.run?.status !== 'running') return;
        decision = await this.helper<Classification>('classify', state.helperToken!, {
          message: { sender: header(message.payload, 'From'), subject: header(message.payload, 'Subject'), body },
          categories: categoryDefinitions(run.categories),
        });
        if (decision.categoryId !== null && !run.categories.some((category) => category.id === decision!.categoryId)) throw new Error('The classifier returned an unknown category. Email left unchanged.');
        if (!decision.answer || decision.answer.type !== 'choice' || !Number.isFinite(decision.answer.confidence) || !decision.answer.probabilities || (decision.categoryId === null ? decision.answer.choice !== '__uncategorized__' : decision.answer.choice !== decision.categoryId)) throw new Error('The classifier returned an invalid Choice result. Email left unchanged.');
        await this.update((current) => {
          const item = current.run?.id === runId ? current.run.items.find((entry) => entry.id === messageId) : undefined;
          if (item) item.decision = decision;
        });
      }
      state = await this.read();
      if (state.run?.status !== 'running') return;
      const target = decision.categoryId === null ? state.uncategorizedLabelId : state.categories.find((category) => category.id === decision!.categoryId)?.labelId;
      if (!target) throw new Error('Category label is missing. Resume the run to recreate it.');
      const removeLabelIds = [...state.categories.map((category) => category.labelId), state.uncategorizedLabelId]
        .filter((id): id is string => !!id && id !== target && !!message.labelIds?.includes(id));
      // Never pass INBOX, UNREAD, or any unrelated label as a removal. Applying again is idempotent.
      await this.gmail(`messages/${encodeURIComponent(messageId)}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: [target], removeLabelIds }) }, true, runId);
      await this.finishItem(runId, messageId, 'succeeded');
    } catch (error) {
      if (error instanceof RunStoppedError) return;
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
      state.run.updatedAt = Date.now(); recalculate(state.run);
    });
  }
  private async refreshLabels(): Promise<void> {
    const state = await this.requireAccount();
    const { labels = [] } = await this.gmail<{ labels?: Label[] }>('labels');
    const namesById = new Map(labels.filter((label) => label.type !== 'system').map((label) => [label.id, label.name]));
    const requested = new Map(state.categories.map((category) => [category.id, category]));
    await this.update((current) => {
      if (current.accountEmail !== state.accountEmail) return;
      for (const category of current.categories) {
        const before = requested.get(category.id);
        // A run can rename a label while this read is pending. Keep its newer name.
        if (!before || before.labelId !== category.labelId || before.labelName !== category.labelName) continue;
        const name = category.labelId ? namesById.get(category.labelId) : undefined;
        if (name) category.labelName = name;
        else delete category.labelName;
      }
      if (current.uncategorizedLabelId === state.uncategorizedLabelId && current.uncategorizedLabelName === state.uncategorizedLabelName) {
        const name = current.uncategorizedLabelId ? namesById.get(current.uncategorizedLabelId) : undefined;
        if (name) current.uncategorizedLabelName = name;
        else delete current.uncategorizedLabelName;
      }
    });
  }
  private async gmail<T = unknown>(path: string, init: RequestInit = {}, retry = true, runId?: string): Promise<T> {
    let refreshed = false;
    let requestRetried = false;
    let profileRetried = false;
    while (true) {
      let token: string;
      try { token = await this.deps.token(false); }
      catch { throw new ApiError('Gmail authorization expired or was denied. Click Reconnect Gmail. Google Testing access needs reconnection after seven days.', 401); }
      if (path !== 'profile') {
        const expected = (await this.read()).accountEmail;
        let actual = this.tokenProfiles.get(token);
        if (!actual) {
          try { actual = (await this.profileForToken(token, runId, profileRetried)).emailAddress; }
          catch (error) {
            if (error instanceof ApiError && error.status === 401 && !refreshed) { refreshed = true; profileRetried = true; await this.deps.invalidateToken(token); continue; }
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
        response = await this.requests.request(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, retry, runId, requestRetried);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401 && !refreshed) {
          refreshed = true; requestRetried = true; await this.deps.invalidateToken(token); this.tokenProfiles.delete(token); continue;
        }
        throw error;
      }
      if (response.status === 204 || init.method === 'DELETE') return undefined as T;
      return await response.json() as T;
    }
  }
  private async profileForToken(token: string, runId?: string, authRetry = false): Promise<{ emailAddress: string }> {
    let response: Response;
    try { response = await this.requests.request('profile', { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, true, runId, authRetry); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) { await this.deps.invalidateToken(token); this.tokenProfiles.delete(token); }
      throw error;
    }
    const profile = await response.json() as { emailAddress?: string };
    if (!profile.emailAddress) throw new Error('Gmail returned no account identity. Reconnect Gmail.');
    this.tokenProfiles.set(token, profile.emailAddress);
    return { emailAddress: profile.emailAddress };
  }
  private async helper<T = unknown>(route: string, token: string, payload?: unknown): Promise<T> {
    let response: Response;
    try {
      // Chromium omits Origin on extension GETs; POST makes the helper's strict Origin check reliable.
      response = await this.deps.fetch(`${HELPER_URL}/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}), signal: AbortSignal.timeout(25000) });
    } catch { throw new PauseRunError('Local helper is unavailable or timed out. Start the helper, confirm its pairing token, and retry.'); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new PauseRunError('The local helper rejected the pairing token or extension identity. Pair again using the helper token.');
      if (response.status === 413) throw new Error('This email or category description set exceeds the classifier size limit. Email left unchanged.');
      throw new PauseRunError(`Classification helper failed (${response.status}). This email was left unchanged; retry later.`);
    }
    return await response.json() as T;
  }
}
