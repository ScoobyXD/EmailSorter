import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { PublicError } from './classification.ts';

export const MAX_LOG_REQUEST_BYTES = 256 * 1024;
const FIELDS = new Set(['seq', 'id', 'at', 'runId', 'scope', 'level', 'stage', 'event', 'message', 'messageId', 'requestId', 'data']);
const SCOPES = new Set(['run', 'browse', 'connection', 'system']);
const LEVELS = new Set(['info', 'warn', 'error']);
const STAGES = new Set(['run', 'discovery', 'read', 'classification', 'labels', 'quota', 'connection', 'browse']);
const SENSITIVE_KEYS = new Set(['subject', 'sender', 'accountemail', 'emailaddress', 'snippet', 'body', 'bodytext', 'decodedbody', 'rawbody', 'emailbody', 'htmlbody', 'textbody', 'rawmessage', 'rawemail', 'rawprompt', 'prompt', 'authorization', 'auth', 'cookie', 'cookies', 'token', 'accesstoken', 'refreshtoken', 'idtoken', 'pairingtoken', 'pairingcode', 'apikey', 'secret', 'clientsecret', 'password', 'credential', 'credentials', '__proto__', 'prototype', 'constructor']);
interface LogEvent {
  seq: number; id: string; at: number; runId?: string; scope: string; level: string;
  stage: string; event: string; message: string; messageId?: string; requestId?: string;
  data?: Record<string, unknown>;
}
interface Batch { installationId: string; events: LogEvent[] }
export interface LogReceipt { ok: true; acceptedThrough: number; path: string }
interface Seen { id: string; digest: string }
interface Installation {
  sequences: Map<number, Seen>; ids: Map<string, number>;
  interrupted: Set<string>; recoveryFiles: Map<string, string>;
}

