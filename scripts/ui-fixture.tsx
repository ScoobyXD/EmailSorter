/** Synthetic UI-only fixture. Never included in the extension build. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Workspace, type DockApi } from '../src/ui/Workspace';
import type { DockState } from '../src/gmail/protocol';

const scenario = new URLSearchParams(location.search).get('scenario');
const state: DockState = { version: 2, categories: [{ id: 'home-repair', title: 'Home repair', description: 'Repairs, maintenance, plumbing and contractor appointments at home.', icon: 'tag', color: '#c9daf8', labelId: 'Label_fixture' }], daysBack: 30, accountEmail: scenario === 'disconnected' ? undefined : 'ui-fixture@example.test', helperReady: true, oauthConfigured: true };
const fixture = { state, starts: 0, resumes: 0, stops: 0, commands: [] as string[], documentId: crypto.randomUUID() };
Object.assign(window, { fixture });
const api: DockApi = async request => {
  fixture.commands.push(request.command);
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
