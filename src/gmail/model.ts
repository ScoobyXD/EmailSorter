import type { DockCategory, DockState, EmailReference, RunProgress } from './protocol';
import type { GmailTraffic } from './requests';

export interface Classification {
  categoryId: string | null;
  model: string;
  answer: { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };
  usage: { input_tokens: number; output_tokens: number };
}
interface RunItem extends EmailReference {
  status: 'pending' | 'succeeded' | 'failed' | 'skipped';
  /** Persist the exact probability output before Gmail mutation so retries reuse it. */
  decision?: Classification;
  error?: string;
}
export interface StoredRun extends RunProgress {
  owner: string;
  cutoff: number;
  before: number;
  query: string;
  pageToken?: string;
  discovered: boolean;
  categories: DockCategory[];
  accountEmail: string;
  items: RunItem[];
}
export interface StoredState extends Omit<DockState, 'oauthConfigured' | 'helperReady' | 'run'> {
  installationId: string;
  helperToken?: string;
  labelAccountEmail?: string;
  labelIdsByAccount?: Record<string, { categories: { id: string; labelId: string }[]; uncategorizedLabelId?: string }>;
  recentDecisions?: { messageId: string; decision: Classification }[];
  uncategorizedLabelId?: string;
  gmailTraffic?: GmailTraffic;
  helperRetryAt?: number;
  run?: StoredRun;
}
export const COLORS = ['#c9daf8', '#e4d7f5', '#fef1d1', '#fcdee8', '#b9e4d0', '#ffe6c7', '#e7e7e7'];
export const DAYS_BACK_MIN = 0;
export const DAYS_BACK_MAX = 100;
export function clampDaysBack(days: number): number {
  return Math.max(DAYS_BACK_MIN, Math.min(DAYS_BACK_MAX, days));
}
export const DEFAULT_CATEGORY_TITLE = 'Edit Me!';
const STARTER_CATEGORY_IDS = ['starter-1', 'starter-2', 'starter-3'];

export function createDefaultCategories(): DockCategory[] {
  return STARTER_CATEGORY_IDS.map((id, index) => ({ id, title: DEFAULT_CATEGORY_TITLE, description: '', icon: 'tag', color: COLORS[index]! }));
}

/** A starter stops being a placeholder once its title changes. */
export function isStarterCategory(category: Pick<DockCategory, 'id' | 'title'>): boolean {
  return STARTER_CATEGORY_IDS.includes(category.id) && category.title.trim().toLowerCase() === DEFAULT_CATEGORY_TITLE.toLowerCase();
}
export function initialState(legacy?: unknown): StoredState {
  const old = legacy as { version?: unknown; categories?: unknown } | undefined;
  const candidate = old?.version === 1 && Array.isArray(old.categories) ? old.categories : null;
  const categories: DockCategory[] = [];
  if (candidate) {
    const seen = new Set<string>();
    for (const item of candidate.slice(0, 50)) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.name !== 'string') continue;
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(item.id) || seen.has(item.id) || !item.name.trim()) continue;
      // Urgency was cancelled. Never migrate the old special urgency tab.
      if (item.id === 'urgent' || item.id === 'uncategorized') continue;
      seen.add(item.id);
      categories.push({ id: item.id, title: item.name.trim().slice(0, 120), description: '', icon: 'tag', color: COLORS[categories.length % COLORS.length]! });
    }
  } else {
    categories.push(...createDefaultCategories());
  }
  return { version: 2, installationId: crypto.randomUUID(), categories, daysBack: 30 };
}
export function publicState(state: StoredState, oauthConfigured: boolean): DockState {
  return {
    version: 2, categories: state.categories, daysBack: state.daysBack,
    accountEmail: state.accountEmail, helperReady: Boolean(state.helperToken), oauthConfigured,
    uncategorizedLabelName: state.uncategorizedLabelName,
    error: state.error,
    ...(state.run ? { run: {
      ...runProgress(state.run),
      failures: state.run.items.filter((item) => item.status === 'failed').map(({ id, subject, sender, error }) => ({
        id, subject, sender, error: error || 'This email could not be categorized.',
      })),
    } } : {}),
    runHistory: state.runHistory,
  };
}
/** Reuse this summary for the public API and persisted history. Never copy run items or decisions. */
export function runProgress(run: StoredRun): RunProgress {
  return {
    id: run.id, status: run.status, phase: run.phase, daysBack: run.daysBack, total: run.total,
    processed: run.processed, succeeded: run.succeeded, failed: run.failed, skipped: run.skipped,
    startedAt: run.startedAt, updatedAt: run.updatedAt, error: run.error, retryAt: run.retryAt,
    accountEmail: run.accountEmail,
    gmailUsage: run.gmailUsage ? structuredClone(run.gmailUsage) : undefined,
    timings: run.timings ? structuredClone(run.timings) : undefined,
  };
}
export function archiveRun(state: StoredState): void {
  if (!state.run) return;
  state.runHistory = [runProgress(state.run), ...(state.runHistory || []).filter((run) => run.id !== state.run!.id)].slice(0, 20);
}
export function recalculate(run: StoredRun): void {
  run.total = run.items.length;
  run.succeeded = run.failed = run.skipped = 0;
  for (const { status } of run.items) {
    if (status === 'succeeded' || status === 'failed' || status === 'skipped') run[status]++;
  }
  run.processed = run.succeeded + run.failed + run.skipped;
}
/** Gmail shows only the category title. Ownership is stored by immutable label ID. */
export function labelName(category: Pick<DockCategory, 'title'>): string {
  return category.title.trim();
}
/** Recover old labels and interrupted creates before renaming them to the category title. */
export function legacyLabelName(state: StoredState, category: Pick<DockCategory, 'id' | 'title'>): string {
  let hash = 14695981039346656037n;
  for (const character of `${state.installationId}:${category.id}`) hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 1099511628211n);
  return `Dock/${category.title.replace(/[\r\n\/]/g, ' ')} [${hash.toString(16).padStart(16, '0').slice(-12)}]`;
}
