/** Synthetic UI-only fixture. Never included in the extension build. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Workspace, type DockApi } from '../src/ui/Workspace';
import type { DockRequest, DockState } from '../src/gmail/protocol';

const scenario = new URLSearchParams(location.search).get('scenario');
const state: DockState = { version: 2, categories: [{ id: 'home-repair', title: 'Home repair', description: 'Repairs, maintenance, plumbing and contractor appointments at home.', icon: 'tag', color: '#c9daf8', labelId: 'Label_fixture' }], daysBack: 30, accountEmail: scenario === 'disconnected' ? undefined : 'ui-fixture@example.test', helperReady: true, oauthConfigured: true };
const fixture = { state, starts: 0, resumes: 0, stops: 0, commands: [] as string[], requests: [] as DockRequest[], documentId: crypto.randomUUID(), releaseErrorRefresh: undefined as (() => void) | undefined };
if (scenario?.startsWith('errors-')) {
  const now = Date.now();
  const failures = [
    { id: '18cd123abc100001', error: 'Email body exceeds 60,000 characters. This email was left unchanged.' },
    { id: '18cd123abc100002', error: `Synthetic Gmail write failure. The saved classification remains available.\nDiagnostic: ${'unbroken-diagnostic-'.repeat(24)}end-of-diagnostic.` },
    { id: '18cd123abc100003', error: 'Synthetic helper failure. The email remains unchanged. Retry resumes unfinished emails.' },
    { id: '18cd123abc100004', error: 'Synthetic Gmail permission failure. Reconnect the account, then resume this run.' },
    { id: '18cd123abc100005', error: 'Synthetic Gmail message fetch failed: 404. No subject or sender is available.' },
  ];
  state.run = { id: 'saved-failed-run', status: 'failed', phase: 'categorizing', daysBack: 30, total: 561, processed: 561, succeeded: 556, failed: 5, skipped: 0, startedAt: now, updatedAt: now, accountEmail: state.accountEmail, failures, error: `5 email(s) failed. Completed labels are saved; retry resumes only unfinished emails. ${failures[0]!.error}` };
  if (scenario === 'errors-run-only') Object.assign(state.run, { total: 0, processed: 0, succeeded: 0, failed: 0, failures: [], error: 'Synthetic Gmail discovery failed before any email was selected. Reconnect Gmail, then resume.' });
  if (scenario === 'errors-state-error') state.error = 'Synthetic saved connection error remains visible beside the email error control.';
}
Object.assign(window, { fixture });
const api: DockApi = async request => {
  fixture.commands.push(request.command);
  fixture.requests.push(structuredClone(request));
  if (request.command === 'refreshRunErrors' && state.run) {
    if (scenario === 'errors-metadata-fails') return { ok: false, error: 'Synthetic metadata lookup failed. Existing email errors remain available.' };
    if (scenario === 'errors-legacy' && !state.run.failures?.[0]?.subject) await new Promise<void>(resolve => { fixture.releaseErrorRefresh = resolve; });
    state.run.failures?.slice(0, 4).forEach((failure, index) => {
      failure.subject = ['Quarterly invoice <north>', 'Repair appointment', 'Delivery update', 'Account notice'][index];
      failure.sender = ['Billing Desk <billing@example.test>', 'Repairs <repairs@example.test>', 'Deliveries <delivery@example.test>', 'Support <support@example.test>'][index];
    });
  }
  if (request.command === 'refreshLabels' && state.accountEmail) {
    if (scenario === 'refresh-fails') return { ok: false, error: 'Fixture Gmail access expired. Reconnect Gmail.' };
    if (scenario !== 'missing-label') state.categories[0]!.labelName = 'Dock/Household + repair [home-repair]';
    if (scenario !== 'missing-uncategorized') state.uncategorizedLabelName = 'Dock/Uncategorized';
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
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);
  return <main style={{ maxWidth: 1600, margin: '30px auto', fontFamily: 'Arial' }}><h1>Dock component test · synthetic data only</h1><div role="toolbar" aria-label="Mail toolbar" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 48 }}><div style={{ display: 'flex', gap: 8, flexShrink: 0 }}><button type="button" aria-label="Select messages">□</button><button type="button" aria-label="Refresh inbox">↻</button><button type="button" aria-label="More mail actions">⋮</button></div><div ref={setControls} style={{ flex: '1 1 auto', minWidth: 0 }} /><span style={{ flexShrink: 0 }}>1–50 of 731</span></div><div ref={setTabs} /><div id="fixture-native-mail">Gmail owns this message list.</div><div id="fixture-custom-view" ref={setView} hidden={!active} style={{ height: 420 }} /><Workspace api={api} mode="gmail" tabsTarget={tabs} controlsTarget={controls} viewTarget={view} onSelectionChange={setActive} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
