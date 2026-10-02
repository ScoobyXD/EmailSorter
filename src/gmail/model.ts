import type { DockCategory, DockState, RunProgress } from './protocol';
import type { GmailTraffic } from './requests';

export interface Classification {
  categoryId: string | null;
  model: string;
  answer: { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };
  usage: { input_tokens: number; output_tokens: number };
}
export interface RunItem {
  id: string;
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
  run?: StoredRun;
}
export const COLORS = ['#c9daf8', '#e4d7f5', '#fef1d1', '#fcdee8', '#b9e4d0', '#ffe6c7', '#e7e7e7'];
const DEFAULTS: [string, string, string, string][] = [
  ['customs', 'Customs', 'Customs clearance, import or export documents, duties, tariffs, and border inspections.', 'package'],
  ['shipping', 'Shipping', 'Freight, deliveries, shipment tracking, pickup arrangements, and transport logistics.', 'truck'],
  ['purchasing', 'Purchase orders', 'Purchase orders, order confirmations, stock availability, and procurement approvals.', 'shopping-bag'],
  ['vendors', 'Vendors', 'Supplier relationships, product quotes, vendor pricing, and supplier introductions.', 'users'],
  ['invoices', 'Invoices', 'Invoices, bills, payment requests, receipts, and billing questions.', 'receipt'],
];
export function initialState(legacy?: unknown, uuid: () => string = () => crypto.randomUUID()): StoredState {
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
    categories.push(...DEFAULTS.map(([id, title, description, icon], i) => ({ id, title, description, icon, color: COLORS[i]! })));
  }
  return { version: 2, installationId: uuid(), categories, daysBack: 30 };
}
export function publicState(state: StoredState, oauthConfigured: boolean): DockState {
  const run = state.run;
  return {
    version: 2, categories: state.categories, daysBack: state.daysBack,
    accountEmail: state.accountEmail, helperReady: Boolean(state.helperToken), oauthConfigured,
    uncategorizedLabelName: state.uncategorizedLabelName,
    error: state.error,
    ...(run ? { run: {
      id: run.id, status: run.status, phase: run.phase, daysBack: run.daysBack, total: run.total,
      processed: run.processed, succeeded: run.succeeded, failed: run.failed, skipped: run.skipped,
      startedAt: run.startedAt, updatedAt: run.updatedAt, error: run.error, retryAt: run.retryAt,
    } } : {}),
  };
}
export function recalculate(run: StoredRun): void {
  run.total = run.items.length;
  run.succeeded = run.items.filter((item) => item.status === 'succeeded').length;
  run.failed = run.items.filter((item) => item.status === 'failed').length;
  run.skipped = run.items.filter((item) => item.status === 'skipped').length;
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
