import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';
import { chromium } from '@playwright/test';

const build = await rolldown({ input: 'src/gmail/journal.ts', platform: 'browser' });
const bundle = await build.generate({ format: 'iife', name: 'JournalFixture' });
await build.close();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const unexpected = [];
await context.route('**/*', async (route) => {
  if (route.request().isNavigationRequest() && route.request().url() === 'https://dock-journal.example.test/') await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated Dock journal fixture</title>' });
  else { unexpected.push(route.request().url()); await route.abort(); }
});
async function setup() {
  await page.goto('https://dock-journal.example.test/');
  await page.addScriptTag({ content: bundle.output[0].code });
  await page.evaluate(() => {
    window.assert = (condition, message) => { if (!condition) throw new Error(message); };
    window.draft = (event = 'gmail.request', runId = 'run-a', data = {}) => ({ at: 1790902800000, scope: runId ? 'run' : 'browse', level: 'info', stage: event.startsWith('run.') ? 'run' : 'read', event, message: 'Synthetic diagnostic event.', ...(runId ? { runId } : {}), data });
    window.fixture = (options = {}) => {
      const state = { now: 1790902800000, paired: options.paired ?? false, mode: options.mode || 'ok', calls: [], active: 0, peak: 0, gate: undefined };
      const databaseName = options.databaseName || `journal-${crypto.randomUUID()}`;
      const deps = {
        databaseName, extensionVersion: 'fixture-version', retentionLimit: options.retentionLimit,
        now: () => state.now,
        identity: async () => ({ installationId: 'fixture-installation', ...(state.paired ? { helperToken: 'x'.repeat(40) } : {}) }),
        fetch: async (url, init) => {
          window.assert(url === 'http://127.0.0.1:38471/logs/append', 'only the local fixture endpoint is allowed');
          window.assert(init.headers.Authorization === `Bearer ${'x'.repeat(40)}`, 'mirror uses the protected pairing credential');
          const payload = JSON.parse(init.body);
          state.calls.push({ payload, bytes: new TextEncoder().encode(init.body).length });
          state.active++; state.peak = Math.max(state.peak, state.active);
          try {
            if (state.gate) await state.gate;
            if (state.mode === 'offline') throw new TypeError('Failed to fetch');
            if (state.mode === 'old') return new Response('{}', { status: 404 });
            if (state.mode === 'partial') return Response.json({ ok: true, acceptedThrough: 0, path: 'fixture.jsonl' });
            return Response.json({ ok: true, acceptedThrough: payload.events.at(-1).seq, path: 'C:\\fixture\\dock-logs\\fixture-installation.jsonl' });
          } finally { state.active--; }
        },
      };
      return { state, deps, journal: new JournalFixture.GmailJournal(deps), restart: () => new JournalFixture.GmailJournal(deps) };
    };
  });
}
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('concurrent appends commit unique ordered events; cursor pages remain stable while new events arrive', async () => {
  await page.evaluate(async () => {
    const f = fixture();
    const saved = await Promise.all(Array.from({ length: 60 }, (_, i) => f.journal.append(draft('gmail.request', i % 2 ? 'run-a' : 'run-b', { estimatedQuotaUnits: 20 }))));
    assert(saved.every((event, index) => event.seq === index + 1), 'append sequence follows journal transaction order');
    assert(new Set(saved.map((event) => event.id)).size === 60, 'event IDs are unique');
    const first = await f.journal.page({ limit: 12 });
    assert(first.events.map((event) => event.seq).join(',') === Array.from({ length: 12 }, (_, i) => 60 - i).join(','), 'newest first');
    await f.journal.append(draft());
    const second = await f.journal.page({ before: first.nextBefore, limit: 12 });
    assert(second.events[0].seq === 48 && second.events.at(-1).seq === 37, 'exclusive sequence cursor does not shift on append');
    const filtered = await f.journal.page({ runId: 'run-b', limit: 200 });
    assert(filtered.events.length === 30 && filtered.events.every((event) => event.runId === 'run-b'), 'run index returns only the requested run');
    const before = filtered.persistence.latestSequence;
    await f.journal.page(); await f.journal.page();
    assert((await f.journal.page()).persistence.latestSequence === before, 'polling never creates new events');
  });
});

