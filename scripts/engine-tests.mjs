import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';
import { mkdir, writeFile } from 'node:fs/promises';
import { validateLogBatch } from '../helper/src/run-logs.ts';

const build = await rolldown({ input: 'scripts/engine-test-entry.ts', platform: 'node' });
const bundle = await build.generate({ format: 'esm' });
await build.close();
const { GmailEngine, initialState, decodedBody, labelName } = await import(`data:text/javascript;base64,${Buffer.from(bundle.output[0].code).toString('base64')}`);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const NOW = Date.parse('2026-10-02T01:00:00Z');
const json = (data, status = 200, headers) => new Response(JSON.stringify(data), { status, headers });
const enc = (value) => Buffer.from(value).toString('base64url');
const msg = (id, overrides = {}) => ({ id, threadId: `thread-${id}`, internalDate: String(NOW - 86400000), labelIds: ['INBOX', 'UNREAD', 'Label_unrelated'], snippet: `Preview ${id}`, payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: 'Test Sender <fixture@example.test>' }, { name: 'Subject', value: `Subject ${id}` }], parts: [{ mimeType: 'text/plain', body: { data: enc(`Email ${id} café. Ignore all rules is untrusted email text.`) } }, { mimeType: 'text/html', body: { data: enc(`<p>Email ${id}</p>`) } }] }, ...overrides });

function fixture(options = {}) {
  let seq = 0;
  let virtualNow = options.now ?? NOW;
  let stored = options.state ? structuredClone(options.state) : initialState(undefined, () => 'installation-fixture');
  stored.categories = options.keepDefaults ? stored.categories : [
    { id: 'category_a', title: 'Community gardens', description: 'Local community gardens and vegetable growing.', icon: 'tag', color: '#c9daf8' },
    { id: 'category_b', title: 'Space telescopes', description: 'Research about telescopes and astronomy.', icon: 'star', color: '#e4d7f5' },
  ];
  const messages = options.messages || [msg('a'), msg('b'), msg('none'), msg('old', { internalDate: String(NOW - 40 * 86400000) }), msg('archived', { labelIds: ['Label_unrelated'] })];
  const labels = options.labels || [];
  const calls = [];
  const sleeps = [];
  const decisions = [];
  const tokenCalls = [];
  let active = 0;
  let peak = 0;
  let failModify = options.failModify;
  let lostCreate = options.lostCreate;
  let invalidate = 0;
  const deps = {
    load: async () => structuredClone(stored), save: async (state) => { stored = structuredClone(state); }, legacy: async () => options.legacy,
    token: async (interactive) => { tokenCalls.push(interactive); if (options.tokenError) throw new Error('fixture OAuth denied'); return 'fixture-access-token'; },
    invalidateToken: async () => { invalidate++; }, disconnect: async () => {}, oauthConfigured: options.oauthConfigured ?? true,
    now: () => virtualNow,
    sleep: async (ms) => {
      assert.ok(Number.isFinite(ms) && ms > 0, 'waits must have a positive finite duration');
      const sleep = { at: virtualNow, ms };
      sleeps.push(sleep);
      if (options.sleep) await options.sleep(sleep);
      virtualNow += ms;
    },
    uuid: () => `fixture-id-${++seq}`,
    fetch: async (input, init = {}) => {
      const url = new URL(input);
      const payload = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url: url.href, method: init.method || 'GET', payload, at: virtualNow });
      if (url.origin === 'http://127.0.0.1:38471') {
        assert.equal(init.method, 'POST', 'health also POST to retain extension Origin');
        assert.match(init.headers.Authorization, /^Bearer [x]{40}$/);
        if (url.pathname === '/health') return json({ ok: true, service: 'dock-jev-helper' });
        assert.equal(url.pathname, '/classify');
        active++; peak = Math.max(peak, active);
        try {
          decisions.push(payload);
          if (options.classify) await options.classify(payload);
          const id = payload.message.subject.slice('Subject '.length);
          const categoryId = id === 'none' ? null : id === 'b' ? 'category_b' : 'category_a';
          return json({ categoryId, model: 'jev-fixture', answer: { type: 'choice', choice: categoryId || '__uncategorized__', confidence: 0.82, probabilities: { category_a: categoryId === 'category_a' ? 0.82 : 0.09, category_b: categoryId === 'category_b' ? 0.82 : 0.09, __uncategorized__: categoryId === null ? 0.82 : 0.09 } }, usage: { input_tokens: 100, output_tokens: 0 } });
        } finally { active--; }
      }
      assert.equal(url.origin, 'https://gmail.googleapis.com', 'network allowlist');
      assert.equal(init.headers.Authorization, 'Bearer fixture-access-token');
      const path = url.pathname.replace('/gmail/v1/users/me/', '');
      if (options.intercept) { const response = await options.intercept({ path, url, init, payload, now: virtualNow, calls }); if (response) return response; }
      if (path === 'profile') return json({ emailAddress: options.email || 'intended@example.test' });
      if (path === 'labels' && init.method === 'POST') {
        assert.equal(payload.messageListVisibility, 'show'); assert.equal(payload.labelListVisibility, 'labelShow');
        assert.match(payload.color.backgroundColor, /^#[0-9a-f]{6}$/);
        const label = { id: `Label_dock_${labels.length}`, type: 'user', ...payload }; labels.push(label);
        if (lostCreate) { lostCreate = false; throw new Error('fixture response lost after successful create'); }
        return json(label);
      }
      if (path === 'labels') return json({ labels });
      if (path.startsWith('labels/')) {
        const id = decodeURIComponent(path.slice(7));
        const label = labels.find((item) => item.id === id);
        if (init.method === 'DELETE') {
          labels.splice(labels.findIndex((item) => item.id === id), 1);
          for (const message of messages) message.labelIds = message.labelIds.filter((value) => value !== id);
          return new Response(null, { status: 204 });
        }
        assert.equal(init.method, 'PATCH'); assert.ok(label); Object.assign(label, payload); return json(label);
      }
      if (path === 'messages') {
        if (url.searchParams.get('q')) {
          assert.equal(url.searchParams.get('labelIds'), 'INBOX');
          assert.match(url.searchParams.get('q'), /^after:\d+ before:\d+$/);
          const second = url.searchParams.get('pageToken') === 'page-2';
          return json({ messages: (second ? messages.slice(2) : messages.slice(0, 3)).map(({ id }) => ({ id })), ...(second || messages.length <= 3 ? {} : { nextPageToken: 'page-2' }) });
        }
        const labelId = url.searchParams.get('labelIds');
        return json({ messages: messages.filter((message) => message.labelIds.includes(labelId)).map(({ id }) => ({ id })) });
      }
      if (path.includes('/attachments/')) return json({ data: enc('Externalized text body from Gmail') });
      const id = path.split('/')[1];
      const message = messages.find((item) => item.id === id);
      if (!message) return json({}, 404);
      if (path.endsWith('/modify')) {
        if (failModify === id) return json({}, 503);
        assert.equal(init.method, 'POST');
        assert.ok(!payload.removeLabelIds.some((id) => ['INBOX', 'UNREAD', 'Label_unrelated'].includes(id)), 'never remove unrelated/system labels');
        message.labelIds = [...new Set([...message.labelIds.filter((id) => !payload.removeLabelIds.includes(id)), ...payload.addLabelIds])];
        return json(message);
      }
      return json(message);
    },
  };
  const engine = new GmailEngine(deps);
  return { engine, deps, messages, labels, calls, sleeps, decisions, tokenCalls, now: () => virtualNow, advance: (ms) => { virtualNow += ms; }, state: () => structuredClone(stored), replace: (state) => { stored = structuredClone(state); }, allowModify: () => { failModify = undefined; }, peak: () => peak, invalidated: () => invalidate };
}
const command = (engine, request) => engine.handle({ type: 'dock:api', ...request });
async function connect(f) {
  assert.equal((await command(f.engine, { command: 'connect' })).ok, true);
  assert.equal((await command(f.engine, { command: 'pairHelper', token: 'x'.repeat(40) })).ok, true);
}

