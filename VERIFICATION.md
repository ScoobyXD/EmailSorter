# Dock 0.4.3 verification

Unit test suites were removed on October 2, 2026. Earlier unit test results below are historical records. Current checks use TypeScript, production builds, and browser smoke scripts.

## 0.4.3 category conversation navigation — October 2, 2026

Category rows previously followed `https://mail.google.com/mail/u/?authuser=...#all/...`, changing the account path/query from the current Gmail document and causing a full page load. Ordinary primary clicks and Enter now close the category overlay and set only the conversation hash when the current Gmail account matches Dock's connected account. The account is checked at click time using the native Google account badge, with email-valued `authuser` as a fallback. Different or unidentified accounts retain the account-qualified link. Modified clicks keep browser link behavior without clearing the category selection.

- TypeScript and the 0.4.3 production build pass.
- The Chromium React UI suite passes, including actual pointer and Enter navigation, unchanged document identity/account path/query, no extra document request, browser Back, closed category overlay, Ctrl/Meta/Shift/Alt and middle clicks, account badge label/title/case matching, email-valued `authuser`, conflicting identities, and unknown numeric accounts. Synthetic fixtures report zero unexpected requests or page errors.
- Read-only inspection of the user's Gmail tab confirmed its native account badge has the exact link/accessible-label structure used by the account check. The live categorization run was still active, so the installed extension and Gmail tab were not reloaded and a live conversation click was not performed. After the run finishes, reload Dock in Chrome's Extensions page, then refresh Gmail to activate 0.4.3.
- The extension identity, permissions, storage schema, categorization engine, and helper are unchanged. The source and packaged extension include the fix.

## 0.4.2 Gmail rate-limit recovery — October 2, 2026

The reported 95-email interruption matched the old recognized quota-403 branch, which retried for only 2.8 seconds without a Retry-After header and then failed the run. The original Google payload was discarded, so the precise quota dimension and extra requests from that session cannot be reconstructed from the screenshot.

- All Gmail calls now pass one scheduler, including account checks, category metadata, externalized message bodies, and retries. Weighted pacing targets 4,800 units/minute. Quota responses share a persisted cooldown of at least 60 seconds, respect Retry-After seconds or HTTP dates, and retry up to six times. Permanent failures retain Google's reason/message.
- **24/24 engine tests pass**, including nine new rate-limit regressions: transient and permanent 403s; Retry-After formats; bounded retry exhaustion; shared 429 cooldown; a 250-message run plus externalized bodies and category metadata under the shared budget; pacing across worker restart; Stop/resume during cooldown; and a category-preview wait concurrent with Stop. All calls use synthetic fixtures.
- TypeScript and the production build pass. The focused Chromium UI fixture passes with a visible rate-limit countdown, enabled Stop, saved progress, resume, and completion. The countdown screenshot was visually inspected. Zero unexpected external requests or page errors.
- The patch uses the existing extension identity and storage schema version, retaining saved categories, finished items, and pending decisions. The helper and its credentials require no changes. The patch was not tested against the user's live mailbox; reloading the extension and refreshing Gmail is needed before explicitly resuming the saved run.

The following sections document earlier verification and setup history.

Base version verified on October 1, 2026; layout patch verified on October 2, 2026 (America/Los_Angeles).

## 0.4.1 layout patch

The user's 0.4.0 screenshot showed category tabs but no buttons or days slider. The old build reproduced that failure in a synthetic Gmail fixture with nested 58px, overflow-hidden category wrappers: controls existed in the DOM but failed pointer hit tests and overlapped native mail.

Controls, scope, connection state, and progress now render in a separate shadow host in normal flow after the tab-only header. Tab-only wrappers and the owned table cell can grow with wrapped categories. A mixed-content clipping wrapper uses a separate Dock row before that main branch. Native category elements and handlers remain intact; route changes restore the original styles. The category view starts below both tabs and controls, and removed hosts are repaired.

- **28 layout scenarios pass** on the final built extension. Every category tab, Add, Categorize emails, days slider, and Connect Gmail passes center and four-corner hit tests plus clipping-ancestor checks. Scenarios include nested fixed-height wrappers, direct TABLE and DIV max-height limits, mixed-content fallback, wide/narrow windows, native category routes, All Mail restoration, wrapper replacement, removal of either host, and saved account/paused-run notices. Native message rows remain below Dock; native handlers still run.
- TypeScript, the production build, the complete Gmail/four-Outlook browser smoke suite, and the focused React UI suite pass. These use synthetic data and report zero page errors or unexpected external requests. The unchanged engine/helper tests listed below remain the verified 0.4.0 baseline.
- Wide and narrow fixture screenshots were visually reviewed; all categories, including Invoices, Uncategorized, and Add, remain visible. Delivered examples: `Dock-layout-wide.png` and `Dock-layout-narrow.png`.
- The public extension key, extension ID, OAuth client and scopes match 0.4.0. Existing helper private files retain their original hashes and are excluded from the archives. Package checksums are regenerated with every packaging run.