test('summary state and accounting track resumed legacy progress; complete export ignores visible page size', async () => {
  await page.evaluate(async () => {
    const f = fixture();
    await f.journal.append(draft('run.resumed', 'run-a', { daysBack: 36, startedAt: 1790000000000, succeeded: 95 }));
    await f.journal.append(draft('gmail.request', 'run-a', { estimatedQuotaUnits: 20 }));
    await f.journal.append(draft('gmail.request', 'run-a', { estimatedQuotaUnits: 5 }));
    await f.journal.append(draft('email.succeeded'));
    await f.journal.append({ ...draft('gmail.response'), level: 'error', data: { status: 403, reason: 'userRateLimitExceeded' } });
    await f.journal.append(draft('run.paused'));
    await f.journal.append(draft('gmail.request', null));
    const first = await f.journal.page({ runId: 'run-a', limit: 1 });
    assert(first.hasMore && first.events.length === 1, 'visible page is limited');
    const summary = first.runs.find((run) => run.id === 'run-a');
    assert(summary.labeled === 96 && summary.gmailRequests === 2 && summary.estimatedQuotaUnits === 25 && summary.errors === 1 && summary.status === 'paused' && summary.daysBack === 36, 'run counters and status reflect persisted events');
    const selected = await f.journal.export('run-a');
    assert(selected.events.length === 6 && selected.events.every((event, i) => i === 0 || event.seq > selected.events[i - 1].seq), 'whole selected run exports in ascending order');
    assert(selected.notes.some((note) => note.includes('no retained start event')), 'legacy history gap is explicit');
    const all = await f.journal.export();
    assert(all.events.length === 7 && all.extensionVersion === 'fixture-version', 'all-log export includes browsing events and version');
  });
});

test('retention keeps every unmirrored event and prunes only acknowledged history with explicit coverage', async () => {
  await page.evaluate(async () => {
    const f = fixture({ retentionLimit: 5 });
    for (let i = 0; i < 9; i++) await f.journal.append(draft());
    const pending = await f.journal.export();
    assert(pending.events.length === 9 && pending.coverage.firstAvailableSequence === 1, 'offline backlog remains complete beyond the browser retention target');
    f.state.paired = true;
    const synced = await f.journal.sync();
    assert(synced.mirroredThrough === 9 && f.state.calls[0].payload.events[0].seq === 1, 'every event reaches the durable helper before pruning');
    const result = await f.journal.export();
    assert(result.events.map((event) => event.seq).join(',') === '5,6,7,8,9', 'only the newest retained events remain');
    assert(result.coverage.firstAvailableSequence === 5 && result.coverage.retentionLimit === 5, 'retention boundary is visible');
    assert(result.notes.some((note) => note.includes('before 5')), 'export reports historical eviction');
    assert(result.runs[0].events === 9, 'summary totals survive event retention');
  });
});

test('invalid log API parameters are rejected and nested email bodies and credentials are excluded', async () => {
  await page.evaluate(async () => {
    const f = fixture();
    for (const input of [{ before: -1 }, { before: 1.5 }, { limit: 0 }, { limit: 201 }, { runId: '../private' }]) {
      let rejected = false; try { await f.journal.page(input); } catch { rejected = true; } assert(rejected, 'invalid pagination parameters must be rejected');
    }
    const event = await f.journal.append(draft('classification.finished', 'run-a', { categoryId: 'gardens', accountEmail: 'private@example.test', body: 'private body', helperToken: 'secret', nested: { authorization: 'Bearer secret', subject: 'private subject', sender: 'private sender', apiKey: 'secret', decodedBody: 'private body', count: 2 } }));
    const text = JSON.stringify(event);
    assert(!text.includes('private') && !text.includes('secret') && event.data.nested.count === 2, 'only operational metadata is retained');
    const before = (await f.journal.page()).persistence.latestSequence;
    let rejected = false; try { await f.journal.append(draft('gmail.request', 'run-a', { excess: Array.from({ length: 100 }, () => 'x'.repeat(4000)) })); } catch { rejected = true; }
    assert(rejected && (await f.journal.page()).persistence.latestSequence === before, 'oversized events fail without partial persistence');
  });
});

test('mirror batches stay bounded, only one fetch runs, and acknowledgement survives a new journal instance', async () => {
  await page.evaluate(async () => {
    const f = fixture();
    for (let i = 0; i < 62; i++) await f.journal.append(draft('gmail.request', 'run-a', { notes: ['x'.repeat(4000), 'x'.repeat(4000), 'x'.repeat(4000)] }));
    f.state.paired = true;
    const [one, two] = await Promise.all([f.journal.sync(), f.journal.sync()]);
    assert(one.mirror === 'saved' && two.mirroredThrough === 62, 'full backlog acknowledged');
    assert(f.state.peak === 1, 'sync actions share one fetch queue');
    assert(f.state.calls.every((call) => call.payload.events.length <= 25 && call.bytes < 256 * 1024), 'event count and byte caps hold');
    const seqs = f.state.calls.flatMap((call) => call.payload.events.map((event) => event.seq));
    assert(seqs.length === 62 && new Set(seqs).size === 62, 'one copy of each acknowledged event');
    const restarted = f.restart(); const count = f.state.calls.length;
    await restarted.sync(); assert(f.state.calls.length === count, 'restart does not resend acknowledged entries');
    await restarted.append(draft()); await restarted.sync();
    assert(f.state.calls.at(-1).payload.events.map((event) => event.seq).join(',') === '63', 'only the new tail is mirrored after restart');
  });
});