test('opening state, connecting and pairing never process mail; scope is explicit', async () => {
  const f = fixture();
  const state = await command(f.engine, { command: 'state' });
  assert.equal(state.state.daysBack, 30); assert.equal(f.calls.length, 0);
  await connect(f);
  assert.equal(f.decisions.length, 0); assert.equal(f.labels.length, 0);
  assert.ok(!f.calls.some((call) => call.url.includes('/messages')));
  assert.deepEqual(f.tokenCalls.filter(Boolean), [true]);
  assert.equal(JSON.stringify((await command(f.engine, { command: 'state' })).state).includes('xxxxxxxx'), false, 'never expose pairing secret');
});

test('paged manual run categorizes current arbitrary categories, no-match; preserves mail and visible colors', async () => {
  const f = fixture({ lostCreate: true }); await connect(f);
  assert.equal((await command(f.engine, { command: 'start', daysBack: 30 })).ok, true);
  await f.engine.whenIdle();
  const state = f.state();
  assert.equal(state.run.status, 'completed'); assert.equal(state.run.total, 5); assert.equal(state.run.succeeded, 3); assert.equal(state.run.skipped, 2);
  assert.equal(f.decisions.length, 3); assert.ok(f.peak() <= 3);
  assert.equal(f.labels.length, 3, 'lost create response does not create duplicates');
  for (const label of f.labels) { assert.equal(label.messageListVisibility, 'show'); assert.equal(label.labelListVisibility, 'labelShow'); assert.ok(label.color.backgroundColor); assert.ok(label.name.length < 65); }
  for (const message of f.messages.slice(0, 3)) { assert.ok(message.labelIds.includes('INBOX')); assert.ok(message.labelIds.includes('UNREAD')); assert.ok(message.labelIds.includes('Label_unrelated')); assert.equal(message.labelIds.filter((id) => id.startsWith('Label_dock_')).length, 1); }
  assert.ok(f.messages[2].labelIds.includes(state.uncategorizedLabelId));
  assert.match(f.decisions[0].message.body, /café/);
  assert.deepEqual(f.decisions[0].categories.map((category) => category.id), ['category_a', 'category_b']);
  assert.equal(state.recentDecisions[0].decision.answer.confidence, 0.82); assert.equal(state.recentDecisions[0].decision.usage.output_tokens, 0);
  const listed = await command(f.engine, { command: 'listMessages', categoryId: 'category_a' });
  assert.equal(listed.messages.length, 1); assert.ok(listed.messages[0].gmailUrl.includes('authuser=intended%40example.test')); assert.ok(listed.messages[0].gmailUrl.endsWith('#all/thread-a'));
});

