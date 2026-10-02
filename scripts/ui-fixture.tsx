/** Synthetic UI-only fixture. Never included in the extension build. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Workspace, type DockApi } from '../src/ui/Workspace';
import type { DockState, GmailMessageSummary } from '../src/gmail/protocol';
import type { LogEvent, LogPage, LogPersistence, LogRunSummary } from '../src/gmail/log-types';

const state: DockState = { version: 2, categories: [{ id: 'home-repair', title: 'Home repair', description: 'Repairs, maintenance, plumbing and contractor appointments at home.', icon: 'tag', color: '#c9daf8' }], daysBack: 30, accountEmail: 'ui-fixture@example.test', helperReady: true, oauthConfigured: true };
const logEvents: LogEvent[] = Array.from({ length: 120 }, (_, index) => {
  const seq = index + 1;
  return { seq, id: `fixture-event-${seq}`, at: Date.now() - (121 - seq) * 1000, runId: seq <= 5 ? 'fixture-previous' : 'fixture-run', scope: 'run', level: seq === 120 ? 'error' : seq === 119 ? 'warn' : 'info', stage: seq >= 119 ? 'quota' : seq % 2 ? 'read' : 'labels', event: seq === 120 ? 'gmail.request_failed' : seq === 119 ? 'gmail.cooldown' : 'gmail.request_finished', message: seq === 120 ? 'Gmail rate limit reached; completed labels are saved.' : seq === 119 ? 'Waiting before retrying Gmail.' : `Recorded fixture operation ${seq}.`, messageId: seq >= 119 ? 'message-a' : `message-${seq}`, requestId: `fixture-request-${seq}`, data: { estimatedQuotaUnits: 20, ...(seq === 120 ? { status: 403, reason: 'userRateLimitExceeded', retryAt: Date.now() + 60000 } : {}) } };
});
const logPersistence: LogPersistence = { browser: 'IndexedDB', mirror: 'pending', mirroredThrough: 118, latestSequence: 120, path: 'C:\\Dock-fixture\\.private\\run-logs\\events.jsonl', firstAvailableSequence: 1, retentionLimit: 100000 };
function logRuns(): LogRunSummary[] {
  return [{ id: 'fixture-run', startedAt: Date.now() - 120000, updatedAt: Date.now(), status: state.run?.status || 'completed', daysBack: 30, events: 115, gmailRequests: 43, estimatedQuotaUnits: 875, errors: 1, labeled: state.run?.succeeded || 0 }, { id: 'fixture-previous', startedAt: Date.now() - 86400000, updatedAt: Date.now() - 86300000, status: 'completed', daysBack: 7, events: 5, gmailRequests: 4, estimatedQuotaUnits: 50, errors: 0, labeled: 2 }];
}
function logPage(runId?: string, before?: number, limit = 100): LogPage {
  const matches = logEvents.filter(event => (!runId || event.runId === runId) && (before === undefined || event.seq < before)).sort((a, b) => b.seq - a.seq);
  const events = matches.slice(0, limit);
  return { runs: logRuns(), events: structuredClone(events), hasMore: matches.length > events.length, nextBefore: matches.length > events.length ? events.at(-1)?.seq : undefined, persistence: structuredClone(logPersistence) };
}

const fixture = { state, starts: 0, resumes: 0, stops: 0, listCalls: 0, failList: false, logEvents, logPersistence, logCalls: 0, exportCalls: 0, syncCalls: 0 };
Object.assign(window, { fixture });
const first: GmailMessageSummary = { id: 'message-a', threadId: 'thread-a', sender: 'Sample Plumber', subject: 'Sink repair appointment', snippet: 'Thursday at 10 works for the fixture.', receivedAt: 1780000000000, unread: true, gmailUrl: 'https://mail.google.com/mail/u/?authuser=ui-fixture%40example.test#all/thread-a' };
const second: GmailMessageSummary = { ...first, id: 'message-b', threadId: 'thread-b', subject: 'Fixture receipt', receivedAt: 1770000000000, gmailUrl: 'https://mail.google.com/mail/u/?authuser=ui-fixture%40example.test#all/thread-b' };
const api: DockApi = async request => {
  if (request.command === 'logs') {
    fixture.logCalls++;
    return { ok: true, logPage: logPage(request.runId, request.before, request.limit) };
  }
  if (request.command === 'syncLogs') {
    fixture.syncCalls++;
    logPersistence.mirror = 'saved'; logPersistence.mirroredThrough = logPersistence.latestSequence;
    delete logPersistence.error;
    return { ok: true, logPage: logPage() };
  }
  if (request.command === 'exportLogs') {
    fixture.exportCalls++;
    return { ok: true, logExport: { schemaVersion: 1, exportedAt: new Date().toISOString(), extensionVersion: 'fixture', runId: request.runId, runs: logRuns(), coverage: structuredClone(logPersistence), notes: ['Synthetic fixture only.'], events: logEvents.filter(event => !request.runId || event.runId === request.runId) } };
  }

  if (request.command === 'listMessages') {
    fixture.listCalls++;
    if (fixture.failList) return { ok: false, error: 'Fixture Gmail access expired. Reconnect Gmail.' };
    return { ok: true, messages: request.pageToken ? [first, second] : [first], nextPageToken: request.pageToken ? undefined : 'page-two' };
  }
  if (request.command === 'connect') return { ok: false, error: 'Fixture authorization denied. Retry with the listed Google test user.' };
  if (request.command === 'start') {
    fixture.starts++;
    state.run = { id: 'fixture-run', status: 'running', phase: 'categorizing', daysBack: request.daysBack, total: 2, processed: 0, succeeded: 0, failed: 0, skipped: 0, startedAt: Date.now(), updatedAt: Date.now() };
  }
  if (request.command === 'stop' && state.run) { fixture.stops++; state.run.status = 'paused'; }
  if (request.command === 'resume' && state.run) { fixture.resumes++; state.run.status = 'running'; }
  if (request.command === 'setDaysBack') state.daysBack = request.daysBack;
  return { ok: true, state: structuredClone(state) };
};
function Fixture() {
  const [tabs, setTabs] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);
  return <main style={{ maxWidth: 1000, margin: '30px auto', fontFamily: 'Arial' }}><h1>Dock component test · synthetic data only</h1><div ref={setTabs} /><div ref={setView} hidden={!active} style={{ height: 420 }} /><Workspace api={api} mode="gmail" tabsTarget={tabs} viewTarget={view} onSelectionChange={setActive} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
