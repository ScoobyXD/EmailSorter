# Dock 0.4.4 — manual Gmail categories

Dock adds category tabs inside Gmail. Press **Categorize emails** to classify only messages currently in Inbox received within the selected date window (30 days by default). There is no schedule, new-mail watcher, overnight worker, or urgency ranking. Outlook and the standalone preview remain sample-only.test

## Project location

The project root is `C:\Users\Jonat\Dock`. Source code, build configuration, and development commands live here. The installed extension is in `outputs\dock-extension`; the configured local helper is in `outputs\dock-helper`. Its existing private configuration was preserved during relocation.

The old Codex workspace paths forward to this project for compatibility with the installed extension and existing launchers. Do not remove/reinstall the extension to relocate it: the compatibility path preserves its current installation and saved browser state. Use this new project root for future development.

## Update the installed Dock

The existing `outputs\dock-extension` folder now contains **0.4.4**. After an active run finishes or you stop it, reload **Dock — Gmail Categories** in `chrome://extensions`, restart the local helper using the same `Start-Dock-Helper.cmd`, and refresh Gmail. Keep the same installed extension (`ccklhlnpillicildcgbdfibggkkhkdib`); removing it would clear its saved categories and checkpoints. The updated helper keeps its existing pairing and API configuration.

This update adds **Run logs** beside Connection: a live timeline, run history, event search, detailed request/decision records, and JSON export. Browser events are copied automatically to local helper files when it is reachable. A storage indicator distinguishes browser-only events from acknowledged file copies. Logs use message IDs; subjects, senders, bodies, and credentials are excluded.

The 0.4.3 navigation fix is included: category emails open within the current Gmail page instead of reloading Gmail. Normal clicks and Enter use Gmail's conversation routing when the visible Google account (or email-valued `authuser`) matches Dock's connected account. Ctrl/Cmd-click and other modified clicks keep normal browser link behavior. If the current account differs or cannot be identified, the account-qualified link still selects the connected account. Browser Back returns to the previous Gmail route.

The 0.4.2 rate-limit recovery remains included. Reloading does not start categorization; leave **Resume unfinished or failed messages** checked and press **Categorize emails** to continue a saved run.

## First installation

1. Open Chrome's Extensions page (`chrome://extensions`) and enable **Developer mode**.
2. If the older **Dock — Inbox UI Prototype** is installed, export its categories using the migration steps below, then disable it. Do not run both versions together.
3. Choose **Load unpacked** and select:

   `C:\Users\Jonat\Dock\outputs\dock-extension`

   Select the folder containing `manifest.json`, not its parent and not the ZIP.
4. Confirm the new extension ID is `ccklhlnpillicildcgbdfibggkkhkdib`. Its fixed public key keeps this ID stable when the folder moves.
5. Refresh Gmail. Open **Connect Gmail**, choose **Authorize Gmail**, and authorize the intended account. Check the connected email address shown above the inbox before a run. Chrome's Google identity can differ from the account in the current Gmail tab.
6. Set up and start the Jev helper below; pair it in the same connection dialog.
7. Review category descriptions with **Edit**, choose the days-back window, then press **Categorize emails** when ready.

This is a new extension identity. Reloading the old prototype from the `hey-q` output folder will not install this version. For subsequent updates to this new version: replace its unpacked files, click its reload arrow on Chrome's Extensions page, then refresh Gmail. Do not remove/reinstall it, which clears its local definitions and checkpoints.

The shipped source and extension contain only a public OAuth client ID and public extension key. They contain no Jev key or helper pairing secret.

## Observe and investigate a run

Open **Run logs** in Gmail. **How sorting works** explains the pipeline and quota costs. Select the current or an older run, or **All activity** to include browsing and connection operations. Events appear newest first and update every two seconds without Gmail API calls. Search loaded events by message ID, request ID, stage, or error; use **Load older** to include earlier events. Expand any row for its structured record. **Export JSON** exports all retained events in the selection, independent of the visible page and filter.

The timeline records:

1. The manual command, fixed date window, category rules, discovery pages, and label setup.
2. Each email's ID, Inbox/date eligibility, decoded text size, classification call, returned category and probability scores, model and token usage, and cached-result reuse when reported by the helper.
3. The decision checkpoint before the label request, exact label additions/removals, Gmail response, and successful checkpoint afterward. If a request's response is lost, its outcome is shown as unknown until subsequent recovery establishes it.
4. Every Gmail attempt with a correlation ID, operation, estimated quota cost, HTTP status/error reason, duration, pacing wait, shared cooldown, and retry. Category preview requests use the same budget and are logged too.
5. Stops, restarts, resumes, deferred/skipped/failed emails, and the final counts. Reading logs does not start or resume email processing.

