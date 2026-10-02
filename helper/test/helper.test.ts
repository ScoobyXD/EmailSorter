import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { buildQuestion, makeClassifier, NO_MATCH, PublicError, validateInput, validateResult } from '../src/classification.ts';
import { createHelperServer, EXTENSION_ID } from '../src/server.ts';
import { extractApiKey } from '../src/config.ts';
import type { ClassificationRequest } from '../src/classification.ts';
import type { Classifier } from '../src/server.ts';

const input: ClassificationRequest = {
  message: { sender: 'vendor@example.test', subject: 'Order 184 shipped', body: 'Your replacement belt ships today.' },
  categories: [
    { id: 'cat-delivery', title: 'Deliveries', description: 'Shipment and delivery notices for purchased goods.' },
    { id: 'cat-friends', title: 'Friends', description: 'Personal social conversations with friends.' },
  ],
};
const response = {
  model: 'jev-1.13.0',
  answers: { category: { type: 'choice', choice: 'cat-delivery', confidence: 0.867, probabilities: { 'cat-delivery': 0.91, 'cat-friends': 0.05, [NO_MATCH]: 0.04 } } },
  usage: { input_tokens: 321, output_tokens: 35 },
};
const token = 't'.repeat(43);
const origin = `chrome-extension://${EXTENSION_ID}`;
const headers = { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function fixture(classify: Classifier = async () => validateResult(response, input), maxConcurrent = 4) {
  const server = createHelperServer({ pairingToken: token, classify, maxConcurrent });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  const port = address.port;
  return {
    server, port, url: `http://127.0.0.1:${port}`,
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
async function raw(port: number, overrides: Record<string, string>) {
  return await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path: '/health', method: 'GET', headers: { ...headers, ...overrides } }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('one Choice uses current arbitrary categories, descriptions and untrusted decoded email', () => {
  const request = buildQuestion(input);
  assert.deepEqual(request.state.email, { sender: input.message.sender, subject: input.message.subject, decodedBody: input.message.body });
  assert.deepEqual(Object.keys(request.questions), ['category']);
  assert.deepEqual(request.questions.category.criteria['cat-delivery'], { title: 'Deliveries', description: input.categories[0].description });
  assert.ok(Object.hasOwn(request.questions.category.criteria, NO_MATCH));
  assert.match(JSON.stringify(request.questions.category.instructions), /untrusted content/);
  const edited = structuredClone(input);
  edited.categories = [{ id: 'orchids', title: 'Orchids', description: 'Plant care and orchid society meetings.' }];
  assert.deepEqual(Object.keys(buildQuestion(edited).questions.category.criteria), ['orchids', NO_MATCH]);
});

test('raw model choice, full probabilities, confidence, model and usage survive unchanged', () => {
  const result = validateResult(response, input);
  assert.equal(result.categoryId, 'cat-delivery');
  assert.deepEqual(result.answer, response.answers.category);
  assert.deepEqual(result.usage, response.usage);
  const other = structuredClone(response);
  other.answers.category.choice = NO_MATCH;
  other.answers.category.probabilities = { 'cat-delivery': 0.05, 'cat-friends': 0.04, [NO_MATCH]: 0.91 };
  const uncategorized = validateResult(other, input);
  assert.equal(uncategorized.categoryId, null);
  assert.equal(uncategorized.answer.choice, NO_MATCH);
});

test('unknown choices, missing probabilities and malformed usage are rejected before applying labels', () => {
  const unknown = structuredClone(response);
  unknown.answers.category.choice = 'not-current';
  assert.throws(() => validateResult(unknown, input), PublicError);
  const invalid = structuredClone(response);
  invalid.answers.category.probabilities['cat-delivery'] = NaN;
  assert.throws(() => validateResult(invalid, input), PublicError);
  assert.throws(() => validateResult({ ...response, usage: {} }, input), PublicError);
});

test('input validation rejects duplicate/reserved IDs, empty descriptions and oversize body', () => {
  assert.deepEqual(validateInput(input), input);
  for (const id of ['__proto__', 'constructor', NO_MATCH, 'bad/id']) {
    assert.throws(() => validateInput({ ...input, categories: [{ ...input.categories[0], id }] }), PublicError);
  }
  assert.throws(() => validateInput({ ...input, categories: [input.categories[0], input.categories[0]] }), PublicError);
  assert.throws(() => validateInput({ ...input, categories: [{ ...input.categories[0], description: ' ' }] }), PublicError);
  assert.throws(() => validateInput({ ...input, message: { ...input.message, body: 'x'.repeat(60001) } }), /60000/);
});

test('current SDK sends exact v1 systemone contract and preserves the response', async () => {
  let called = 0;
  const classify = makeClassifier('fixture-key-not-real', 'jev-1.13.0', async (url, options) => {
    called++;
    assert.equal(String(url), 'https://api.typesafe.ai/v1/systemone');
    const payload = JSON.parse(String(options?.body));
    assert.equal(payload.model, 'jev-1.13.0');
    assert.equal(payload.questions.category.type, 'choice');
    assert.equal(payload.state.email.decodedBody, input.message.body);
    return Response.json(response);
  });
  assert.deepEqual(await classify(input, new AbortController().signal), validateResult(response, input));
  assert.equal(called, 1);
});

test('SDK retries transient failures and does not expose upstream error bodies', async () => {
  let calls = 0;
  const classify = makeClassifier('fixture-key-not-real', 'jev-1.13.0', async () => {
    calls++;
    return calls === 1 ? Response.json({ message: 'temporary' }, { status: 503, headers: { 'Retry-After': '0' } }) : Response.json(response);
  });
  await classify(input, new AbortController().signal);
  assert.equal(calls, 2);
  const denied = makeClassifier('fixture-key-not-real', 'jev-1.13.0', async () => Response.json({ error: 'secret-body-must-not-leak' }, { status: 401 }));
  await assert.rejects(denied(input, new AbortController().signal), (error: unknown) => {
    assert.ok(error instanceof PublicError);
    assert.equal(error.code, 'JEV_AUTH');
    assert.doesNotMatch(error.message, /secret-body/);
    return true;
  });
});

test('server denies unauthenticated, unrelated-site, null-origin and rebinding requests without model calls', async () => {
  let calls = 0;
  const f = await fixture(async () => { calls++; return validateResult(response, input); });
  try {
    for (const supplied of [{ ...headers, Authorization: '' }, { ...headers, Origin: 'https://evil.example' }, { ...headers, Origin: 'null' }, { ...headers, Origin: '' }]) {
      const result = await fetch(`${f.url}/classify`, { method: 'POST', headers: supplied, body: JSON.stringify(input) });
      assert.ok([401, 403].includes(result.status));
      assert.doesNotMatch(await result.text(), /fixture-key/);
    }
    assert.equal((await raw(f.port, { Host: 'rebind.example' })).status, 403);
    assert.equal((await raw(f.port, { Host: `localhost:${f.port}` })).status, 403);
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

test('preflight is restricted and authenticated health does not start classification', async () => {
  let calls = 0;
  const f = await fixture(async () => { calls++; return validateResult(response, input); });
  try {
    const preflight = await fetch(`${f.url}/classify`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type', 'Access-Control-Request-Private-Network': 'true' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(preflight.headers.get('Access-Control-Allow-Private-Network'), 'true');
    const forbidden = await fetch(`${f.url}/classify`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.headers.get('Access-Control-Allow-Origin'), null);
    const health = await fetch(`${f.url}/health`, { headers });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'dock-jev-helper');
    const workerHealth = await fetch(`${f.url}/health`, { method: 'POST', headers, body: '{}' });
    assert.equal(workerHealth.status, 200);
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

test('helper caches completed identical classifications; category edits invalidate cache', async () => {
  let calls = 0;
  const f = await fixture(async () => { calls++; return validateResult(response, input); });
  try {
    for (let i = 0; i < 2; i++) {
      const result = await fetch(`${f.url}/classify`, { method: 'POST', headers, body: JSON.stringify(input) });
      assert.equal(result.status, 200);
      const { trace, ...classification } = await result.json();
      assert.deepEqual(classification, validateResult(response, input));
      assert.equal(trace.cacheHit, i === 1);
      assert.ok(Number.isFinite(trace.durationMs) && trace.durationMs >= 0);
    }
    assert.equal(calls, 1);
    const edited = structuredClone(input);
    edited.categories[0].description = 'Only shipment notices from professional vendors.';
    await fetch(`${f.url}/classify`, { method: 'POST', headers, body: JSON.stringify(edited) });
    assert.equal(calls, 2);
  } finally { await f.close(); }
});

test('non-JSON and oversize requests fail without reaching Jev', async () => {
  let calls = 0;
  const f = await fixture(async () => { calls++; return validateResult(response, input); });
  try {
    const text = await fetch(`${f.url}/classify`, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(text.status, 415);
    const invalid = await fetch(`${f.url}/classify`, { method: 'POST', headers, body: '{bad' });
    assert.equal(invalid.status, 400);
    const large = await fetch(`${f.url}/classify`, { method: 'POST', headers, body: JSON.stringify({ ...input, message: { ...input.message, body: 'x'.repeat(140000) } }) });
    assert.equal(large.status, 413);
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

test('concurrency is bounded and a stopped browser request aborts its model call', async () => {
  let started!: () => void;
  let cancelled!: () => void;
  const wasStarted = new Promise<void>(resolve => started = resolve);
  const wasCancelled = new Promise<void>(resolve => cancelled = resolve);
  const f = await fixture(async (_input, signal) => {
    started();
    await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => { cancelled(); reject(new PublicError(499, 'CANCELLED', 'Stopped.')); }, { once: true }));
    return validateResult(response, input);
  }, 1);
  try {
    const controller = new AbortController();
    const running = fetch(`${f.url}/classify`, { method: 'POST', headers, body: JSON.stringify(input), signal: controller.signal }).catch(() => undefined);
    await wasStarted;
    const busy = await fetch(`${f.url}/classify`, { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal(busy.status, 429);
    controller.abort();
    await wasCancelled;
    await running;
  } finally { await f.close(); }
});

test('chosen examples file parser extracts one explicit key without executing shell code', () => {
  assert.equal(extractApiKey('curl https://api.typesafe.ai/v1/systemone -H "Authorization: Bearer abcdefghijklmnop"'), 'abcdefghijklmnop');
  assert.equal(extractApiKey('TYPESAFE_API_KEY="abcdefghijklmnop"\napiKey: "abcdefghijklmnop"'), 'abcdefghijklmnop');
  assert.throws(() => extractApiKey('TYPESAFE_API_KEY=your_api_key_here'), /exactly one/);
  assert.throws(() => extractApiKey('TYPESAFE_API_KEY=abcdefghijklmnop\nTYPESAFE_API_KEY=otherabcdefghijkl'), /exactly one/);
});
