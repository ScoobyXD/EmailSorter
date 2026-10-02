import { HELPER_URL } from './protocol';
import type { LogDraft, LogEvent, LogExport, LogPage, LogPersistence, LogRunSummary } from './log-types';

const RETENTION_LIMIT = 100000;
const SUMMARY_LIMIT = 100;
const MIRROR_RETRY_MS = 5000;
const MAX_EVENT_BYTES = 240000;
const encoder = new TextEncoder();
interface JournalMeta {
  key: 'journal'; journalId: string; latestSequence: number; firstAvailableSequence: number; mirroredThrough: number;
  path?: string; mirrorError?: string; retryAt?: number;
}
interface JournalOptions {
  identity(): Promise<{ installationId: string; helperToken?: string } | undefined>;
  fetch: typeof fetch;
  extensionVersion: string;
  indexedDB?: IDBFactory;
  databaseName?: string;
  now?: () => number;
  /** Fixtures can exercise eviction without generating 100,001 entries. */
  retentionLimit?: number;
}
const emptyMeta = (): JournalMeta => ({ key: 'journal', journalId: crypto.randomUUID(), latestSequence: 0, firstAvailableSequence: 0, mirroredThrough: 0 });
const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error || new Error('Journal database request failed.'));
});
const completed = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error('Journal transaction was interrupted.'));
  tx.onerror = () => { /* onabort reports the transaction failure. */ };
});
function validateRunId(runId?: string): void {
  if (runId !== undefined && (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(runId))) throw new Error('Invalid log run identifier.');
}
function cleanDraft(draft: LogDraft): LogDraft {
  validateRunId(draft.runId);
  if (!Number.isFinite(draft.at) || !['run', 'browse', 'connection', 'system'].includes(draft.scope)
    || !['info', 'warn', 'error'].includes(draft.level) || !['run', 'discovery', 'read', 'classification', 'labels', 'quota', 'connection', 'browse'].includes(draft.stage)
    || typeof draft.event !== 'string' || !/^[a-z0-9_.-]{1,100}$/.test(draft.event) || typeof draft.message !== 'string') throw new Error('Invalid diagnostic event.');
  // Callers provide explicit metadata, never request/response bodies. Defense in depth for nested objects.
  const truncated: string[] = [];
  const text = (value: string, path: string, max = 4096) => {
    const diagnostic = /(?:error|message)$/i.test(path) ? value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email address]') : value;
    const clean = diagnostic.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').slice(0, max);
    if (clean !== value) truncated.push(path);
    return clean;
  };
  const sensitiveKeys = new Set(['body', 'bodytext', 'decodedbody', 'rawbody', 'emailbody', 'htmlbody', 'textbody', 'rawmessage', 'rawemail', 'rawprompt', 'prompt', 'authorization', 'auth', 'cookie', 'cookies', 'token', 'accesstoken', 'refreshtoken', 'idtoken', 'helpertoken', 'pairingtoken', 'pairingcode', 'apikey', 'secret', 'clientsecret', 'password', 'credential', 'credentials', 'proto', 'prototype', 'constructor', 'subject', 'sender', 'accountemail', 'emailaddress', 'snippet']);
  const scrub = (value: unknown, path: string, depth = 0): unknown => {
    if (depth > 12) { truncated.push(path); return '[Metadata nesting limit]'; }
    if (typeof value === 'string') return text(value, path);
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map((item, i) => scrub(item, `${path}[${i}]`, depth + 1));
    if (value && typeof value === 'object') {
      // These are user-defined category IDs, not credential field names.
      if (path.endsWith('.answer.probabilities') && Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 1)) return Object.fromEntries(Object.entries(value));
      return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitiveKeys.has(key.replace(/[_-]/g, '').toLowerCase())).map(([key, entry]) => [key, scrub(entry, `${path}.${key}`, depth + 1)]));
    }
    return value;
  };
  const data = draft.data ? scrub(draft.data, 'data') as Record<string, unknown> : undefined;
  const safe: LogDraft = { at: draft.at, scope: draft.scope, level: draft.level, stage: draft.stage, event: draft.event, message: text(draft.message, 'message', 2000) };
  if (draft.runId) safe.runId = draft.runId;
  if (draft.messageId) safe.messageId = String(draft.messageId).slice(0, 200);
  if (draft.requestId) safe.requestId = String(draft.requestId).slice(0, 200);
  if (data) safe.data = data;
  if (truncated.length) safe.data = { ...safe.data, logTruncatedFields: truncated.slice(0, 200) };
  if (encoder.encode(JSON.stringify(safe)).length > MAX_EVENT_BYTES) throw new Error('Diagnostic metadata exceeds the per-event size limit.');
  return safe;
}
function summarize(previous: LogRunSummary | undefined, event: LogDraft): LogRunSummary {
  const data = event.data || {};
  const summary: LogRunSummary = previous || { id: event.runId!, startedAt: Number(data.startedAt) || event.at, updatedAt: event.at, status: 'running', events: 0, gmailRequests: 0, estimatedQuotaUnits: 0, errors: 0, labeled: 0 };
  summary.updatedAt = Math.max(summary.updatedAt, event.at); summary.events++;
  if (event.level === 'error') summary.errors++;
  if (event.event === 'gmail.request') { summary.gmailRequests++; summary.estimatedQuotaUnits += Number(data.estimatedQuotaUnits) || 0; }
  if (event.event === 'email.succeeded') summary.labeled++;
  if (event.event === 'run.started' || event.event === 'run.resumed') {
    summary.status = 'running';
    if (typeof data.startedAt === 'number' && Number.isFinite(data.startedAt)) summary.startedAt = data.startedAt;
    if (typeof data.daysBack === 'number') summary.daysBack = data.daysBack;
    if (typeof data.succeeded === 'number') summary.labeled = Math.max(summary.labeled, data.succeeded);
  }
  if (event.event === 'run.stop_requested') summary.status = 'stopping';
  if (event.event === 'run.paused') summary.status = 'paused';
  if (event.event === 'run.failed') summary.status = 'failed';
  if (event.event === 'run.completed') summary.status = data.status === 'failed' ? 'failed' : 'completed';
  return summary;
}