test('helper failures preserve local events and cursor, automatic retries are paced, forced sync recovers', async () => {
  await page.evaluate(async () => {
    const f = fixture({ paired: true, mode: 'offline' });
    await f.journal.append(draft());
    // Forced sync joins the in-flight automatic attempt or makes one fresh explicit attempt.
    await f.journal.sync();
    const count = f.state.calls.length;
    const failed = await f.journal.page();
    assert(failed.events.length === 1 && failed.persistence.mirror === 'unavailable' && failed.persistence.mirroredThrough === 0, 'local event remains durable after helper failure');
    for (let i = 0; i < 10; i++) { await f.journal.append(draft()); f.journal.kickMirror(); }
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(f.state.calls.length === count, 'rapid events and polls do not hammer an unavailable helper');
    f.state.mode = 'ok';
    const synced = await f.journal.sync();
    assert(synced.mirror === 'saved' && synced.mirroredThrough === 11 && !synced.error, 'manual sync recovers before retry cadence expires');
    assert(f.state.calls.at(-1).payload.events[0].seq === 1, 'failed batch cursor was never advanced');
  });
});

test('partial acknowledgements never advance the cursor; old helper responses explain how to recover', async () => {
  await page.evaluate(async () => {
    const f = fixture({ paired: true, mode: 'partial' });
    await f.journal.append(draft()); await f.journal.sync();
    assert((await f.journal.page()).persistence.mirroredThrough === 0, 'partial acknowledgement cannot discard local backlog');
    f.state.mode = 'old'; await f.journal.sync();
    const result = await f.journal.page();
    assert(result.persistence.error.includes('Restart the updated local helper') && result.events.length === 1, '404 has actionable helper upgrade guidance');
    f.state.mode = 'ok'; await f.journal.sync();
    assert((await f.journal.page()).persistence.mirror === 'saved', 'ack retry is safe');
  });
});

test('slow mirroring never blocks append, read, or local export', async () => {
  await page.evaluate(async () => {
    const f = fixture({ paired: true }); let release;
    f.state.gate = new Promise((resolve) => { release = resolve; });
    try {
      await f.journal.append(draft());
      for (let i = 0; i < 100 && f.state.active === 0; i++) await new Promise((resolve) => setTimeout(resolve, 2));
      assert(f.state.active === 1, 'mirror request is in flight');
      await f.journal.append(draft());
      assert((await f.journal.page()).events.length === 2 && (await f.journal.export()).events.length === 2, 'local work completes while mirror response is held');
    } finally { release(); }
    await f.journal.sync(); assert((await f.journal.page()).persistence.mirroredThrough === 2, 'append during a fetch is included in the following batch');
  });
});

test('a page reload preserves browser journal events and acknowledged helper cursor', async () => {
  const databaseName = await page.evaluate(async () => {
    const f = fixture({ paired: true });
    await f.journal.append(draft('run.started', 'restart-run', { daysBack: 30 }));
    await f.journal.append(draft('email.succeeded', 'restart-run'));
    await f.journal.sync();
    return f.deps.databaseName;
  });
  await setup();
  await page.evaluate(async (name) => {
    const f = fixture({ databaseName: name, paired: true });
    const saved = await f.journal.page();
    assert(saved.events.length === 2 && saved.runs[0].labeled === 1 && saved.persistence.mirroredThrough === 2, 'events, summary, and cursor survive the destroyed JS runtime');
    await f.journal.sync(); assert(f.state.calls.length === 0, 'no replay after runtime restart');
    const next = await f.journal.append(draft('run.completed', 'restart-run', { status: 'completed' }));
    assert(next.seq === 3, 'auto sequence is durable across runtime restart');
    await f.journal.sync();
  }, databaseName);
});

let failures = 0;
try {
  await setup();
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); }
  }
  assert.deepEqual(unexpected, [], 'no real network requests');
} finally { await context.close(); await browser.close(); }
console.log(`${tests.length - failures}/${tests.length} journal tests passed using isolated Chromium IndexedDB and fixture helper responses.`);
if (failures) process.exitCode = 1;
