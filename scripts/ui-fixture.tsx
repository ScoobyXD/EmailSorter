/** Synthetic UI-only fixture. Never included in the extension build. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Workspace, type DockApi } from '../src/ui/Workspace';
import type { DockState, GmailMessageSummary } from '../src/gmail/protocol';

const state: DockState = { version: 2, categories: [{ id: 'home-repair', title: 'Home repair', description: 'Repairs, maintenance, plumbing and contractor appointments at home.', icon: 'tag', color: '#c9daf8' }], daysBack: 30, accountEmail: 'ui-fixture@example.test', helperReady: true, oauthConfigured: true };
const fixture = { state, starts: 0, resumes: 0, stops: 0, listCalls: 0, failList: false };
Object.assign(window, { fixture });
const first: GmailMessageSummary = { id: 'message-a', threadId: 'thread-a', sender: 'Sample Plumber', subject: 'Sink repair appointment', snippet: 'Thursday at 10 works for the fixture.', receivedAt: 1780000000000, unread: true, gmailUrl: 'https://mail.google.com/mail/u/?authuser=ui-fixture%40example.test#all/thread-a' };
const second: GmailMessageSummary = { ...first, id: 'message-b', threadId: 'thread-b', subject: 'Fixture receipt', receivedAt: 1770000000000, gmailUrl: 'https://mail.google.com/mail/u/?authuser=ui-fixture%40example.test#all/thread-b' };
const api: DockApi = async request => {
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
