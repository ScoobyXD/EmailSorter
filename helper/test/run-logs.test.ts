import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { once } from 'node:events';
import { RunLogWriter, validateLogBatch } from '../src/run-logs.ts';
import { createHelperServer, EXTENSION_ID } from '../src/server.ts';

const token = 'l'.repeat(43);
const headers = { Origin: `chrome-extension://${EXTENSION_ID}`, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const installationId = 'installation-fixture';
function event(seq: number, runId?: string) {
  return { id: `event:${seq}`, seq, at: Date.UTC(2026, 9, 2, 12), scope: runId ? 'run' : 'connection', level: 'info', stage: runId ? 'run' : 'connection', event: runId ? 'run.started' : 'helper.connected', message: 'Diagnostic fixture.', ...(runId ? { runId } : {}) };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dock-run-log-test-'));
  let classifications = 0;
  const server = createHelperServer({ pairingToken: token, logDirectory: directory, classify: async () => { classifications++; throw new Error('Do not invoke model in logging tests.'); } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address.');
  const url = `http://127.0.0.1:${address.port}`;
  return {
    directory, url, classifications: () => classifications,
    post: (body: unknown, suppliedHeaders = headers) => fetch(`${url}/logs/append`, { method: 'POST', headers: suppliedHeaders, body: JSON.stringify(body) }),
    close: async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await rm(directory, { recursive: true, force: true }); },
  };
}
async function records(directory: string, filename: string) {
  return (await readFile(join(directory, installationId, filename), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
}

test('logging uses authenticated exact-origin access and health advertises its capability without model calls', async () => {
  const f = await fixture();
  try {
    for (const supplied of [{ ...headers, Authorization: '' }, { ...headers, Origin: 'https://unrelated.example' }, { ...headers, Origin: 'null' }]) {
      const response = await f.post({ installationId, events: [event(1)] }, supplied);
      assert.ok([401, 403].includes(response.status));
    }
    assert.deepEqual(await readdir(f.directory), []);
    const health = await fetch(`${f.url}/health`, { headers });
    assert.deepEqual((await health.json()).logs, { supported: true, path: f.directory });
    const response = await f.post({ installationId, events: [event(1, 'run-one'), event(2), event(3, 'run-two')] });
    assert.equal(response.status, 200);
    const receipt = await response.json();
    assert.deepEqual(receipt, { ok: true, acceptedThrough: 3, path: join(f.directory, installationId) });
    assert.ok(isAbsolute(receipt.path));
    assert.equal((await records(f.directory, 'run-one.jsonl'))[0].seq, 1);
    assert.equal((await records(f.directory, 'activity-2026-10-02.jsonl'))[0].seq, 2);
    assert.equal((await records(f.directory, 'run-two.jsonl'))[0].seq, 3);
    assert.equal(f.classifications(), 0);
  } finally { await f.close(); }
});

test('retries, overlapping batches, restart and interleaved run sequences preserve exactly one complete record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dock-log-dedupe-'));
  try {
    const writer = new RunLogWriter(directory);
    const batch = { installationId, events: [event(1, 'run-a'), event(2, 'run-b'), event(3, 'run-a')] };
    await Promise.all([writer.append(batch), writer.append(batch)]);
    const restarted = new RunLogWriter(directory);
    const receipt = await restarted.append({ installationId, events: [...batch.events, event(4, 'run-b')] });
    assert.equal(receipt.acceptedThrough, 4);
    assert.deepEqual((await records(directory, 'run-a.jsonl')).map(item => item.seq), [1, 3]);
    assert.deepEqual((await records(directory, 'run-b.jsonl')).map(item => item.seq), [2, 4]);
    await assert.rejects(restarted.append({ installationId, events: [{ ...event(1, 'run-a'), message: 'Changed immutable event.' }] }), /conflicts/);
    await assert.rejects(restarted.append({ installationId, events: [{ ...event(5, 'run-a'), id: 'event:1' }] }), /conflicts/);
    // A partially persisted multi-file batch can leave a lower sequence missing.
    await restarted.append({ installationId, events: [event(6, 'run-a')] });
    await restarted.append({ installationId, events: [event(5, 'run-b'), event(6, 'run-a')] });
    assert.deepEqual((await records(directory, 'run-b.jsonl')).map(item => item.seq), [2, 4, 5]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('diagnostic metadata preserves message IDs, category rules, choices and usage while rejecting email content and credentials', () => {
  const data = {
    categories: [{ id: 'bills', title: 'Bills', description: 'Bills and receipts.', labelId: 'Label_1' }],
    threadId: 'thread-fixture',
    model: 'fixture-model', answer: { choice: 'bills', confidence: 0.9, probabilities: { bills: 0.9, __uncategorized__: 0.1 } },
    usage: { input_tokens: 250, output_tokens: 12 }, bodyChars: 2400, bodyBytes: 2500,
    messageIds: Array.from({ length: 500 }, (_, i) => `message-${i}`),
  };
  const validated = validateLogBatch({ installationId, events: [{ ...event(1), messageId: 'message-fixture', data }] }).events[0];
  assert.equal(validated.messageId, 'message-fixture');
  assert.deepEqual(validated.data, data);
  for (const key of ['subject', 'sender', 'accountEmail', 'Subject', 'account_email', 'emailAddress', 'snippet', 'body', 'decodedBody', 'Authorization', 'access_token', 'refreshToken', 'pairingToken', 'apiKey', 'password', 'rawPrompt', 'tokens', 'privateToken']) {
    assert.throws(() => validateLogBatch({ installationId, events: [{ ...event(1), data: { nested: { [key]: 'secret fixture' } } }] }), /bodies or credentials/);
  }
  assert.throws(() => validateLogBatch({ installationId, events: [{ ...event(1), data: { bodyChars: 'email text' } }] }));
  assert.throws(() => validateLogBatch({ installationId, events: [{ ...event(1), data: { input_tokens: 'credential' } }] }));
  const prototypeKey = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => validateLogBatch({ installationId, events: [{ ...event(1), data: prototypeKey }] }));
});

test('category IDs that resemble sensitive fields retain numeric probabilities without permitting secret values', () => {
  const probabilities = { token: 0.25, body: 0.25, auth: 0.25, access_token: 0.25 };
  const data = { answer: { choice: 'body', confidence: 0.25, probabilities } };
  assert.deepEqual(validateLogBatch({ installationId, events: [{ ...event(1), data }] }).events[0].data, data);
  for (const value of ['credential', { body: 'email text' }, -0.1, 1.1, Infinity]) {
    assert.throws(() => validateLogBatch({ installationId, events: [{ ...event(1), data: { answer: { probabilities: { token: value } } } }] }));
  }
  // The exception applies only to answer.probabilities, not arbitrary metadata.
  assert.throws(() => validateLogBatch({ installationId, events: [{ ...event(1), data: { probabilities } }] }));
});

test('invalid IDs, schema injection, nonfinite fields, deeply nested metadata and oversize batches fail before disk writes', async () => {
  const f = await fixture();
  try {
    for (const id of ['../escape', '..', 'C:\\escape', '/root', 'a/b', 'a\\b', 'CON', 'NUL', 'name.']) {
      assert.equal((await f.post({ installationId: id, events: [event(1)] })).status, 400);
      assert.equal((await f.post({ installationId, events: [{ ...event(1), runId: id }] })).status, 400);
    }
    for (const item of [{ ...event(1), body: 'raw email' }, { ...event(1), at: NaN }, { ...event(1), seq: Infinity }, { ...event(1), id: '../event' }, { ...event(1), seq: -1 }, { ...event(1), stage: 'unknown' }]) {
      assert.equal((await f.post({ installationId, events: [item] })).status, 400);
    }
    assert.equal((await f.post({ installationId, events: [event(2), event(1)] })).status, 400);
    assert.equal((await f.post({ installationId, events: Array.from({ length: 101 }, (_, i) => event(i + 1)) })).status, 400);
    let nested: unknown = 'too deep';
    for (let i = 0; i < 10; i++) nested = { inner: nested };
    assert.equal((await f.post({ installationId, events: [{ ...event(1), data: { nested } }] })).status, 400);
    assert.equal((await f.post({ installationId, events: [{ ...event(1), message: 'x'.repeat(270000) }] })).status, 413);
    assert.deepEqual(await readdir(f.directory), []);
  } finally { await f.close(); }
});

test('a failed disk write is retryable, never acknowledged, and leaves the writer able to recover', async () => {
  const f = await fixture();
  try {
    const blocked = join(f.directory, installationId);
    await writeFile(blocked, 'Fixture blocks directory creation.');
    const failed = await f.post({ installationId, events: [event(1)] });
    assert.equal(failed.status, 503);
    const failure = await failed.json();
    assert.equal(failure.error.code, 'LOG_WRITE_FAILED');
    assert.equal(failure.error.retryable, true);
    assert.equal(failure.acceptedThrough, undefined);
    await rm(blocked);
    assert.equal((await f.post({ installationId, events: [event(1)] })).status, 200);
    assert.equal((await records(f.directory, 'activity-2026-10-02.jsonl')).length, 1);
  } finally { await f.close(); }
});

test('an interrupted final line is preserved and retried events continue in a recovery file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dock-log-crash-'));
  try {
    const batch = { installationId, events: [event(1, 'run-crash')] };
    await new RunLogWriter(directory).append(batch);
    const file = join(directory, installationId, 'run-crash.jsonl');
    const saved = await readFile(file, 'utf8');
    await writeFile(file, saved + '{"seq":2,"id":');
    const restarted = new RunLogWriter(directory);
    await restarted.append({ installationId, events: [event(1, 'run-crash'), event(2, 'run-crash')] });
    assert.equal(await readFile(file, 'utf8'), saved + '{"seq":2,"id":');
    const recovered = (await readdir(join(directory, installationId))).find(name => name.includes('.recovery-'))!;
    assert.equal((await records(directory, recovered))[0].seq, 2);
    await new RunLogWriter(directory).append({ installationId, events: [event(2, 'run-crash')] });
    assert.equal((await records(directory, recovered)).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
