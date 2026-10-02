import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_REQUEST_BYTES, MODEL, PublicError, validateInput } from './classification.ts';
import type { ClassificationRequest, ClassificationResult } from './classification.ts';
import { MAX_LOG_REQUEST_BYTES, RunLogWriter } from './run-logs.ts';

export const PORT = 38471;
export const EXTENSION_ID = 'ccklhlnpillicildcgbdfibggkkhkdib';
export type Classifier = (input: ClassificationRequest, signal: AbortSignal) => Promise<ClassificationResult>;
interface Options { pairingToken: string; extensionId?: string; model?: string; classify: Classifier; maxConcurrent?: number; logDirectory?: string }

function safeEqual(a: string, b: string): boolean {
  const actual = Buffer.from(a);
  const expected = Buffer.from(b);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function respond(response: ServerResponse, status: number, body: unknown) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
async function readJson(request: IncomingMessage, maximumBytes = MAX_REQUEST_BYTES): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
    throw new PublicError(415, 'CONTENT_TYPE', 'Use application/json.');
  }
  if (request.headers['content-encoding'] || Number(request.headers['content-length']) > maximumBytes) {
    throw new PublicError(413, 'INPUT_TOO_LARGE', 'The request exceeds the supported input size.');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximumBytes) throw new PublicError(413, 'INPUT_TOO_LARGE', 'The request exceeds the supported input size.');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new PublicError(400, 'INVALID_JSON', 'The request must contain valid JSON.'); }
}

export function createHelperServer(options: Options) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(options.pairingToken)) throw new Error('A cryptographically random pairing token is required.');
  const extensionId = options.extensionId ?? EXTENSION_ID;
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('A valid Chrome extension ID is required.');
  const origin = `chrome-extension://${extensionId}`;
  const logs = options.logDirectory ? new RunLogWriter(options.logDirectory) : undefined;
  let active = 0;
  let windowStart = Date.now();
  let requestsInWindow = 0;
  const cache = new Map<string, { result: ClassificationResult; expires: number }>();
  const server = createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : PORT;
      if (request.socket.remoteAddress !== '127.0.0.1' || request.headers.host !== `127.0.0.1:${port}`) {
        throw new PublicError(403, 'HOST_FORBIDDEN', 'Only the configured loopback host is allowed.');
      }
      if (request.headers.origin !== origin) throw new PublicError(403, 'ORIGIN_FORBIDDEN', 'Only the paired Dock extension is allowed.');
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      if (request.method === 'OPTIONS') {
        const method = request.headers['access-control-request-method'];
        const headers = (request.headers['access-control-request-headers'] ?? '').toString().toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
        if (!['GET', 'POST'].includes(String(method)) || headers.some(x => !['authorization', 'content-type'].includes(x))) {
          throw new PublicError(403, 'PREFLIGHT_FORBIDDEN', 'The requested cross-origin operation is not allowed.');
        }
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        // Chrome Private Network Access preflights are limited to the exact extension origin above.
        if (request.headers['access-control-request-private-network'] === 'true') response.setHeader('Access-Control-Allow-Private-Network', 'true');
        response.writeHead(204);
        response.end();
        return;
      }
      if (!safeEqual(request.headers.authorization ?? '', `Bearer ${options.pairingToken}`)) {
        throw new PublicError(401, 'PAIRING_REQUIRED', 'Enter the local helper pairing code in Dock settings.');
      }
      if (['GET', 'POST'].includes(request.method ?? '') && request.url === '/health') {
        if (request.method === 'POST') await readJson(request);
        respond(response, 200, { ok: true, service: 'dock-jev-helper', version: '0.4.4', model: options.model ?? MODEL, logs: { supported: Boolean(logs), ...(logs ? { path: logs.directory } : {}) } });
        return;
      }
      if (request.method === 'POST' && request.url === '/logs/append') {
        if (!logs) throw new PublicError(503, 'LOGS_UNAVAILABLE', 'Restart the updated Dock helper to save logs to disk.', true);
        respond(response, 200, await logs.append(await readJson(request, MAX_LOG_REQUEST_BYTES)));
        return;
      }
      if (request.method !== 'POST' || request.url !== '/classify') throw new PublicError(404, 'NOT_FOUND', 'Unknown helper operation.');
      if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); requestsInWindow = 0; }
      if (++requestsInWindow > 240 || active >= (options.maxConcurrent ?? 4)) {
        response.setHeader('Retry-After', '2');
        throw new PublicError(429, 'HELPER_BUSY', 'The helper is busy. Retry shortly.', true);
      }
      active++;
      const abort = new AbortController();
      const onClose = () => { if (!response.writableEnded) abort.abort(); };
      response.on('close', onClose);
      let deadlineElapsed = false;
      // An MV3 worker may terminate a fetch whose response takes over 30 seconds.
      const timer = setTimeout(() => { deadlineElapsed = true; abort.abort(); }, 23000);
      try {
        const startedAt = Date.now();
        const input = validateInput(await readJson(request));
        const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        const cached = cache.get(digest);
        let result: ClassificationResult;
        const cacheHit = Boolean(cached && cached.expires > Date.now());
        if (cacheHit) result = cached!.result;
        else {
          try { result = await options.classify(input, abort.signal); }
          catch (error) {
            if (deadlineElapsed) throw new PublicError(504, 'JEV_TIMEOUT', 'Jev took too long. Retry this item.', true);
            throw error;
          }
          if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
          cache.set(digest, { result, expires: Date.now() + 60 * 60 * 1000 });
        }
        respond(response, 200, { ...result, trace: { cacheHit, durationMs: Date.now() - startedAt } });
      } finally {
        clearTimeout(timer);
        response.off('close', onClose);
        active--;
      }
    } catch (error) {
      const safe = error instanceof PublicError ? error : new PublicError(500, 'HELPER_FAILURE', 'The local helper could not complete this request.');
      respond(response, safe.status, { error: { code: safe.code, message: safe.message, retryable: safe.retryable } });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 12;
  return server;
}
