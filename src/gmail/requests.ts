import { GMAIL_QUOTA_METHODS, GMAIL_QUOTA_UNITS_PER_MINUTE, gmailQuotaMethod, type GmailQuotaMethod } from './quota';

export const GMAIL_MAX_CONCURRENT_REQUESTS = 8;

export interface GmailTraffic { nextAt?: number; retryAt?: number }
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly rateLimited = false) { super(message); }
}
export class RunStoppedError extends Error {}
export class GmailNetworkError extends Error {}

type GmailQuotaEvent = { outcome: 'succeeded' | 'httpErrors' | 'networkErrors' };

interface RequestDependencies {
  fetch: typeof fetch;
  traffic<T>(change: (traffic: GmailTraffic) => T): Promise<T>;
  check(runId?: string): Promise<void>;
  waiting(until: number, runId?: string): Promise<void>;
  admit(method: GmailQuotaMethod, retry: boolean, nextAt: number, runId?: string): Promise<void>;
  record(method: GmailQuotaMethod, event: GmailQuotaEvent, runId?: string): Promise<void>;
  timing?(stage: 'gmailQueue' | 'gmailRequest', milliseconds: number, runId?: string): void;
}

function retryAfter(value: string | null, now: number): number {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, (Date.parse(value) || now) - now);
}

/** One shared scheduler for categorization, label names, account checks, and retries. */
export class GmailRequests {
  // Only admission is serial. Durable reservations and cooldowns survive worker restarts.
  private tail: Promise<void> = Promise.resolve();
  private active = 0;
  private nextAt = 0;
  private retryAt = 0;
  private capacity?: { promise: Promise<void>; release(): void };
  constructor(private readonly deps: RequestDependencies) {}

