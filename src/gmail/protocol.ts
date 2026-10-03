import type { GmailQuotaMethod } from './quota';

export interface DockCategory {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** Gmail-supported background hex color. Stable across renames and restarts. */
  color: string;
  labelId?: string;
  /** Current Gmail label name, resolved by its immutable ID. */
  labelName?: string;
}
export interface GmailQuotaEntry {
  method: GmailQuotaMethod;
  unitsPerRequest: number;
  requests: number;
  retries: number;
  succeeded: number;
  httpErrors: number;
  networkErrors: number;
}
export interface GmailQuotaUsage {
  startedAt: number;
  /** False when the run began before quota tracking was available. */
  complete: boolean;
  methods: GmailQuotaEntry[];
}
export type TimingStage = 'gmailQueue' | 'gmailRequest' | 'helperQueue' | 'helperRequest' | 'jevRequest' | 'storageRead' | 'storageWrite';
export interface RunTimings {
  /** False for old runs or a worker restart with an unmeasured interval. */
  complete: boolean;
  /** Active elapsed time, including setup, cooldowns and Stop drain. Pauses are excluded. */
  elapsedMs: number;
  completedEmails: number;
  /** Aggregate operation durations overlap. They are not elapsed run time. */
  stages: Partial<Record<TimingStage, { count: number; totalMs: number; maxMs: number }>>;
}
export interface RunProgress {
  id: string;
  status: 'running' | 'stopping' | 'paused' | 'completed' | 'failed';
  phase: 'discovering' | 'categorizing';
  daysBack: number;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  startedAt: number;
  updatedAt: number;
  retryAt?: number;
  error?: string;
  accountEmail?: string;
  gmailUsage?: GmailQuotaUsage;
  timings?: RunTimings;
}
export interface DockState {
  version: 2;
  categories: DockCategory[];
  daysBack: number;
  accountEmail?: string;
  uncategorizedLabelName?: string;
  helperReady: boolean;
  oauthConfigured: boolean;
  run?: RunProgress;
  runHistory?: RunProgress[];
  error?: string;
}
export type DockRequest = { type: 'dock:api' } & (
  | { command: 'state' | 'connect' | 'disconnect' | 'stop' | 'resume' | 'refreshLabels' }
  | { command: 'setDaysBack' | 'start'; daysBack: number }
  | { command: 'pairHelper'; token: string }
  | { command: 'importCategories'; json: string }
  | { command: 'saveCategory'; category: { id?: string; title: string; description: string; icon?: string; color?: string } }
  | { command: 'deleteCategory'; categoryId: string }
);
export type DockResponse =
  | { ok: true; state?: DockState }
  | { ok: false; error: string };
export const UNCATEGORIZED = 'uncategorized';
export const HELPER_URL = 'http://127.0.0.1:38471';
export const STATE_KEY = 'dock-gmail-v2';