function invalid(message = 'Provide a valid diagnostic log batch.'): never {
  throw new PublicError(400, 'INVALID_LOG_BATCH', message);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.length) || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid();
  return value;
}
function directoryId(value: unknown): string {
  const id = text(value, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id)) invalid('Log directory and run IDs must be safe identifiers.');
  return id;
}
function eventId(value: unknown): string {
  const id = text(value, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(id)) invalid();
  return id;
}
function metadata(value: unknown, depth: number, budget: { nodes: number }, path: string[] = []): unknown {
  if (++budget.nodes > 10000 || depth > 8) invalid('Diagnostic metadata exceeds the supported structure.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(); return value; }
  if (typeof value === 'string') return text(value, 4096, true);
  if (Array.isArray(value)) {
    if (value.length > 1000) invalid();
    return value.map(item => metadata(item, depth + 1, budget, path));
  }
  if (!record(value) || Object.keys(value).length > 150) invalid();
  const output: Record<string, unknown> = {};
  const probabilities = path.at(-2) === 'answer' && path.at(-1) === 'probabilities';
  for (const [key, item] of Object.entries(value)) {
    if (probabilities) {
      // These keys are user-defined category IDs, not credential/body field names.
      // Only numeric probabilities may cross this exception to the secret-key filter.
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)
        || typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1) invalid();
      output[key] = item;
      continue;
    }
    const normalized = key.toLowerCase().replace(/[-_]/g, '');
    const tokenCount = ['inputtokens', 'outputtokens', 'totaltokens'].includes(normalized) && typeof item === 'number' && Number.isFinite(item) && item >= 0;
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(normalized) || (/tokens?$/.test(normalized) && !tokenCount)) invalid('Diagnostic logs use message IDs and cannot contain email headers, account addresses, bodies or credentials.');
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(key)) invalid();
    if (['bodychars', 'bodybytes'].includes(normalized) && (typeof item !== 'number' || !Number.isFinite(item) || item < 0)) invalid();
    output[key] = metadata(item, depth + 1, budget, [...path, key]);
  }
  return output;
}
function event(value: unknown): LogEvent {
  if (!record(value) || Object.keys(value).some(key => !FIELDS.has(key))) invalid();
  if (typeof value.seq !== 'number' || !Number.isSafeInteger(value.seq) || value.seq < 1) invalid();
  if (typeof value.at !== 'number' || !Number.isSafeInteger(value.at) || value.at < 0 || value.at > 8640000000000000) invalid();
  if (!SCOPES.has(String(value.scope)) || !LEVELS.has(String(value.level)) || !STAGES.has(String(value.stage))) invalid();
  const result: LogEvent = {
    seq: value.seq, id: eventId(value.id), at: value.at,
    ...(value.runId === undefined ? {} : { runId: directoryId(value.runId) }),
    scope: String(value.scope), level: String(value.level), stage: String(value.stage),
    event: text(value.event, 120), message: text(value.message, 2000),
    ...(value.messageId === undefined ? {} : { messageId: eventId(value.messageId) }),
    ...(value.requestId === undefined ? {} : { requestId: eventId(value.requestId) }),
  };
  if (!/^[a-zA-Z0-9_.:-]+$/.test(result.event)) invalid();
  if (value.data !== undefined) {
    if (!record(value.data)) invalid();
    result.data = metadata(value.data, 0, { nodes: 0 }) as Record<string, unknown>;
  }
  return result;
}
export function validateLogBatch(value: unknown): Batch {
  if (!record(value) || Object.keys(value).some(key => !['installationId', 'events'].includes(key)) || !Array.isArray(value.events) || value.events.length < 1 || value.events.length > 100) invalid();
  const batch = { installationId: directoryId(value.installationId), events: value.events.map(event) };
  for (let i = 1; i < batch.events.length; i++) {
    if (batch.events[i].seq <= batch.events[i - 1].seq) invalid('Log events must be in increasing sequence order.');
  }
  return batch;
}
function digest(value: LogEvent): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function checkSaved(state: Installation, item: LogEvent): string {
  const fingerprint = digest(item);
  const existing = state.sequences.get(item.seq);
  const previousSequence = state.ids.get(item.id);
  if ((existing && (existing.id !== item.id || existing.digest !== fingerprint)) || (previousSequence !== undefined && previousSequence !== item.seq)) {
    throw new PublicError(409, 'LOG_SEQUENCE_CONFLICT', 'A saved diagnostic event conflicts with this sequence or ID.');
  }
  return fingerprint;
}
function remember(state: Installation, item: LogEvent) {
  const fingerprint = checkSaved(state, item);
  state.sequences.set(item.seq, { id: item.id, digest: fingerprint });
  state.ids.set(item.id, item.seq);
}
async function assertPlainPath(path: string) {
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Log paths cannot be symbolic links.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

/** Acknowledgements follow fsync. A lost HTTP response can safely be retried after a restart. */
export class RunLogWriter {
  readonly directory: string;
  private queue: Promise<void> = Promise.resolve();
  private installations = new Map<string, Installation>();
  constructor(directory: string) { this.directory = resolve(directory); }

  async append(value: unknown): Promise<LogReceipt> {
    const batch = validateLogBatch(value);
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(done => { release = done; });
    await previous;
    try { return await this.write(batch); }
    catch (error) {
      // A failed write may still have reached disk; rescan before retrying it.
      this.installations.delete(batch.installationId);
      if (error instanceof PublicError) throw error;
      throw new PublicError(503, 'LOG_WRITE_FAILED', 'Run logs could not be saved to disk. Browser logs remain available; retry after checking the helper log folder.', true);
    } finally { release(); }
  }

  private async load(directory: string): Promise<Installation> {
    const state: Installation = { sequences: new Map(), ids: new Map(), interrupted: new Set(), recoveryFiles: new Map() };
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.name.endsWith('.jsonl')) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Invalid log file.');
      const path = join(directory, entry.name);
      const stream = createReadStream(path, { encoding: 'utf8' });
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      let interrupted = false;
      try {
        for await (const line of lines) {
          if (interrupted) throw new Error('Invalid record within saved log.');
          if (!line) continue;
          let parsed: unknown;
          try { parsed = JSON.parse(line); }
          catch { interrupted = true; continue; }
          remember(state, event(parsed));
        }
      } finally { lines.close(); stream.destroy(); }
      if (interrupted) state.interrupted.add(entry.name);
      // Flush data recovered after a write failure before acknowledging it.
      const handle = await open(path, 'a+');
      try {
        const size = (await handle.stat()).size;
        if (!interrupted && size) {
          const last = Buffer.alloc(1);
          await handle.read(last, 0, 1, size - 1);
          if (last[0] !== 10) await handle.write('\n');
        }
        await handle.sync();
      } finally { await handle.close(); }
    }
    return state;
  }

  private async write(batch: Batch): Promise<LogReceipt> {
    const directory = join(this.directory, batch.installationId);
    await assertPlainPath(this.directory);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await assertPlainPath(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let state = this.installations.get(batch.installationId);
    if (!state) { state = await this.load(directory); this.installations.set(batch.installationId, state); }
    const groups = new Map<string, LogEvent[]>();
    // Validate the entire batch before writing any of it.
    const checked: Installation = { sequences: new Map(), ids: new Map(), interrupted: new Set(), recoveryFiles: new Map() };
    for (const item of batch.events) {
      const exists = state.sequences.has(item.seq);
      checkSaved(state, item);
      remember(checked, item);
      if (exists) continue;
      const base = item.runId ? `${item.runId}.jsonl` : `activity-${new Date(item.at).toISOString().slice(0, 10)}.jsonl`;
      let filename = base;
      if (state.interrupted.has(base)) {
        filename = state.recoveryFiles.get(base) ?? `${base.slice(0, -6)}.recovery-${randomUUID()}.jsonl`;
        state.recoveryFiles.set(base, filename);
      }
      const group = groups.get(filename) ?? [];
      group.push(item); groups.set(filename, group);
    }
    for (const [filename, items] of groups) {
      const path = join(directory, filename);
      await assertPlainPath(path);
      const handle = await open(path, 'a', 0o600);
      try {
        await handle.writeFile(items.map(item => JSON.stringify(item) + '\n').join(''), 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
      for (const item of items) remember(state, item);
    }
    return { ok: true, acceptedThrough: batch.events.at(-1)!.seq, path: directory };
  }
}
