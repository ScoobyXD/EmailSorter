# Dock local Jev helper

This helper sends a message's sender, subject, decoded text body, and your current category descriptions to Jev only when Dock requests classification during a manual run. It does not read Gmail itself, schedule work, send mail, or store email bodies. Gmail authorization remains in the extension.

## Start on Windows

Requires Node.js 22.18 or newer (Node 24 is supported). The source runs directly; there is no separate build step.

1. Double-click `Setup-Dock-Helper.cmd`. It installs the locked runtime dependency, asks for your Jev API key with hidden input, and copies a newly generated pairing code to your clipboard.
2. Paste that pairing code in Dock's settings. The extension ID must be `ccklhlnpillicildcgbdfibggkkhkdib`.
3. Double-click `Start-Dock-Helper.cmd` and leave its terminal open while categorizing. Stop it with Ctrl+C. Nothing starts automatically at login.
4. Use `Copy-Pairing-Code.cmd` if you need to copy the code again. Updating the Jev key through setup preserves your existing pairing code; stop and restart the helper to use the new key.

Equivalent commands from this directory:

```powershell
npm ci --omit=dev
npm run setup
npm start
```

To import the user's own API command examples file without displaying or executing it:

```powershell
node src/setup.ts --key-file "C:\path\to\jev api commands.txt"
```

The parser accepts a single distinct explicit `TYPESAFE_API_KEY`/`JEV_API_KEY`, `apiKey`/`api_key`, or `Authorization: Bearer` value. For several keys or unusual examples, use interactive setup. Never paste your Jev API key into the extension's pairing field.

## Local credentials

`.private/config.json` contains the Jev API key and a 256-bit pairing token. `.private/pairing-code.txt` contains only that pairing token. Keep this directory private to your Windows account; neither file belongs in an extension package, source archive, shared folder, or source control. The API key never travels to the extension. The pairing token grants use of this helper, so keep it private too. Delete `.private` and rerun setup to rotate it.

The helper binds only `127.0.0.1:38471`. Requests require the exact extension Origin, the exact loopback Host, and the pairing bearer. Unrelated websites, missing/null origins, other extensions, form/text posts, oversized bodies, and unknown operations are rejected. Only the paired origin receives CORS/PNA permission. No arbitrary URL proxy exists. The SDK endpoint is fixed to `https://api.typesafe.ai`; its request/body logging is disabled.

## HTTP contract

`POST /health` (JSON body `{}`) and `POST /classify` both require `Authorization: Bearer <pairing code>` and `Origin: chrome-extension://ccklhlnpillicildcgbdfibggkkhkdib`. A GET health request is also accepted only with the same origin and authentication; use POST in the extension because Chromium omits Origin on its worker's GET requests.

```json
{
  "message": { "sender": "sender@example.test", "subject": "Subject", "body": "Decoded email text" },
  "categories": [{ "id": "stable-id", "title": "Category", "description": "What belongs here" }]
}
```

The response is `{categoryId, model, answer, usage, timing?}`. `answer` preserves Jev's exact `type`, `choice`, `confidence`, and complete `probabilities`. `usage` preserves input/output token counts. The Choice criterion keys are the stable category IDs, with `__uncategorized__` added for no match. That outcome maps only `categoryId` to `null`; the original answer remains unchanged. No confidence threshold or urgency classification changes the model's choice.

1. `/health` includes `rateLimit: {resetAt, remaining, active}`. `resetAt` is an epoch timestamp in milliseconds.
2. The helper admits at most four concurrent requests and 240 requests per minute. Rejected busy requests do not consume that allowance.
3. A 429 response exposes `Retry-After`. Rate exhaustion returns the remaining window duration, rounded up to seconds.
4. `timing.jevRequestMs` measures the SDK call with a monotonic clock. It includes internal retry delays.
5. `timing.jevSdkCalls` counts SDK calls. `timing.jevRetries` is `null` because the SDK does not report actual retries.
6. Cached responses set `timing.cacheHit` to `true` and report zero SDK calls and zero SDK duration.
7. Error responses include timing when an SDK call occurred. Timing uses the existing response and adds no separate writes or requests.
8. Admitted classification responses expose `X-Dock-Rate-Limit-Reset`. The extension uses this epoch timestamp to align later rate windows.

Up to 100 current categories are accepted. ID/title/description limits are 100/120/1000 characters; sender/subject/body limits are 2048/4000/60000 characters. Total validated JSON must be at most 90 KiB; HTTP request bodies are limited to 128 KiB. Oversize items fail visibly rather than being silently truncated. Jev can also reject inputs exceeding its token limit. Four simultaneous requests and 240 requests per minute are allowed; excess returns 429. The SDK retries transient faults up to twice with bounded delays within a 23-second total deadline (15 seconds per attempt), while disconnecting/canceling aborts the in-flight request. This deadline stays below Chrome MV3's 30-second fetch-response limit. A one-hour, 2,000-entry memory-only result cache reduces repeated requests after retries; it stores hashes and answers, never source email text. Restart clears that cache. The extension persists completed categorization and handles Gmail label retries separately.

Errors return `{error:{code,message,retryable},timing?}`. Messages are safe fixed text, with no upstream response body or credentials.

## Verification

```powershell
npm ci
npm run typecheck
```

To make one live request with invented email text only, explicitly run `npm run verify:jev` after setup. This does not access Gmail.

Implementation follows the [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript), [Choice primitive](https://docs.typesafe.ai/primitives/choice), and [classification cookbook](https://docs.typesafe.ai/cookbooks/classification_using_confidence), read during development. The model is pinned to `jev-1.13.0`; the response records the actual model ID.