test('failed Gmail apply saves full choice; manual retry reuses it and skips completed work', async () => {
  const f = fixture({ messages: [msg('a'), msg('b')], failModify: 'b' }); await connect(f);
  await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  assert.equal(f.state().run.status, 'failed'); assert.equal(f.state().run.succeeded, 1);
  assert.equal(f.state().run.items.find((item) => item.id === 'b').decision.answer.choice, 'category_b');
  f.allowModify(); await command(f.engine, { command: 'resume' }); await f.engine.whenIdle();
  assert.equal(f.state().run.status, 'completed'); assert.equal(f.state().run.succeeded, 2); assert.equal(f.decisions.length, 2, 'retry does not bill/classify already decided emails again');
});

test('Stop prevents labels after in-flight decision and explicit resume reuses checkpoint', async () => {
  let release; let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const ready = new Promise((resolve) => { entered = resolve; });
  const f = fixture({ messages: [msg('a')], classify: async () => { entered(); await gate; } }); await connect(f);
  await command(f.engine, { command: 'start', daysBack: 30 }); await ready;
  await command(f.engine, { command: 'stop' }); release(); await f.engine.whenIdle();
  assert.equal(f.state().run.status, 'paused'); assert.equal(f.calls.filter((call) => call.url.endsWith('/modify')).length, 0);
  assert.equal(f.state().run.items[0].decision.categoryId, 'category_a');
  await command(f.engine, { command: 'resume' }); await f.engine.whenIdle();
  assert.equal(f.state().run.status, 'completed'); assert.equal(f.decisions.length, 1);
});

test('worker restart pauses persisted run; reading state never resumes it', async () => {
  const f = fixture({ messages: [msg('a')] }); await connect(f);
  await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  const saved = f.state(); saved.run.status = 'running'; saved.run.items[0].status = 'pending'; saved.run.owner = 'gone-worker'; f.replace(saved);
  const restarted = new GmailEngine(f.deps);
  const before = f.calls.length;
  assert.equal((await command(restarted, { command: 'state' })).state.run.status, 'paused');
  assert.equal(f.calls.length, before);
  assert.equal((await command(restarted, { command: 'resume' })).ok, true); await restarted.whenIdle();
  assert.equal(f.state().run.status, 'completed');
  assert.equal(f.labels.length, 3, 'restart does not duplicate native labels');
});

test('category deletion removes only its owned label/memberships; messages remain', async () => {
  const f = fixture({ messages: [msg('a')] }); await connect(f);
  await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  assert.equal((await command(f.engine, { command: 'deleteCategory', categoryId: 'category_a' })).ok, true);
  assert.equal(f.messages.length, 1); assert.deepEqual(f.messages[0].labelIds, ['INBOX', 'UNREAD', 'Label_unrelated']);
  assert.equal(f.state().categories.length, 1);
  assert.equal(f.calls.filter((call) => call.method === 'DELETE').length, 1); assert.ok(f.calls.find((call) => call.method === 'DELETE').url.includes('/labels/'));
});

test('legacy migration excludes urgency, keeps IDs, requires descriptions, ignores mail samples', async () => {
  const migrated = initialState({ version: 1, categories: [{ id: 'old-custom', name: 'Old category', color: 'rose' }, { id: 'urgent', name: 'Urgent', color: 'rose' }], messages: [msg('private-sample')] }, () => 'install');
  assert.equal(migrated.categories.length, 1); assert.equal(migrated.categories[0].id, 'old-custom'); assert.equal(migrated.categories[0].description, ''); assert.equal(migrated.messages, undefined);
  const f = fixture({ state: migrated, keepDefaults: true }); await connect(f);
  const result = await command(f.engine, { command: 'start', daysBack: 30 }); assert.equal(result.ok, false); assert.match(result.error, /Add descriptions/);
  assert.equal(f.decisions.length, 0);
});