These are operational traces and returned model results, not a transcript of hidden model reasoning. Quota units are estimates based on published per-method costs, including attempted requests; they are not Google's actual remaining quota balance. Events before this version was installed cannot be reconstructed. A resumed older run records its saved counts and all new steps.

**Your logging preference is message IDs only.** Email subjects, senders, bodies, snippets, account addresses, and credentials are omitted. Logs retain your configured category titles/descriptions and model outputs so decisions can be compared against the rules used. Oversized or invalid diagnostic text is normalized with a truncation marker; logging/storage failures are shown as coverage warnings rather than silently reported as complete.

The browser journal survives page refreshes and worker restarts. It normally retains 100,000 events plus any unmirrored backlog, and up to 100 recent run summaries. Only events already acknowledged by the helper may age out. The helper appends JSON Lines files under:

`C:\Users\Jonat\Dock\outputs\dock-helper\.private\run-logs\<journal-namespace>\<run-id>.jsonl`

If the source helper is running, its corresponding folder is `C:\Users\Jonat\Dock\helper\.private\run-logs`. Activity outside runs uses dated activity files. Recovery segments preserve interrupted writes. Helper files are not automatically deleted, and packaging excludes/preserves the entire `.private` directory. **Log storage** shows the exact active destination and acknowledgment status. If it says the old helper lacks logging, restart the updated helper and select **Retry local copy**. Pending browser events will be copied; no mail needs to be processed to sync logs.

For later investigation, Codex can read those local files directly. From the project root:

```powershell
npm run logs:read
npm run logs:read -- --run RUN_ID
npm run logs:read -- --message MESSAGE_ID
node scripts/read-run-logs.mjs --run RUN_ID --json
```

The reader summarizes steps, all recorded problems, request costs, and the latest events. It combines recovery segments, identifies malformed/conflicting records, and reports incomplete coverage instead of treating gaps as success. Export a run from the UI to share it deliberately; generated extension/source/helper packages contain no run logs.

## Start the local helper

Requires Node.js **22.18+** (Node 24 supported). Use the delivered `dock-helper` folder, or extract `Dock-helper.zip` into a private local folder.

1. Run `Setup-Dock-Helper.cmd`. It installs the locked TypeSafe SDK, accepts your Jev API key with hidden input, and copies the new pairing code to the clipboard.
2. Run `Start-Dock-Helper.cmd`. Keep that terminal open while categorizing; Ctrl+C stops it.
3. In Gmail, open **Connect Gmail** / **Connection**, paste the code into **Helper pairing token**, and press **Pair helper**. Use `Copy-Pairing-Code.cmd` to copy it again later.

The pairing code is different from the Jev API key. Never paste the Jev key into the extension. For importing the existing command-example file without displaying or executing it, run from the helper folder:

```powershell
node src/setup.ts --key-file "C:\path\to\jev api commands.txt"
```

The helper stores secrets in its local `.private` directory, which is excluded from every package. Keep it private and do not share it. The service binds only `127.0.0.1:38471` and requires both the fixed Dock extension origin and its random pairing bearer. It is not a general network proxy. Nothing starts automatically at login.

## Google setup already prepared

A separate project **Dock Gmail Organizer** (`dock-gmail-organizer-20261001`) was created for this version. Gmail API is enabled; Audience is **External**, publishing status is **Testing**, and `jonathankim829@gmail.com` is a listed test user. The Chrome Extension OAuth client is tied to the fixed extension ID above. The existing Mango project was not modified.

