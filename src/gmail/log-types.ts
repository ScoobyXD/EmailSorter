export type LogLevel = 'info' | 'warn' | 'error';
export type LogStage = 'run' | 'discovery' | 'read' | 'classification' | 'labels' | 'quota' | 'connection' | 'browse';
export type LogData = Record<string, unknown>;
export interface LogDraft {
  at: number;
  runId?: string;
  scope: 'run' | 'browse' | 'connection' | 'system';
  level: LogLevel;
  stage: LogStage;
  event: string;
  message: string;
  messageId?: string;
  requestId?: string;
  data?: LogData;
}
export interface LogEvent extends LogDraft { seq: number; id: string }
export interface LogRunSummary {
  id: string;
  startedAt: number;
  updatedAt: number;
  status: string;
  daysBack?: number;
  events: number;
  gmailRequests: number;
  estimatedQuotaUnits: number;
  errors: number;
  labeled: number;
}
export interface LogPersistence {
  browser: string;
  mirror: 'saved' | 'pending' | 'unavailable';
  mirroredThrough: number;
  latestSequence: number;
  path?: string;
  error?: string;
  firstAvailableSequence: number;
  retentionLimit: number;
}
export interface LogPage {
  runs: LogRunSummary[];
  events: LogEvent[];
  hasMore: boolean;
  nextBefore?: number;
  persistence: LogPersistence;
}
export interface LogExport {
  schemaVersion: 1;
  exportedAt: string;
  extensionVersion: string;
  runId?: string;
  runs: LogRunSummary[];
  coverage: LogPersistence;
  notes: string[];
  events: LogEvent[];
}
