# Dock 0.4.7 — manual Gmail categories

Dock adds category tabs inside Gmail. Press **Categorize emails** to classify only messages currently in Inbox received within the selected date window (30 days by default). There is no schedule, new-mail watcher, overnight worker, or urgency ranking. Outlook and the standalone preview remain sample-only.

## Project location

The project root is `C:\Users\Jonat\Dock`. Source code, build configuration, and development commands live here. The installed extension is in `outputs\dock-extension`; the configured local helper is in `outputs\dock-helper`. Its existing private configuration was preserved during relocation.

The old Codex workspace paths forward to this project for compatibility with the installed extension and existing launchers. Do not remove/reinstall the extension to relocate it: the compatibility path preserves its current installation and saved browser state. Use this new project root for future development.

## Update the installed Dock

1. The existing `outputs\dock-extension` folder contains **0.4.7**. Reload **Dock — Gmail Categories** in `chrome://extensions`, then refresh Gmail.
2. Keep the same installed extension (`ccklhlnpillicildcgbdfibggkkhkdib`) to preserve saved categories and checkpoints.
3. Categorize emails, the days slider, progress, resume, and errors share Gmail's top action toolbar, above the category tabs.
4. The toolbar omits the scope and account text. Connection settings still show the connected account.
5. Gmail labels use category titles only. The next start or resume renames existing Dock labels and preserves their message memberships.
6. A conflicting Gmail label name stops the run. Rename that label or the Dock category, then retry.
7. Reloading does not start categorization. Keep **Resume unfinished** checked and press **Categorize emails** to continue the saved run.
8. Gmail layouts with a narrow native action group use its shared toolbar row. Controls sit between the three-dot menu and pagination.
9. Label renaming covers current saved categories and Uncategorized. Untracked duplicates and removed categories require separate cleanup.
10. Dock controls stay in Gmail's sticky toolbar while scrolling. Buttons receive clicks above Gmail's toolbar decoration.
11. **Gmail usage** shows quota units by operation for the current run and the latest 20 previous runs.
12. Usage includes request attempts, retries, and errors. Resume keeps the same counters. Older runs can show unavailable or partial tracking.
13. Units are estimates from Google's method costs. They are not confirmed billing totals. See [Gmail quota rules](docs/tests/gmail-quota.md).

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

1. **+** opens the category editor. **Edit**, **×**, and F2 edit or remove categories. IDs and colors survive renames and restarts.
2. Jev receives category descriptions and each email's sender, subject, and decoded body. Email text is untrusted data. No match becomes **Uncategorized**.
3. Each email gets one Dock label. Reassignment removes only other Dock labels. Inbox, unread state, and unrelated labels remain intact.
4. Gmail displays the category title as a colored label. Dock tracks ownership with saved label IDs. Refresh Gmail after a run if label changes are not visible.
5. Category tabs open Gmail's native label views. Matching accounts keep the current Gmail page. Other accounts use account-qualified links.
6. Gmail handles message display, conversation grouping, pagination, selection, and email actions. Dock does not fetch email details when a category opens.
7. Native Gmail controls retain their behavior. Tabs wrap when needed. Unrecognized toolbar layouts place controls in a separate row above the categories.
8. **× → Yes** removes the category and its Gmail label. Emails and unrelated labels remain. A future manual run can categorize those emails again.
9. Label names refresh once when Dock loads and after connection or import. Saved IDs identify legacy labels with hashed names.
10. The Inbox shortcut, Back, and Forward use Gmail navigation. Dock tabs remain available on label lists.

## Progress, interruption, and limits

Runs page through the selected Inbox window and process at most three messages concurrently. The date boundary is fixed at the run's start; messages are checked again before classification. Full email bodies are never saved in extension storage or helper logs.

1. Gmail API calls share a saved quota schedule for categorization, account checks, and label-name refreshes.
2. Reading a message uses 20 quota units. Applying its label uses 5 units. Each separately stored text-body fetch uses 20 units.
3. Category navigation uses Gmail directly and makes no Dock API request.
4. Rate-limit cooldowns survive worker restarts. Categorization resumes only after an explicit user action.

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
npm run build
npm run package
```

The extension build is `.output/chrome-mv3`; the packager writes deliverables into this project's `outputs` folder and excludes helper `.private`, environment files, dependencies, test profiles, and generated source artifacts. The helper has its own package and typecheck:

```powershell
cd helper
npm ci
npm run typecheck
```

Browser smoke tests use an isolated Chromium profile, synthetic Gmail/Outlook pages, and mocked API data. They never load your real mailbox. See the delivered `VERIFICATION.md` for the exact checks run and remaining live-verification limits.