/** Ordered, transactional journal. Only immutable events and mirror acknowledgements survive worker lifetimes. */
export class GmailJournal {
  private database?: Promise<IDBDatabase>;
  private mirrorTask?: Promise<void>;
  private mirrorRequested = false;
  private mirrorForced = false;
  private readonly now: () => number;
  private readonly retentionLimit: number;
  constructor(private readonly options: JournalOptions) {
    this.now = options.now || Date.now;
    this.retentionLimit = options.retentionLimit || RETENTION_LIMIT;
  }
  private async open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const opening = (this.options.indexedDB || globalThis.indexedDB).open(this.options.databaseName || 'dock-diagnostic-journal-v1', 1);
        opening.onupgradeneeded = () => {
          const db = opening.result;
          const events = db.createObjectStore('events', { keyPath: 'seq', autoIncrement: true });
          events.createIndex('runSequence', ['runId', 'seq']);
          const runs = db.createObjectStore('runs', { keyPath: 'id' }); runs.createIndex('updatedAt', 'updatedAt');
          db.createObjectStore('meta', { keyPath: 'key' });
        };
        opening.onsuccess = () => {
          const db = opening.result;
          db.onversionchange = () => { db.close(); this.database = undefined; };
          resolve(db);
        };
        opening.onerror = () => reject(opening.error || new Error('Could not open the diagnostic journal.'));
        opening.onblocked = () => reject(new Error('Close other Dock extension pages and retry opening diagnostic logs.'));
      });
    }
    try { return await this.database; } catch (error) { this.database = undefined; throw error; }
  }
  async append(draft: LogDraft): Promise<LogEvent> {
    const safe = cleanDraft(draft);
    const db = await this.open();
    const tx = db.transaction(['events', 'runs', 'meta'], 'readwrite', { durability: 'strict' });
    const done = completed(tx);
    try {
      const events = tx.objectStore('events');
      const id = crypto.randomUUID();
      const seq = Number(await request(events.add({ ...safe, id })));
      const meta: JournalMeta = await request(tx.objectStore('meta').get('journal')) || emptyMeta();
      meta.journalId ||= crypto.randomUUID();
      meta.latestSequence = seq;
      this.prune(tx, meta);
      tx.objectStore('meta').put(meta);
      if (safe.runId) {
        const runs = tx.objectStore('runs');
        const existing = await request(runs.get(safe.runId)) as LogRunSummary | undefined;
        runs.put(summarize(existing, safe));
        if (!existing) {
          const summaries = await request(runs.getAll()) as LogRunSummary[];
          summaries.sort((a, b) => b.updatedAt - a.updatedAt);
          for (const old of summaries.slice(SUMMARY_LIMIT)) runs.delete(old.id);
        }
      }
      await done;
      this.kickMirror();
      return { ...safe, seq, id };
    } catch (error) { try { tx.abort(); } catch { /* The transaction already completed or failed. */ } await done.catch(() => {}); throw error; }
  }
  private async meta(): Promise<JournalMeta> {
    const db = await this.open(); const tx = db.transaction('meta', 'readonly');
    return await request(tx.objectStore('meta').get('journal')) || emptyMeta();
  }
  private async updateMeta(change: (meta: JournalMeta) => void): Promise<void> {
    const db = await this.open(); const tx = db.transaction(['meta', 'events'], 'readwrite', { durability: 'strict' }); const done = completed(tx);
    try { const meta = await request(tx.objectStore('meta').get('journal')) || emptyMeta(); change(meta); this.prune(tx, meta); tx.objectStore('meta').put(meta); await done; }
    catch (error) { try { tx.abort(); } catch { /* Already closed. */ } await done.catch(() => {}); throw error; }
  }
  private prune(tx: IDBTransaction, meta: JournalMeta): void {
    // The browser limit is soft while offline: never discard the only durable copy of an event.
    const through = Math.min(meta.mirroredThrough, Math.max(0, meta.latestSequence - this.retentionLimit));
    if (through > 0) tx.objectStore('events').delete(IDBKeyRange.upperBound(through));
    meta.firstAvailableSequence = meta.latestSequence ? through + 1 : 0;
  }
  private coverage(meta: JournalMeta): LogPersistence {
    return { browser: 'Saved in this browser’s extension IndexedDB journal.', mirror: meta.mirroredThrough >= meta.latestSequence ? 'saved' : meta.mirrorError ? 'unavailable' : 'pending', mirroredThrough: meta.mirroredThrough, latestSequence: meta.latestSequence, firstAvailableSequence: meta.firstAvailableSequence, retentionLimit: this.retentionLimit, ...(meta.path ? { path: meta.path } : {}), ...(meta.mirrorError ? { error: meta.mirrorError } : {}) };
  }
  private async readEvents(store: IDBObjectStore, runId: string | undefined, before: number | undefined, limit: number, direction: IDBCursorDirection): Promise<LogEvent[]> {
    const source = runId ? store.index('runSequence') : store;
    const range = runId ? IDBKeyRange.bound([runId, 0], [runId, before ?? Number.MAX_SAFE_INTEGER], false, true)
      : before === undefined ? undefined : IDBKeyRange.upperBound(before, true);
    return await new Promise((resolve, reject) => {
      const result: LogEvent[] = []; const cursor = source.openCursor(range, direction);
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => { const current = cursor.result; if (!current || result.length >= limit) { resolve(result); return; } result.push(current.value); current.continue(); };
    });
  }
  async page({ runId, before, limit = 100 }: { runId?: string; before?: number; limit?: number } = {}): Promise<LogPage> {
    validateRunId(runId);
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new Error('Invalid log page cursor.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Choose a log page size from 1 to 200.');
    const db = await this.open(); const tx = db.transaction(['events', 'runs', 'meta'], 'readonly');
    const [events, summaries, meta] = await Promise.all([
      this.readEvents(tx.objectStore('events'), runId, before, limit + 1, 'prev'),
      request(tx.objectStore('runs').getAll()) as Promise<LogRunSummary[]>,
      request(tx.objectStore('meta').get('journal')) as Promise<JournalMeta | undefined>,
    ]);
    const hasMore = events.length > limit; events.length = Math.min(limit, events.length);
    return { runs: summaries.sort((a, b) => b.updatedAt - a.updatedAt), events, hasMore, ...(hasMore ? { nextBefore: events.at(-1)!.seq } : {}), persistence: this.coverage(meta || emptyMeta()) };
  }
  async export(runId?: string): Promise<LogExport> {
    validateRunId(runId);
    const db = await this.open(); const tx = db.transaction(['events', 'runs', 'meta'], 'readonly');
    const [events, summaries, meta] = await Promise.all([
      this.readEvents(tx.objectStore('events'), runId, undefined, Number.MAX_SAFE_INTEGER, 'next'),
      request(tx.objectStore('runs').getAll()) as Promise<LogRunSummary[]>,
      request(tx.objectStore('meta').get('journal')) as Promise<JournalMeta | undefined>,
    ]);
    const coverage = this.coverage(meta || emptyMeta());
    const notes = [
      'Events are ordered by durable sequence number. This export includes all retained events in the selected scope, independent of the visible page.',
      'No diagnostic events exist for work performed before this logging feature was installed. Logs contain operational metadata, never email bodies or authorization tokens. Oversized strings and control characters are sanitized, with affected fields listed in data.logTruncatedFields.',
      `The browser retains its latest ${this.retentionLimit.toLocaleString('en-US')} events plus any unmirrored backlog, and up to ${SUMMARY_LIMIT} recent run summaries. Older events are pruned only after the helper acknowledges its durable file copy. Summary totals can include events that have since aged out. Browser data can be cleared or removed with the extension.`,
    ];
    if (coverage.firstAvailableSequence > 1) notes.push(`Browser retention removed sequences before ${coverage.firstAvailableSequence}; the helper file may retain the older history.`);
    if (coverage.mirroredThrough < coverage.latestSequence) notes.push(`The helper has acknowledged through sequence ${coverage.mirroredThrough}; newer retained events are saved in the browser and await mirroring.`);
    if (runId && !events.some((event) => event.event === 'run.started')) notes.push('This run has no retained start event; its earlier history may predate logging or browser retention.');
    return { schemaVersion: 1, exportedAt: new Date(this.now()).toISOString(), extensionVersion: this.options.extensionVersion, ...(runId ? { runId } : {}), runs: summaries.filter((run) => !runId || run.id === runId).sort((a, b) => a.startedAt - b.startedAt), coverage, notes, events };
  }
  /** Automatic sync never delays a journal append or an engine operation. */
  kickMirror(): void {
    void (async () => { try { await this.startMirror(false); } catch { /* Local append errors are reported by the engine; mirror errors remain in metadata. */ } })();
  }
  async sync(): Promise<LogPersistence> {
    await this.startMirror(true);
    return this.coverage(await this.meta());
  }
  private startMirror(force: boolean): Promise<void> {
    this.mirrorRequested = true; this.mirrorForced ||= force;
    if (this.mirrorTask) return this.mirrorTask;
    this.mirrorTask = (async () => {
      // Let nearby appends join the first batch, without a timer or a dependency on engine progress.
      await Promise.resolve();
      try {
        do {
          this.mirrorRequested = false;
          const forced = this.mirrorForced; this.mirrorForced = false;
          await this.flushBatches(forced);
        } while (this.mirrorRequested);
      } finally { this.mirrorTask = undefined; }
    })();
    return this.mirrorTask;
  }
  private async flushBatches(force: boolean): Promise<void> {
    let meta = await this.meta();
    if (meta.mirroredThrough >= meta.latestSequence || (!force && (meta.retryAt || 0) > this.now())) return;
    try {
      const identity = await this.options.identity();
      if (!identity?.installationId || !identity.helperToken) throw new Error('Logs are saved in this browser. Pair the local helper to also save a local file.');
      if (!meta.journalId) { await this.updateMeta((current) => { current.journalId ||= crypto.randomUUID(); }); meta = await this.meta(); }
      // A fresh IndexedDB journal gets a fresh file namespace, even if Chrome settings survived a data clear.
      const installationId = `${identity.installationId.slice(0, 60)}-${meta.journalId}`;
      while (meta.mirroredThrough < meta.latestSequence) {
        const db = await this.open(); const tx = db.transaction('events', 'readonly');
        const candidates = await request(tx.objectStore('events').getAll(IDBKeyRange.lowerBound(meta.mirroredThrough, true), 25)) as LogEvent[];
        if (!candidates.length) return;
        const events: LogEvent[] = [];
        for (const event of candidates) {
          if (encoder.encode(JSON.stringify({ installationId, events: [...events, event] })).length > 250000) break;
          events.push(event);
        }
        if (!events.length) throw new Error('A diagnostic event exceeds the helper batch limit. Export browser logs for recovery.');
        const response = await this.options.fetch(`${HELPER_URL}/logs/append`, { method: 'POST', headers: { Authorization: `Bearer ${identity.helperToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ installationId, events }), signal: AbortSignal.timeout(10000) });
        if (response.status === 404) throw new Error('Restart the updated local helper to enable persistent log files. Browser logs remain saved.');
        if (!response.ok) throw new Error(`Local log file could not be updated (${response.status}). Browser logs remain saved; check the helper and retry sync.`);
        const ack = await response.json() as { ok?: unknown; acceptedThrough?: unknown; path?: unknown };
        const through = events.at(-1)!.seq;
        if (ack.ok !== true || !Number.isSafeInteger(ack.acceptedThrough) || Number(ack.acceptedThrough) < through || typeof ack.path !== 'string' || !ack.path || ack.path.length > 2000) throw new Error('The local helper did not acknowledge this log batch. Browser logs remain saved.');
        await this.updateMeta((current) => { current.mirroredThrough = Math.max(current.mirroredThrough, through); current.path = ack.path as string; delete current.mirrorError; delete current.retryAt; });
        meta = await this.meta();
      }
    } catch (error) {
      const message = error instanceof Error && !/fetch|network|abort|timeout/i.test(error.message) ? error.message : 'The local helper is unavailable. Browser logs remain saved; restart the helper or retry sync.';
      await this.updateMeta((current) => { current.mirrorError = message.slice(0, 1000); current.retryAt = this.now() + MIRROR_RETRY_MS; });
    }
  }
}
