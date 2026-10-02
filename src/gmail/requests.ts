import type { LogDraft, LogStage } from './log-types';
/** Costs from https://developers.google.com/workspace/gmail/api/reference/quota. */
export function gmailUnits(path: string, method = 'GET'): number {
  const resource = path.split('?')[0]!;
  if (resource === 'profile' || (resource === 'labels' && method === 'GET')) return 1;
  if (resource.startsWith('labels/')) return method === 'GET' ? 1 : 5;
  if (resource === 'labels' || resource === 'messages' || resource.endsWith('/modify')) return 5;
  // messages.get and messages.attachments.get both cost 20, including metadata reads.
  return 20;
}

export interface GmailTraffic { nextAt?: number; retryAt?: number }
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly rateLimited = false) { super(message); }
}
export class RunStoppedError extends Error {}
export class GmailNetworkError extends Error {}

interface RequestDependencies {
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
  traffic<T>(change: (traffic: GmailTraffic) => T): Promise<T>;
  check(runId?: string): Promise<void>;
  waiting(until: number, runId?: string): Promise<void>;
  ready(runId?: string): Promise<void>;
  log?(event: LogDraft): Promise<void>;
  uuid?(): string;
  logRunId?(): Promise<string | undefined>;
}

function requestInfo(path: string, method = 'GET') {
  const [resource, query] = path.split('?');
  const params = new URLSearchParams(query);
  const messageId = resource?.match(/^messages\/([^/]+)/)?.[1];
  const operation = resource === 'profile' ? 'users.getProfile'
    : resource === 'messages' ? 'messages.list'
    : resource?.includes('/attachments/') ? 'messages.attachments.get'
    : resource?.endsWith('/modify') ? 'messages.modify'
    : resource?.startsWith('messages/') ? 'messages.get'
    : resource === 'labels' ? method === 'POST' ? 'labels.create' : 'labels.list'
    : `labels.${method === 'DELETE' ? 'delete' : method === 'PATCH' ? 'patch' : 'get'}`;
  const stage: LogStage = operation === 'users.getProfile' ? 'connection'
    : operation === 'messages.modify' || operation.startsWith('labels.') ? 'labels'
    : operation === 'messages.list' ? 'discovery' : 'read';
  return { operation, stage, messageId, format: params.get('format') || undefined };
}

function retryAfter(value: string | null, now: number): number {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, (Date.parse(value) || now) - now);
}

