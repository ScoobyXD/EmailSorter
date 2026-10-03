export const HELPER_CONCURRENCY = 4;
export const HELPER_REQUESTS_PER_MINUTE = 240;
export const HELPER_RATE_WINDOW_MS = 60000;
export const HELPER_RATE_RESET_HEADER = 'X-Dock-Rate-Limit-Reset';

export interface HelperRateLimit {
  resetAt: number;
  remaining: number;
  active: number;
}

export interface ClassificationTiming {
  /** SDK call duration, including any internal retries and their delays. */
  jevRequestMs: number;
  jevSdkCalls: number;
  /** The SDK does not report its actual retry count. */
  jevRetries: null;
  cacheHit: boolean;
}
