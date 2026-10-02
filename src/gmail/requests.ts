import { GMAIL_QUOTA_METHODS, gmailQuotaMethod, type GmailQuotaMethod } from './quota';

export interface GmailTraffic { nextAt?: number; retryAt?: number }
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly rateLimited = false) { super(message); }
}
export class RunStoppedError extends Error {}
export class GmailNetworkError extends Error {}

type GmailQuotaEvent = { retry: boolean } | { outcome: 'succeeded' | 'httpErrors' | 'networkErrors' };

interface RequestDependencies {
  fetch: typeof fetch;
  traffic<T>(change: (traffic: GmailTraffic) => T): Promise<T>;
  check(runId?: string): Promise<void>;
  waiting(until: number, runId?: string): Promise<void>;
  ready(runId?: string): Promise<void>;
  record(method: GmailQuotaMethod, event: GmailQuotaEvent, runId?: string): Promise<void>;
}

function retryAfter(value: string | null, now: number): number {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, (Date.parse(value) || now) - now);
}

/** One shared scheduler for categorization, label names, account checks, and retries. */
export class GmailRequests {
  // Only serializes the current worker's requests; all timing survives worker restarts.
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly deps: RequestDependencies) {}

  private async wait(ms: number, runId?: string): Promise<void> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await this.deps.check(runId);
      // Storage-backed checks keep an explicitly started run alive, and make Stop responsive.
      // No timer resumes work after the worker/browser restarts.
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, until - Date.now())));
    }
    await this.deps.check(runId);
  }

  private async once(path: string, init: RequestInit, method: GmailQuotaMethod, attempt: number, runId?: string, authRetry = false): Promise<Response> {
    while (true) {
      const previous = this.tail;
      let release!: () => void;
      this.tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        await this.deps.check(runId);
        const timing = await this.deps.traffic((traffic) => ({ ...traffic }));
        const until = Math.max(timing.nextAt || 0, timing.retryAt || 0);
        if (until > Date.now()) {
          // Never hold the request queue through a cooldown: a label-name refresh must
          // not prevent the active run from seeing Stop or showing its countdown.
          release();
          if ((timing.retryAt || 0) > Date.now()) await this.deps.waiting(timing.retryAt!, runId);
          await this.wait(Math.max(0, until - Date.now()), runId);
          continue;
        }
        await this.deps.ready(runId);
        await this.deps.check(runId);
        // Target 4,800 units/minute, leaving headroom under the 6,000 default, with no burst.
        await this.deps.traffic((traffic) => { traffic.nextAt = Date.now() + GMAIL_QUOTA_METHODS[method].units * 12.5; });
        // Save the attempt before dispatch. An interrupted worker leaves an unknown outcome.
        await this.deps.record(method, { retry: authRetry || attempt > 0 }, runId);
        let response: Response;
        try {
          response = await this.deps.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { ...init, signal: AbortSignal.timeout(20000) });
        } catch {
          await this.deps.record(method, { outcome: 'networkErrors' }, runId);
          throw new GmailNetworkError('Gmail could not be reached. Completed work is saved; retry when connected.');
        }
        // Keep storage errors outside the fetch catch so they never cause a network retry.
        await this.deps.record(method, { outcome: response.ok ? 'succeeded' : 'httpErrors' }, runId);
        if (response.ok) return response;
        const payload = await response.json().catch(() => ({})) as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } };
        const reasons = (payload.error?.errors || []).map((error) => error.reason).filter((reason): reason is string => Boolean(reason));
        const rateLimited = response.status === 429 || (response.status === 403 && reasons.some((reason) => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason)));
        const detail = [reasons.join(', ') || payload.error?.status, payload.error?.message].filter(Boolean).join(': ').slice(0, 600);
        if (rateLimited) {
          const until = Date.now() + Math.max(60000, 1000 * 2 ** attempt + Math.random() * 1000, retryAfter(response.headers.get('retry-after'), Date.now()));
          const retryAt = await this.deps.traffic((traffic) => traffic.retryAt = Math.max(traffic.retryAt || 0, until));
          await this.deps.waiting(retryAt, runId);
        }
        const advice = rateLimited ? 'Gmail is rate limiting requests. Completed labels are saved; resume to retry unfinished emails.'
          : response.status === 401 ? 'Gmail authorization expired. Click Reconnect Gmail to grant access again.'
          : response.status === 403 ? 'Gmail denied this request. Completed labels are saved.'
          : 'Completed labels are saved.';
        throw new ApiError(`Gmail request failed (${response.status}${detail ? `: ${detail}` : ''}). ${advice}`, response.status, rateLimited);
      } finally { release(); }
    }
  }

  async request(path: string, init: RequestInit, retry = true, runId?: string, authRetry = false): Promise<Response> {
    const method = gmailQuotaMethod(path, init.method);
    for (let attempt = 0; ; attempt++) {
      try { return await this.once(path, init, method, attempt, runId, authRetry); }
      catch (error) {
        if (error instanceof ApiError && error.rateLimited && retry && attempt < 6) continue;
        if (retry && attempt < 3 && (error instanceof GmailNetworkError || (error instanceof ApiError && [500, 502, 503, 504].includes(error.status)))) {
          await this.wait(1000 * 2 ** attempt + Math.random() * 1000, runId);
          continue;
        }
        throw error;
      }
    }
  }
}