/** One shared scheduler for sorting, category previews, account checks, and retries. */
export class GmailRequests {
  // Only serializes the current worker's requests; all timing survives worker restarts.
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly deps: RequestDependencies) {}

  private async log(event: Omit<LogDraft, 'at'>) {
    await this.deps.log?.({ ...event, at: this.deps.now() });
  }

  private async wait(ms: number, runId?: string): Promise<void> {
    const until = this.deps.now() + ms;
    while (this.deps.now() < until) {
      await this.deps.check(runId);
      // Storage-backed checks keep an explicitly started run alive, and make Stop responsive.
      // No timer resumes work after the worker/browser restarts.
      await this.deps.sleep(Math.min(1000, until - this.deps.now()));
    }
    await this.deps.check(runId);
  }

  private async once(path: string, init: RequestInit, attempt: number, requestId: string, runId?: string, logRunId?: string): Promise<Response> {
    const info = requestInfo(path, init.method);
    const context = { runId: logRunId, requestId, messageId: info.messageId, scope: runId ? 'run' as const : info.stage === 'connection' ? 'connection' as const : 'browse' as const };
    let reportedWait = 0;
    while (true) {
      const previous = this.tail;
      let release!: () => void;
      this.tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        await this.deps.check(runId);
        const timing = await this.deps.traffic((traffic) => ({ ...traffic }));
        const until = Math.max(timing.nextAt || 0, timing.retryAt || 0);
        if (until > this.deps.now()) {
          // Never hold the request queue through a cooldown: a category preview must
          // not prevent the active run from seeing Stop or showing its countdown.
          release();
          if (until !== reportedWait) {
            reportedWait = until;
            const rateLimited = (timing.retryAt || 0) > this.deps.now();
            await this.log({ ...context, level: rateLimited ? 'warn' : 'info', stage: 'quota', event: 'gmail.wait', message: rateLimited ? 'Waiting for Gmail’s quota cooldown before this request.' : 'Pacing this request to stay within the shared Gmail budget.', data: { operation: info.operation, reason: rateLimited ? 'rate_limit' : 'pacing', retryAt: until, delayMs: Math.max(0, until - this.deps.now()), attempt: attempt + 1 } });
          }
          if ((timing.retryAt || 0) > this.deps.now()) await this.deps.waiting(timing.retryAt!, runId);
          await this.wait(Math.max(0, until - this.deps.now()), runId);
          continue;
        }
        await this.deps.ready(runId);
        await this.deps.check(runId);
        // Target 4,800 units/minute, leaving headroom under the 6,000 default, with no burst.
        await this.deps.traffic((traffic) => { traffic.nextAt = this.deps.now() + gmailUnits(path, init.method) * 12.5; });
        const requestData = { operation: info.operation, method: init.method || 'GET', format: info.format, attempt: attempt + 1, estimatedQuotaUnits: gmailUnits(path, init.method) };
        await this.log({ ...context, level: 'info', stage: info.stage, event: 'gmail.request', message: `Sending ${info.operation}${info.format ? ` (${info.format})` : ''}, attempt ${attempt + 1}.`, data: requestData });
        const startedAt = this.deps.now();
        let response: Response;
        try {
          response = await this.deps.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { ...init, signal: AbortSignal.timeout(20000) });
        } catch {
          await this.log({ ...context, level: 'error', stage: info.stage, event: 'gmail.response', message: `${info.operation} failed before a response arrived.`, data: { ...requestData, durationMs: this.deps.now() - startedAt, reason: 'network_or_timeout', outcome: 'unknown' } });
          throw new GmailNetworkError('Gmail could not be reached. Completed work is saved; retry when connected.');
        }
        if (response.ok) {
          await this.log({ ...context, level: 'info', stage: info.stage, event: 'gmail.response', message: `${info.operation} succeeded (${response.status}).`, data: { ...requestData, status: response.status, durationMs: this.deps.now() - startedAt } });
          return response;
        }
        const payload = await response.json().catch(() => ({})) as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } };
        const reasons = (payload.error?.errors || []).map((error) => error.reason).filter((reason): reason is string => Boolean(reason));
        const rateLimited = response.status === 429 || (response.status === 403 && reasons.some((reason) => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason)));
        const detail = [reasons.join(', ') || payload.error?.status, payload.error?.message].filter(Boolean).join(': ').slice(0, 600);
        await this.log({ ...context, level: rateLimited ? 'warn' : 'error', stage: info.stage, event: 'gmail.response', message: `${info.operation} returned ${response.status}${detail ? `: ${detail}` : ''}.`, data: { ...requestData, status: response.status, durationMs: this.deps.now() - startedAt, reasons, googleStatus: payload.error?.status, googleMessage: payload.error?.message?.slice(0, 600), retryAfter: response.headers.get('retry-after'), rateLimited } });
        if (rateLimited) {
          const until = this.deps.now() + Math.max(60000, 1000 * 2 ** attempt + Math.random() * 1000, retryAfter(response.headers.get('retry-after'), this.deps.now()));
          const retryAt = await this.deps.traffic((traffic) => traffic.retryAt = Math.max(traffic.retryAt || 0, until));
          await this.deps.waiting(retryAt, runId);
          await this.log({ ...context, level: 'warn', stage: 'quota', event: 'gmail.cooldown', message: 'All Dock Gmail requests are now waiting for the shared cooldown.', data: { retryAt, delayMs: retryAt - this.deps.now(), reasons } });
        }
        const advice = rateLimited ? 'Gmail is rate limiting requests. Completed labels are saved; resume to retry unfinished emails.'
          : response.status === 401 ? 'Gmail authorization expired. Click Reconnect Gmail to grant access again.'
          : response.status === 403 ? 'Gmail denied this request. Completed labels are saved.'
          : 'Completed labels are saved.';
        throw new ApiError(`Gmail request failed (${response.status}${detail ? `: ${detail}` : ''}). ${advice}`, response.status, rateLimited);
      } finally { release(); }
    }
  }

  async request(path: string, init: RequestInit, retry = true, runId?: string): Promise<Response> {
    const requestId = this.deps.uuid?.() || crypto.randomUUID();
    const logRunId = runId || await this.deps.logRunId?.();
    const info = requestInfo(path, init.method);
    const context = { requestId, runId: logRunId, messageId: info.messageId, scope: runId ? 'run' as const : 'browse' as const };
    for (let attempt = 0; ; attempt++) {
      try { return await this.once(path, init, attempt, requestId, runId, logRunId); }
      catch (error) {
        if (error instanceof ApiError && error.rateLimited && retry && attempt < 6) {
          await this.log({ ...context, level: 'warn', stage: 'quota', event: 'gmail.retry', message: `Retry ${attempt + 1} of 6 will run after the cooldown.`, data: { operation: info.operation, nextAttempt: attempt + 2, reason: 'rate_limit' } });
          continue;
        }
        if (retry && attempt < 3 && (error instanceof GmailNetworkError || (error instanceof ApiError && [500, 502, 503, 504].includes(error.status)))) {
          const delayMs = 1000 * 2 ** attempt + Math.random() * 1000;
          await this.log({ ...context, level: 'warn', stage: info.stage, event: 'gmail.retry', message: 'Retrying a temporary Gmail failure with backoff.', data: { operation: info.operation, nextAttempt: attempt + 2, delayMs } });
          await this.wait(delayMs, runId);
          continue;
        }
        await this.log({ ...context, level: error instanceof RunStoppedError ? 'info' : 'error', stage: info.stage, event: error instanceof RunStoppedError ? 'gmail.cancelled' : 'gmail.exhausted', message: error instanceof RunStoppedError ? 'The pending Gmail request was cancelled by Stop.' : 'This Gmail operation stopped without success.', data: { operation: info.operation, attempts: attempt + 1, error: error instanceof Error ? error.message : 'Unknown failure' } });
        throw error;
      }
    }
  }
}
