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
  error?: string;
}
export type DockRequest = { type: 'dock:api' } & (
  | { command: 'state' | 'connect' | 'disconnect' | 'stop' | 'resume' | 'refreshLabels' }
  | { command: 'setDaysBack' | 'start'; daysBack: number }
  | { command: 'pairHelper'; token: string }
  | { command: 'importCategories'; json: string }
  | { command: 'saveCategory'; category: { id?: string; title: string; description: string; icon?: string } }
  | { command: 'deleteCategory'; categoryId: string }
);
export type DockResponse =
  | { ok: true; state?: DockState }
  | { ok: false; error: string };
export const UNCATEGORIZED = 'uncategorized';
export const HELPER_URL = 'http://127.0.0.1:38471';
export const STATE_KEY = 'dock-gmail-v2';