  private async wait(ms: number, runId?: string): Promise<void> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await this.deps.check(runId);
      // Checks keep Stop responsive. No timer resumes work after a worker/browser restart.
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, until - Date.now())));
    }
    await this.deps.check(runId);
  }

  private capacityChanged(): Promise<void> {
    if (!this.capacity) {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => { release = resolve; });
      this.capacity = { promise, release };
    }
    return this.capacity.promise;
  }

  private async waitForCapacity(changed: Promise<void>, runId?: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([changed, new Promise<void>((resolve) => { timer = setTimeout(resolve, 1000); })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
    await this.deps.check(runId);
  }

  private async dispatch(path: string, init: RequestInit, method: GmailQuotaMethod, retry: boolean, runId?: string): Promise<{ response: Promise<Response>; started: number }> {
    let recorded = false;
    let queuedMilliseconds = 0;
    const spacing = GMAIL_QUOTA_METHODS[method].units * 60000 / GMAIL_QUOTA_UNITS_PER_MINUTE;
    try {
      while (true) {
        const previous = this.tail;
        let release!: () => void;
        this.tail = new Promise<void>((resolve) => { release = resolve; });
        const queuedAt = performance.now();
        await previous;
        queuedMilliseconds += performance.now() - queuedAt;
        let until = 0;
        let capacity: Promise<void> | undefined;
        try {
          await this.deps.check(runId);
          const traffic = await this.deps.traffic((current) => ({ ...current }));
          this.retryAt = Math.max(this.retryAt, traffic.retryAt || 0);
          until = Math.max(this.nextAt, traffic.nextAt || 0, this.retryAt);
          if (until <= Date.now() && this.active < GMAIL_MAX_CONCURRENT_REQUESTS) {
            const nextAt = Date.now() + spacing;
            if (!recorded) {
              // One durable mutation reserves quota, clears an expired run cooldown,
              // and records the attempt. An interrupted worker leaves an unknown outcome.
              await this.deps.admit(method, retry, nextAt, runId);
              recorded = true;
            } else {
              // A cooldown can start while the attempt is saved. Reserve again after
              // that cooldown without counting a second dispatch attempt.
              await this.deps.traffic((current) => { current.nextAt = nextAt; });
            }
            await this.deps.check(runId);
            if (this.retryAt <= Date.now()) {
              this.nextAt = Date.now() + spacing;
              this.active++;
              const started = performance.now();
              let response: Promise<Response>;
              try {
                // Dispatch synchronously after the last cooldown check. No awaited
                // persistence can allow a concurrent cooldown to pass this check.
                response = this.deps.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { ...init, signal: AbortSignal.timeout(20000) });
              } catch (error) { response = Promise.reject(error); }
              return { response, started };
            }
            until = this.retryAt;
          } else if (until <= Date.now()) {
            capacity = this.capacityChanged();
          }
        } finally { release(); }
        // Waiting does not hold admission or consume a network slot.
        if (this.retryAt > Date.now()) await this.deps.waiting(this.retryAt, runId);
        const waitingAt = performance.now();
        try {
          if (capacity) await this.waitForCapacity(capacity, runId);
          else await this.wait(Math.max(0, until - Date.now()), runId);
        } finally { queuedMilliseconds += performance.now() - waitingAt; }
      }
    } finally { this.deps.timing?.('gmailQueue', queuedMilliseconds, runId); }
  }

  private extendCooldown(response: Response, attempt: number): void {
    const now = Date.now();
    this.retryAt = Math.max(this.retryAt, now + Math.max(60000, 1000 * 2 ** attempt + Math.random() * 1000, retryAfter(response.headers.get('retry-after'), now)));
  }

  private async saveCooldown(runId?: string): Promise<void> {
    const retryAt = await this.deps.traffic((traffic) => traffic.retryAt = Math.max(traffic.retryAt || 0, this.retryAt));
    await this.deps.waiting(retryAt, runId);
  }

  private async once<T>(path: string, init: RequestInit, consume: (response: Response) => Promise<T>, method: GmailQuotaMethod, attempt: number, runId?: string, authRetry = false): Promise<T> {
    const pending = await this.dispatch(path, init, method, authRetry || attempt > 0, runId);
    let response: Response | undefined;
    let result!: T;
    let bodyFailure: { error: unknown } | undefined;
    let cooldownFailure: { error: unknown } | undefined;
    let cooldownSave: Promise<void> | undefined;
    let rateLimited = false;
    let detail = '';
    try {
      try { response = await pending.response; } catch { /* Record network failures after releasing the slot. */ }
      if (response?.ok) {
        try { result = await consume(response); }
        catch (error) { bodyFailure = { error }; }
      } else if (response) {
        // Publish known cooldowns before parsing or saving the response. An admission
        // that is already saving its attempt must see this barrier before dispatch.
        if (response.status === 429) {
          rateLimited = true;
          this.extendCooldown(response, attempt);
          // Save immediately while the error body loads. Capture storage failures so
          // the body and its network slot still finish before propagating the error.
          cooldownSave = (async () => {
            try { await this.saveCooldown(runId); }
            catch (error) { cooldownFailure = { error }; }
          })();
        }
        const payload = await response.json().catch(() => ({})) as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } };
        const reasons = (payload?.error?.errors || []).map((error) => error.reason).filter((reason): reason is string => Boolean(reason));
        if (response.status === 403 && reasons.some((reason) => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason))) {
          rateLimited = true;
          this.extendCooldown(response, attempt);
        }
        detail = [reasons.join(', ') || payload?.error?.status, payload?.error?.message].filter(Boolean).join(': ').slice(0, 600);
      }
    } finally {
      this.active--;
      this.capacity?.release();
      this.capacity = undefined;
      // Fetch and body consumption are timed together. Outcome persistence is separate.
      this.deps.timing?.('gmailRequest', performance.now() - pending.started, runId);
    }
    if (cooldownSave) {
      await cooldownSave;
      if (cooldownFailure) throw cooldownFailure.error;
    } else if (rateLimited) await this.saveCooldown(runId);
    // Outcome persistence never holds the admission lock or a network slot. Storage errors
    // must remain outside the fetch catch so they never trigger a network retry.
    await this.deps.record(method, { outcome: !response ? 'networkErrors' : response.ok ? 'succeeded' : 'httpErrors' }, runId);
    if (!response) throw new GmailNetworkError('Gmail could not be reached. Completed work is saved; retry when connected.');
    if (bodyFailure) throw bodyFailure.error;
    if (response.ok) return result;
    const advice = rateLimited ? 'Gmail is rate limiting requests. Completed labels are saved; resume to retry unfinished emails.'
      : response.status === 401 ? 'Gmail authorization expired. Click Reconnect Gmail to grant access again.'
      : response.status === 403 ? 'Gmail denied this request. Completed labels are saved.'
      : 'Completed labels are saved.';
    throw new ApiError(`Gmail request failed (${response.status}${detail ? `: ${detail}` : ''}). ${advice}`, response.status, rateLimited);
  }

  async request<T>(path: string, init: RequestInit, consume: (response: Response) => Promise<T>, retry = true, runId?: string, authRetry = false): Promise<T> {
    const method = gmailQuotaMethod(path, init.method);
    for (let attempt = 0; ; attempt++) {
      try { return await this.once(path, init, consume, method, attempt, runId, authRetry); }
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