test('external import strips credentials and ownership; validated definitions are merged', async () => {
  const f = fixture();
  const result = await command(f.engine, { command: 'importCategories', json: JSON.stringify({ version: 2, accountEmail: 'attacker@example.test', helperToken: 'secret', categories: [{ id: 'new_category', title: 'Bicycles', description: 'Bicycle rides and repairs.', icon: 'tag', color: '#c9daf8', labelId: 'INBOX' }] }) });
  assert.equal(result.ok, true); const saved = f.state(); assert.equal(saved.categories.at(-1).labelId, undefined); assert.equal(saved.helperToken, undefined); assert.equal(saved.accountEmail, undefined);
  assert.equal((await command(f.engine, { command: 'importCategories', json: JSON.stringify({ version: 2, categories: [{ id: '__proto__', title: 'Bad', description: 'Invalid' }] }) })).ok, false);
});

test('OAuth failures are surfaced; 401 cache retry is bounded and no labels applied', async () => {
  const denied = fixture({ tokenError: true });
  assert.equal((await command(denied.engine, { command: 'connect' })).ok, false); assert.equal(denied.decisions.length, 0);
  const expired = fixture({ intercept: async ({ path }) => path === 'profile' ? json({}, 401) : undefined });
  const result = await command(expired.engine, { command: 'connect' });
  assert.equal(result.ok, false); assert.match(result.error, /Reconnect Gmail/); assert.equal(expired.invalidated(), 1); assert.equal(expired.labels.length, 0);
});