- [Audience and test users](https://console.cloud.google.com/auth/audience?project=dock-gmail-organizer-20261001)
- [OAuth clients](https://console.cloud.google.com/auth/clients?project=dock-gmail-organizer-20261001)
- [Data Access](https://console.cloud.google.com/auth/scopes?project=dock-gmail-organizer-20261001)

The only requested OAuth scope is `https://www.googleapis.com/auth/gmail.modify`. This is a **restricted permission**. Google's grant also permits broader actions, including composing/sending and other mailbox changes. Dock's implemented API paths only read mail and create/update/remove its own category labels; they do not send, copy, archive, trash, or delete messages. It is not read-only authorization.

Testing Gmail authorization expires after **seven days**. Open **Connection → Reconnect Gmail**, grant access again, then press **Categorize emails** with the resume option to continue unfinished work. Reconnecting alone does not classify mail. Google configuration changes can take several minutes to propagate. Sign-in or account-security prompts must be completed in your browser.

This client uses `chrome.identity.getAuthToken` with the **Chrome Extension** OAuth client type. There is no localhost OAuth redirect or client secret. The helper does not handle Google tokens. The local helper port is only for Jev classification. No paid hosting, cloud database, or production publication was set up. After publishing to the Chrome Web Store, update the OAuth client with the store-assigned extension ID.

## Categories and email behavior

- **+** opens a compact title/description/icon editor. **Edit** and **×** appear on hover or keyboard focus; F2 edits a focused category. Category IDs and colors survive renames and browser restarts.
- Descriptions are supplied to Jev alongside each message's sender, subject, and decoded text body. Email text is untrusted classification data. The current categories become Choice options; a no-match outcome becomes **Uncategorized**. No urgency question is sent.
- Each email gets one Dock category label, or Dock's Uncategorized label. Dock removes only its other category memberships during reassignment. Inbox, unread state, and unrelated labels remain intact.
- Labels use Gmail-supported colors and `messageListVisibility: show`, so Gmail renders native colored labels in Inbox and All Mail. There are no extra decorative chips. Refresh Gmail if its own list has not refreshed after a run. A short ownership suffix in label names distinguishes Dock labels from unrelated labels with similar titles.
- A category tab shows real labeled messages, including labeled messages outside the latest run's date window. Rows open the original Gmail conversation in place when the tab's account matches the connected account; account-qualified links remain available for other accounts and new tabs. **Load more messages** pages through results; sort applies to loaded messages.
- Native Primary, Promotions, Social, and Updates controls retain their existing elements and interactions. Tabs wrap when needed. Gmail's DOM is not a supported public API; unfamiliar layouts use a separate row within the inbox.
- **× → Yes** removes that category and its app-owned Gmail label/memberships. It preserves every email and unrelated label. **No** cancels. Removing a category does not automatically move messages into Uncategorized; a future manual run can classify them again.

## Progress, interruption, and limits

Runs page through the selected Inbox window and process at most three messages concurrently. The date boundary is fixed at the run's start; messages are checked again before classification. Full email bodies are never saved in extension storage or helper logs.

Gmail calls share a persisted quota schedule across sorting, account verification, and category browsing. Ordinary sorting uses 20 units to read a message and 5 to apply its label. Each separately stored text-body fetch adds 20 units; a full 30-message category preview uses about 606 units. The pacing target allows roughly 192 simple sorts/minute before these extra calls and classifier/network latency. See [Google's quota table](https://developers.google.com/workspace/gmail/api/reference/quota). Rate-limit cooldowns and pacing timestamps survive worker restarts, but restarting still requires an explicit resume.

Progress and classification decisions are checkpointed before label changes. Gmail label mutations are idempotent, and lost label-creation replies are reconciled before retrying. The exact Jev choice, probability distribution, confidence, model, and usage are retained for pending work and a bounded recent history. An interrupted browser/service worker pauses; it never restarts classification on its own.

Use **Stop** to stop a run. Already completed labels remain. With an unfinished run, the resume checkbox defaults on: pressing **Categorize emails** retries unfinished/failed messages while retaining completed work. Clear that checkbox to start a fresh window; a fresh run can recategorize previously labeled messages using the current descriptions. Changing a title/description alone does not classify mail.

This private prototype supports up to 50 categories and windows of 1–365 days, with a maximum of 50,000 discovered messages per run. Very large inputs fail visibly instead of being silently truncated: a decoded email body over 60,000 characters, an oversized category set/request, or Jev's model token limit can produce a failed item. Stop, shorten the scope or descriptions where appropriate, and retry. File attachments are not classified; Gmail's externally stored text-body parts are decoded.

## Move categories from the old prototype

Local storage is isolated by extension identity. In-place version-1 data migrates automatically; moving from the earlier path-derived extension ID requires an explicit definition import:

1. Before disabling the old prototype, open its **service worker** link in `chrome://extensions` with Developer mode enabled.
2. In that extension's DevTools Console, run this read-only export of category definitions:

```javascript
const oldDock = (await chrome.storage.local.get('dock-demo-v1'))['dock-demo-v1'];
copy(JSON.stringify({ version: 1, categories: oldDock?.categories ?? [] }));
```

3. In the new Dock, open **Connection → Import or export categories**, paste into **Category JSON**, and choose **Import categories**.
4. Use **Edit** to supply descriptions for imported categories before running. Import keeps their IDs, drops the cancelled old Urgent special category, and does not import sample messages or credentials.

Imports merge definitions without deleting omitted categories or any Gmail labels. The same dialog provides a version-2 definitions export for future backups. Copy it somewhere private; label memberships remain in Gmail itself.

## Develop and package

Extract `Dock-source.zip` and run:

```powershell
npm ci
npm run typecheck
npm run test:engine
npm run build
npm run package
```

The extension build is `.output/chrome-mv3`; the packager writes deliverables into this project's `outputs` folder and excludes helper `.private`, environment files, dependencies, test profiles, and generated source artifacts. The helper has its own package and typecheck:

```powershell
cd helper
npm ci
npm run typecheck
npm test
```

Browser smoke tests use an isolated Chromium profile, synthetic Gmail/Outlook pages, and mocked API data. They never load your real mailbox. See the delivered `VERIFICATION.md` for the exact checks run and remaining live-verification limits.