The same installed unpacked folder contains 0.4.1. Reload **Dock — Gmail Categories** in Chrome's Extensions page, then refresh Gmail. Do not remove/reinstall. No real mailbox was read or categorized during this fix; final live Gmail layout confirmation awaits that reload.

## Completed checks

- Production WXT/React/TypeScript extension builds successfully. Browser and helper TypeScript checks pass.
- **15 Gmail engine fixture tests pass.** They cover manual-only execution, 30-day/date bounds and Inbox scope, paging/deduplication, concurrency, current arbitrary categories and no match, exact Choice checkpointing, lost label-creation replies, retry without repeating completed work, Stop/resume, service-worker restart, safe deletion, legacy import, OAuth failures, account-token switching, bounded offline pause, and MIME decoding.
- **12 helper tests pass.** They cover the installed TypeSafe JavaScript SDK v1 request/response contract, raw probability/confidence preservation, untrusted email state, validation, retries, sanitized errors, strict Origin/Host/bearer rules, CORS/preflight, size limits, result caching, cancellation, concurrency, and parsing the user's explicitly selected key file without executing it.
- A real isolated Chromium MV3 worker successfully makes authenticated **POST /health** and **POST /classify** calls to the loopback helper with a synthetic pairing token and mocked model. This verified Chrome's actual extension Origin behavior and the port-specific host permission. No real API key or Gmail message was used.
- **Built-extension browser smoke passes** on synthetic Gmail and four Outlook host fixtures: native tab identity/handlers, SPA replacement and routes, fonts/icons, compact edits, descriptions, duplicate validation, keyboard/cancel behavior, Yes/No deletion, storage persistence, legacy definition import, credential-free export, interrupted-run recovery, connected-account visibility, manual-only controls, preview/provider switching, and responsive layout. Zero page errors or unexpected external requests.
- **Focused React UI fixture passes:** original Gmail conversation URLs select the connected account; unread state, paged message deduplication/order, API-error recovery, OAuth denial, manual start, polling progress, Stop, resume, and completion. Zero external requests or page errors.
- Native label API fixtures verify supported stable colors and `messageListVisibility: show`/`labelListVisibility: labelShow`. The browser fixture preserves an existing colored native label on Inbox/All Mail routes without inserting duplicate decorations.
- The three delivered ZIP archives open successfully and every entry is readable. Private configuration, environment files, dependency directories, and browser test profiles are excluded.

## External setup completed

Created the separate **Dock Gmail Organizer** project (`dock-gmail-organizer-20261001`), enabled Gmail API, configured Google Auth Platform **External / Testing**, added the intended Gmail account as a test user, and created the Chrome Extension OAuth client for `ccklhlnpillicildcgbdfibggkkhkdib`. Data Access contains only `gmail.modify`. The client ID is embedded in the extension's public manifest configuration. The existing Mango project was not modified. No production publishing, hosting purchase, or database setup was performed.

The Google API Services User Data Policy was accepted after the user's explicit confirmation. The configured Cloud screen is included as `Dock-google-setup.jpg`.

## Still requires user interaction or live validation

- The specific approximately named `jev api commands.txt` file was not located in targeted discovery. Provide its full path (not its contents/key), or use `Setup-Dock-Helper.cmd` to enter the key privately. No Jev API key is configured in the delivered helper.
- The user has installed Dock 0.4.0 with the correct extension ID. After this patch, reload that existing extension through Chrome's Extensions page, then refresh Gmail. Complete **Authorize Gmail** in the visible connection dialog when ready. Installation was confirmed by the user's extension screenshot; the 0.4.1 live layout still needs confirmation after reload.
- Live Gmail OAuth consent/token acquisition, a real Gmail-to-Jev classification, and the resulting colored rows in the actual mailbox are **not yet verified**. No real mail was categorized, sent, copied, archived, trashed, or deleted.
- To validate Jev credentials without accessing Gmail, run `npm run verify:jev` from the configured helper. It sends one invented email fixture. For real Gmail validation, the user should choose a small days-back window and press **Categorize emails**, then inspect Inbox and All Mail and open a category tab. Gmail may need a refresh to display native label updates.
- Testing authorization expires after seven days; the UI's **Connection → Reconnect Gmail** path obtains a new grant. A reconnect does not automatically run classification.

## Reproduce

From the extracted source root:

```powershell
npm ci
npm run typecheck
npm run build
npm run package
$env:CHROMIUM_EXECUTABLE = 'C:\Users\Jonat\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe'
node scripts/smoke.mjs
node scripts/ui-smoke.mjs
node scripts/clipping-smoke.mjs
```

From its `helper` subdirectory:

```powershell
npm ci
npm run typecheck
```

Use a Chromium executable installed on your machine if the example path differs. These automated fixtures are isolated from the live mailbox.