test('MIME decoding favors plain, supports externalized text, excludes file attachments, strips HTML', async () => {
  const body = await decodedBody({ mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/plain', body: { attachmentId: 'text-body' } }, { mimeType: 'text/plain', filename: 'secret.txt', body: { data: enc('must not read attached file') } }, { mimeType: 'text/html', body: { data: enc('<style>bad</style><p>A &amp; B</p><script>bad()</script>') } }] }, async () => enc('External café'));
  assert.match(body, /External café/); assert.match(body, /A & B/); assert.ok(!body.includes('secret')); assert.ok(!body.includes('bad'));
  const stable = initialState(undefined, () => 'installation'); assert.equal(labelName(stable, stable.categories[0]), labelName(structuredClone(stable), stable.categories[0]));
});

test('a changed OAuth account token during classification never reads or mutates that other mailbox', async () => {
  let switched = false;
  const f = fixture({ messages: [msg('a')], classify: async () => { switched = true; } }); await connect(f);
  const baseFetch = f.deps.fetch;
  const baseToken = f.deps.token;
  f.deps.token = async (interactive) => switched ? 'fixture-other-account-token' : await baseToken(interactive);
  let otherAccountChecks = 0;
  f.deps.fetch = async (input, init) => {
    if (init.headers.Authorization === 'Bearer fixture-other-account-token') {
      assert.ok(String(input).endsWith('/profile'), 'different-account token must never reach messages or labels');
      otherAccountChecks++; return json({ emailAddress: 'different@example.test' });
    }
    return await baseFetch(input, init);
  };
  await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  assert.equal(f.state().run.status, 'failed'); assert.match(f.state().run.error, /different account/); assert.equal(otherAccountChecks, 1); assert.equal(f.invalidated(), 1);
  assert.equal(f.calls.filter((call) => call.url.endsWith('/modify')).length, 0);
  assert.deepEqual(f.messages[0].labelIds, ['INBOX', 'UNREAD', 'Label_unrelated']);
});

test('Reconnect is rejected before interactive OAuth while a run is active', async () => {
  let release; let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const ready = new Promise((resolve) => { entered = resolve; });
  const f = fixture({ messages: [msg('a')], classify: async () => { entered(); await gate; } }); await connect(f);
  await command(f.engine, { command: 'start', daysBack: 30 }); await ready;
  const result = await command(f.engine, { command: 'connect' }); assert.equal(result.ok, false); assert.match(result.error, /Stop/);
  assert.equal(f.tokenCalls.filter(Boolean).length, 1, 'no second interactive auth');
  await command(f.engine, { command: 'stop' }); release(); await f.engine.whenIdle();
});

test('network outage retries bounded current batch then pauses; remaining messages stay pending', async () => {
  const f = fixture({ messages: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => msg(id)), intercept: async ({ path }) => {
    if (/^messages\/[^/]+$/.test(path)) throw new Error('fixture offline');
  } }); await connect(f);
  await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  const run = f.state().run;
  assert.equal(run.status, 'failed'); assert.match(run.error, /could not be reached/);
  assert.equal(run.failed, 3); assert.equal(run.items.filter((item) => item.status === 'pending').length, 4);
  assert.equal(f.calls.filter((call) => /\/messages\/[^/?]+\?format=full/.test(call.url)).length, 12, 'four attempts per active message, no more');
  assert.equal(f.decisions.length, 0);
});

test('plain alternative avoids fetching and rejecting a huge unused HTML alternative', async () => {
  let fetched = 0;
  const body = await decodedBody({ mimeType: 'multipart/alternative', parts: [
    { mimeType: 'text/html', body: { attachmentId: 'huge-html', size: 1000000 } },
    { mimeType: 'text/plain', body: { data: enc('Small complete text alternative') } },
  ] }, async () => { fetched++; throw new Error('must not fetch unused HTML'); });
  assert.equal(body, 'Small complete text alternative'); assert.equal(fetched, 0);
});

test('retry after category edits uses current descriptions only for unfinished emails', async () => {
  const f = fixture({ messages: [msg('a'), msg('b')], failModify: 'b' }); await connect(f);
  await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  const description = 'Updated description: space telescope calibration and optical research.';
  const saved = await command(f.engine, { command: 'saveCategory', category: { id: 'category_b', title: 'Space telescopes', description, icon: 'star' } }); assert.equal(saved.ok, true);
  f.allowModify(); await command(f.engine, { command: 'resume' }); await f.engine.whenIdle();
  assert.equal(f.state().run.status, 'completed'); assert.equal(f.decisions.length, 3);
  assert.equal(f.decisions.at(-1).categories.find((category) => category.id === 'category_b').description, description);
  assert.equal(f.decisions.filter((decision) => decision.message.subject === 'Subject a').length, 1);
});

const gmailFailure = (reason, message, status = 403, headers) => json({ error: { code: status, message, errors: [{ reason, message }] } }, status, headers);
const gmailCalls = (f) => f.calls.filter((call) => call.url.startsWith('https://gmail.googleapis.com/'));
const modifications = (f) => f.calls.filter((call) => call.url.endsWith('/modify'));

// Assert the observed request budget independently of the engine's stored limiter state.
function assertQuotaWindows(f) {
  const calls = gmailCalls(f).map((call) => {
    const path = new URL(call.url).pathname.replace('/gmail/v1/users/me/', '');
    const units = path === 'profile' || (path === 'labels' && call.method === 'GET') ? 1
      : /^messages\/[^/]+(?:\/attachments\/[^/]+)?$/.test(path) && call.method === 'GET' ? 20 : 5;
    return { ...call, units };
  });
  let first = 0; let units = 0;
  for (let last = 0; last < calls.length; last++) {
    units += calls[last].units;
    while (calls[first].at <= calls[last].at - 60000) units -= calls[first++].units;
    assert.ok(units <= 5000, `${units} Gmail units in the 60s window ending at ${new Date(calls[last].at).toISOString()} (${calls[last].url})`);
  }
}

test('transient Gmail 403 quota exhaustion waits for recovery instead of failing after 2.8 seconds', async () => {
  const attempts = [];
  const f = fixture({ messages: [msg('a')], intercept: async ({ path, now }) => {
    if (path !== 'messages/a') return;
    attempts.push(now);
    if (now < NOW + 30000) return gmailFailure('userRateLimitExceeded', 'User-rate limit exceeded.');
  } });
  await connect(f); await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  assert.equal(f.state().run.status, 'completed'); assert.equal(f.state().run.succeeded, 1);
  assert.equal(attempts.length, 2); assert.ok(attempts[1] - attempts[0] >= 60000);
  assert.equal(f.decisions.length, 1); assert.equal(modifications(f).length, 1);
});

test('permanent Gmail 403 is not retried and preserves the Google error detail', async () => {
  const f = fixture({ messages: [msg('a')], intercept: async ({ path }) => {
    if (path.endsWith('/modify')) return gmailFailure('insufficientPermissions', 'Insufficient Permission for this operation.');
  } });
  await connect(f); await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  assert.equal(f.state().run.status, 'failed'); assert.equal(modifications(f).length, 1);
  assert.match(f.state().run.error, /insufficientPermissions/); assert.match(f.state().run.error, /Insufficient Permission/);
  assert.equal(f.state().run.succeeded, 0); assert.deepEqual(f.messages[0].labelIds, ['INBOX', 'UNREAD', 'Label_unrelated']);
});

test('Gmail Retry-After seconds and HTTP dates are honored beyond one minute', async () => {
  for (const retryAfter of ['125', new Date(NOW + 90000).toUTCString()]) {
    const attempts = [];
    const f = fixture({ messages: [msg('a')], intercept: async ({ path, now }) => {
      if (!path.endsWith('/modify')) return;
      attempts.push(now);
      if (attempts.length === 1) return gmailFailure('rateLimitExceeded', 'Try again later.', 429, { 'Retry-After': retryAfter });
    } });
    await connect(f); await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
    assert.equal(f.state().run.status, 'completed', retryAfter);
    const requiredRetryAt = retryAfter === '125' ? attempts[0] + 125000 : NOW + 90000;
    assert.equal(attempts.length, 2); assert.ok(attempts[1] >= requiredRetryAt, `${retryAfter} must not be capped to 10 seconds`);
    assert.equal(f.decisions.length, 1, 'retry applies the saved choice without another classification');
  }
});

test('repeated quota errors stop after six retries with an actionable Google reason', async () => {
  let attempts = 0;
  const f = fixture({ messages: [msg('a')], intercept: async ({ path }) => {
    if (path === 'messages/a') { attempts++; return gmailFailure('userRateLimitExceeded', 'User-rate limit is still exhausted.'); }
  } });
  await connect(f); await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  assert.equal(attempts, 7, 'initial attempt plus six quota retries');
  assert.equal(f.state().run.status, 'failed'); assert.match(f.state().run.error, /userRateLimitExceeded/);
  assert.match(f.state().run.error, /User-rate limit is still exhausted/); assert.equal(f.decisions.length, 0);
});

test('a 429 cooldown also holds other workers before they mutate Gmail', async () => {
  let releasePeers;
  const peersGate = new Promise((resolve) => { releasePeers = resolve; });
  let releaseObservation;
  const observationGate = new Promise((resolve) => { releaseObservation = resolve; });
  let failed = false; let observedCooldown = false;
  const f = fixture({ messages: [msg('a'), msg('b'), msg('c')],
    classify: async ({ message }) => { if (message.subject !== 'Subject a') await peersGate; },
    intercept: async ({ path }) => {
      if (path === 'messages/a/modify' && !failed) { failed = true; return gmailFailure('rateLimitExceeded', 'Shared Gmail limit.', 429); }
    },
    sleep: async () => {
      if (!failed) return;
      if (observedCooldown) { await observationGate; return; }
      observedCooldown = true;
      const before = gmailCalls(f).length;
      releasePeers();
      // Let peers finish their classifier calls while the first worker is still waiting.
      await new Promise((resolve) => setImmediate(resolve));
      try { assert.equal(gmailCalls(f).length, before, 'other workers must join the shared cooldown'); }
      finally { releaseObservation(); }
    },
  });
  await connect(f); await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  assert.equal(observedCooldown, true); assert.equal(f.state().run.status, 'completed'); assert.equal(f.state().run.succeeded, 3);
  const applied = modifications(f);
  assert.ok(applied.slice(1).every((call) => call.at >= applied[0].at + 60000), 'all workers honor the same Gmail cooldown');
});

test('250-message run and category reads share the 5000-unit budget, including externalized bodies', async () => {
  const messages = Array.from({ length: 250 }, (_, i) => {
    const message = msg(`bulk-${i}`);
    if (i % 10 === 0) message.payload = { ...message.payload, mimeType: 'text/plain', parts: undefined, body: { attachmentId: `body-${i}` } };
    return message;
  });
  const f = fixture({ messages });
  await connect(f); await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  assert.equal(f.state().run.status, 'completed'); assert.equal(f.state().run.succeeded, 250);
  const listed = await command(f.engine, { command: 'listMessages', categoryId: 'category_a' });
  assert.equal(listed.ok, true); assert.equal(listed.messages.length, 250);
  assert.equal(f.calls.filter((call) => call.url.includes('/attachments/')).length, 25);
  assert.equal(f.calls.filter((call) => call.url.includes('format=metadata')).length, 250);
  assert.equal(modifications(f).length, 250); assert.equal(f.decisions.length, 250);
  assert.ok(f.now() - NOW >= 120000, 'this workload exceeds two full minute budgets');
  assertQuotaWindows(f);
});

test('worker restart retains already-spent Gmail quota for subsequent category reads', async () => {
  const f = fixture({ messages: Array.from({ length: 100 }, (_, i) => msg(`restart-${i}`)) });
  await connect(f); await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  assert.equal((await command(f.engine, { command: 'listMessages', categoryId: 'category_a' })).ok, true);
  const previousRequestAt = gmailCalls(f).at(-1).at;
  const beforeRestart = gmailCalls(f).length;
  const restarted = new GmailEngine(f.deps);
  const listed = await command(restarted, { command: 'listMessages', categoryId: 'category_a' });
  assert.equal(listed.ok, true); assert.equal(listed.messages.length, 100);
  assert.ok(gmailCalls(f)[beforeRestart].at > previousRequestAt, 'restart cannot discard the outstanding request pacing delay');
  assertQuotaWindows(f);
});

test('Stop during cooldown pauses without another mutation; restart and resume retain the cooldown and choice', async () => {
  let entered; let release;
  const ready = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  let resumeEntered; let releaseResume;
  const resumeReady = new Promise((resolve) => { resumeEntered = resolve; });
  const resumeGate = new Promise((resolve) => { releaseResume = resolve; });
  let holdResumeWait = false;
  let firstWait = true; let rejected = false;
  const f = fixture({ messages: [msg('a')], intercept: async ({ path, calls }) => {
    if (path.endsWith('/modify') && calls.filter((call) => call.url.endsWith('/modify')).length === 1) { rejected = true; return gmailFailure('userRateLimitExceeded', 'Temporarily out of Gmail quota.'); }
  }, sleep: async () => {
    if (rejected && firstWait) { firstWait = false; entered(); await gate; }
    else if (holdResumeWait) { holdResumeWait = false; resumeEntered(); await resumeGate; }
  } });
  await connect(f); await command(f.engine, { command: 'start', daysBack: 30 }); await ready;
  const waiting = await command(f.engine, { command: 'state' });
  assert.equal(waiting.state.run.status, 'running'); assert.ok(waiting.state.run.retryAt >= NOW + 60000);
  const retryAt = waiting.state.run.retryAt;
  await command(f.engine, { command: 'stop' }); release(); await f.engine.whenIdle();
  assert.equal(f.state().run.status, 'paused'); assert.equal(modifications(f).length, 1);
  assert.equal(f.state().run.succeeded, 0); assert.equal(f.decisions.length, 1);
  const restarted = new GmailEngine(f.deps);
  const before = f.calls.length;
  assert.equal((await command(restarted, { command: 'state' })).state.run.status, 'paused'); assert.equal(f.calls.length, before);
  holdResumeWait = true;
  let resumeResult;
  const resuming = command(restarted, { command: 'resume' }).then((result) => { resumeResult = result; return result; });
  await resumeReady;
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(resumeResult?.ok, true, 'Resume dispatch returns while the cooldown is still waiting');
    assert.equal(resumeResult.state.run.status, 'running', 'Resume immediately publishes an active run with Stop available');
    assert.equal((await command(restarted, { command: 'state' })).state.run.status, 'running');
  } finally { releaseResume(); }
  await resuming; await restarted.whenIdle();
  assert.equal(f.state().run.status, 'completed'); assert.equal(f.state().run.succeeded, 1);
  assert.equal(modifications(f).length, 2); assert.ok(modifications(f)[1].at >= retryAt);
  assert.equal(f.decisions.length, 1, 'resuming applies the saved classification');
});

test('a category-preview cooldown does not prevent a simultaneous run from stopping', async () => {
  let previewRejected = false; let holdingPreview = false;
  let previewEntered; let releasePreview; let releaseRunTick;
  const previewReady = new Promise((resolve) => { previewEntered = resolve; });
  const previewGate = new Promise((resolve) => { releasePreview = resolve; });
  const runTickGate = new Promise((resolve) => { releaseRunTick = resolve; });
  const f = fixture({ messages: [msg('a')], intercept: async ({ path, url }) => {
    if (path === 'messages' && !url.searchParams.has('q') && !previewRejected) {
      previewRejected = true; return gmailFailure('rateLimitExceeded', 'Preview is rate limited.', 429);
    }
  }, sleep: async () => {
    if (!previewRejected) return;
    if (!holdingPreview) { holdingPreview = true; previewEntered(); await previewGate; }
    else await runTickGate;
  } });
  await connect(f); await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  const preview = command(f.engine, { command: 'listMessages', categoryId: 'category_a' });
  await previewReady;
  try {
    const before = modifications(f).length;
    const started = await command(f.engine, { command: 'start', daysBack: 30 });
    assert.equal(started.ok, true); assert.equal(started.state.run.status, 'running');
    await command(f.engine, { command: 'stop' });
    releaseRunTick();
    let idle = false;
    const stopped = f.engine.whenIdle().then(() => { idle = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(idle, true, 'the run must settle while the unrelated category preview is still waiting');
    await stopped;
    assert.equal(f.state().run.status, 'paused'); assert.equal(modifications(f).length, before);
  } finally { releaseRunTick(); releasePreview(); }
  assert.equal((await preview).ok, true);
});

test('run trace reconstructs each email step, checkpoints, decisions, and Gmail cost without bodies or credentials', async () => {
  const f = fixture({ messages: [msg('a'), msg('archived', { labelIds: ['Label_unrelated'] })] });
  const logs = [];
  f.deps.log = async (entry) => {
    logs.push(structuredClone(entry));
    if (entry.event === 'email.succeeded') assert.equal(f.state().run.items.find(item => item.id === entry.messageId).status, 'succeeded', 'success is logged after the durable checkpoint');
    if (entry.event === 'classification.saved') assert.ok(f.state().run.items.find(item => item.id === entry.messageId).decision, 'decision is durable before its saved event');
  };
  await connect(f);
  await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  const runId = f.state().run.id;
  const runEvents = logs.filter(event => event.runId === runId);
  for (const name of ['run.started', 'discovery.page', 'discovery.completed', 'label.ready', 'email.read', 'email.decoded', 'classification.started', 'helper.request', 'helper.response', 'classification.saved', 'label.apply', 'email.succeeded', 'email.ineligible', 'email.skipped', 'run.completed']) {
    assert.ok(runEvents.some(event => event.event === name), `trace contains ${name}`);
  }
  assert.ok(runEvents.some(event => event.event === 'email.read' && event.messageId === 'a'));
  assert.equal(runEvents.find(event => event.event === 'classification.saved').data.answer.confidence, 0.82);
  assert.equal(runEvents.find(event => event.event === 'run.started').data.categories[0].description, f.state().categories[0].description);
  assert.equal(runEvents.filter(event => event.event === 'gmail.request' && event.data.operation === 'messages.get').reduce((sum, event) => sum + event.data.estimatedQuotaUnits, 0), 40);
  for (const event of runEvents.filter(event => event.event === 'gmail.request')) {
    assert.ok(runEvents.some(result => result.event === 'gmail.response' && result.requestId === event.requestId && result.data.attempt === event.data.attempt), 'requests have a correlated outcome');
  }
  const serialized = JSON.stringify(logs);
  assert.ok(!serialized.includes('fixture-access-token') && !serialized.includes('x'.repeat(40)));
  assert.ok(!serialized.includes('Subject a') && !serialized.includes('fixture@example.test') && !serialized.includes('intended@example.test'), 'only message IDs identify emails in logs');
  assert.ok(!serialized.includes('Email a café.') && !serialized.includes('Ignore all rules is untrusted email text.'));
  const events = JSON.parse(JSON.stringify(logs.map((event, i) => ({ ...event, at: Math.round(event.at), seq: i + 1, id: `log-${i + 1}` }))));
  for (let i = 0; i < events.length; i += 100) assert.doesNotThrow(() => validateLogBatch({ installationId: 'fixture-installation', events: events.slice(i, i + 100) }));
  await mkdir('work', { recursive: true });
  await writeFile('work/engine-log-events.json', JSON.stringify(events, null, 2));
});

test('rate-limit trace preserves Google reason, request attempts, shared wait, recovery and resume choices', async () => {
  let attempts = 0;
  const f = fixture({ messages: [msg('a')], intercept: async ({ path }) => path === 'messages/a/modify' && attempts++ === 0 ? json({ error: { message: 'User Rate Limit Exceeded', errors: [{ reason: 'userRateLimitExceeded' }] } }, 403) : undefined });
  const logs = []; f.deps.log = async event => { logs.push(structuredClone(event)); };
  await connect(f); await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  assert.equal(f.state().run.status, 'completed');
  const denied = logs.find(event => event.event === 'gmail.response' && event.data.status === 403);
  assert.equal(denied.data.googleMessage, 'User Rate Limit Exceeded'); assert.deepEqual(denied.data.reasons, ['userRateLimitExceeded']);
  assert.ok(logs.some(event => event.event === 'gmail.cooldown' && event.data.delayMs >= 60000));
  assert.ok(logs.some(event => event.event === 'gmail.wait' && event.data.reason === 'rate_limit'));
  const requests = logs.filter(event => event.event === 'gmail.request' && event.requestId === denied.requestId);
  assert.deepEqual(requests.map(event => event.data.attempt), [1, 2]);
  assert.equal(f.decisions.length, 1, 'Gmail retry does not repeat classification');

  const failed = fixture({ messages: [msg('a')], failModify: 'a' }); const resumedLogs = [];
  failed.deps.log = async event => { resumedLogs.push(structuredClone(event)); };
  await connect(failed); await command(failed.engine, { command: 'start', daysBack: 30 }); await failed.engine.whenIdle();
  failed.allowModify(); await command(failed.engine, { command: 'resume' }); await failed.engine.whenIdle();
  assert.ok(resumedLogs.some(event => event.event === 'run.failed'));
  assert.ok(resumedLogs.some(event => event.event === 'run.resumed'));
  assert.ok(resumedLogs.some(event => event.event === 'classification.reused'));
});

test('journal failure is visible and does not turn a successful Gmail label into a failed item', async () => {
  const f = fixture({ messages: [msg('a')] });
  f.deps.log = async () => { throw new Error('fixture storage full'); };
  await connect(f); await command(f.engine, { command: 'start', daysBack: 30 }); await f.engine.whenIdle();
  assert.equal(f.state().run.succeeded, 1); assert.equal(f.state().run.status, 'completed');
  const result = await command(f.engine, { command: 'state' });
  assert.match(result.state.logWarning, /may have gaps/);
});

let failures = 0;
for (const { name, fn } of tests) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); }
}
console.log(`${tests.length - failures}/${tests.length} engine tests passed. All network calls were fixtures.`);
if (failures) process.exitCode = 1;
