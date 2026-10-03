# Dock verification — October 2, 2026

## Sorting throughput

1. Extension and helper TypeScript checks, the production build, and packaging pass.
2. The built extension passes synthetic browser integration through its actual background message API.
3. Sixteen emails complete with five overlapping Gmail requests and at most four helper requests.
4. Eight later emails complete before the first email's delayed Gmail read finishes.
5. Counters match all 37 fixture attempts and 417 estimated quota units.
6. An injected HTTP 500 adds one read attempt, one retry, one HTTP error, and 20 quota units.
7. Stop retains four decisions. Resume completes eight emails with eight total classifications.
8. Repeated groups of 12 snapshots make zero state writes. Paused elapsed time remains fixed.
9. Browser restart pauses the run, marks timing coverage partial, and sends no automatic requests.
10. After nine injected storage write failures, an existing state request saves a recoverable failed status when storage returns.
11. The UI smoke check passes elapsed-rate calculation, overlapping durations, partial and legacy data, zero elapsed time, and narrow dialogs.
12. The helper's existing extension-origin browser check passes on an isolated port. The existing listener remains unchanged.
13. Pipeline evidence: `test-results/sorting-throughput/result.json`. Reproduce with `node test-results/sorting-throughput/verify.mjs` after building.
14. UI evidence: `test-results/ui-fixture/gmail-usage.png` and `gmail-usage-mobile.png`.
15. Business rules: `docs/tests/gmail-quota.md`. Helper timing and admission contracts: `helper/README.md`.
16. No unit tests or production Gmail/Jev calls ran. Synthetic latency does not measure real mailbox throughput.
17. A user-started mailbox session must measure the actual completed rate in Gmail usage. The 240/minute figure is a theoretical ceiling before overhead.
18. A synthetic Gmail 429 during overlapping reads persists the shared cooldown and blocks later requests. Stop reaches paused in under one second.
19. All 16 fixture label updates preserve INBOX, UNREAD, and unrelated labels. No-match selects the owned Uncategorized label.

## 0.4.9 Category setup and compact editor

1. TypeScript, the production build, and packaging pass.
2. Fresh Gmail installs, preview, and Outlook use the same three blank `Edit Me!` categories.
3. `scripts/smoke.mjs` passes independent starter edits, four saved fields, compact placement, dismissal, keyboard focus, and narrow screens.
4. `scripts/ui-smoke.mjs` passes the existing Gmail navigation, connection, progress, and quota checks.
5. `scripts/clipping-smoke.mjs` passes 43 scenarios with saved category fixtures.
6. `scripts/sidebar-smoke.mjs` passes 17 scenarios, including pointer exit and keyboard focus after dragging.
7. Editor screenshots: `test-results/category-editor-1.png` and `test-results/category-editor-mobile.png`.
8. Sidebar evidence: `test-results/sidebar/0.4.9-1790983695701/report.json`.
9. Clipping evidence: `test-results/clipping/0.4.9-1790983722736/report.json`.
10. No unit tests were created or run. Browser checks use synthetic content and do not modify real mail.
11. Business rules: `docs/tests/category-editor.md` and `docs/tests/gmail-sidebar.md`.
12. Editing preserves older saved colors. Switching directly between editors discards the unsaved draft and follows the new category.

## 0.4.8 Gmail sidebar resizing

1. TypeScript, the production build, and packaging pass.
2. `scripts/sidebar-smoke.mjs` passes 15 browser scenarios with the built extension and synthetic Gmail content.
3. Dragging, arrow keys, Home, End, Escape cancellation, reload, collapse, expansion, routes, and navigation replacement pass.
4. Narrow windows limit the displayed width. Wider windows restore the saved preference. Double-click and Enter reset it.
5. `scripts/clipping-smoke.mjs --nested-toolbar` passes all 11 toolbar scenarios.
6. Sidebar evidence: `test-results/sidebar/0.4.8-1790983111133/report.json`.
7. Toolbar evidence: `test-results/clipping/0.4.8-1790983134012/report.json`.
8. The current Gmail sidebar structure was inspected. The updated extension still requires a Chrome reload before live use.
9. No unit tests were created or run. No real mail was changed by these checks.
10. Business rules: `docs/tests/gmail-sidebar.md`.

## 0.4.7 Gmail quota observability

1. The extension TypeScript check and production build pass.
2. Quota counters match every synthetic Gmail request by method, unit cost, outcome, and retry.
3. Authentication, server, and network retries pass through the built extension's actual runtime API.
4. Stop during a quota wait adds no request. Resume and an actual Chromium restart preserve counters.
5. New runs reset counters and retain 20 previous summaries. Legacy resumes show partial tracking.
6. Outside-run label refreshes leave run totals unchanged. Public snapshots exclude private run fields.
7. `scripts/ui-smoke.mjs` passes for quota totals, history selection, legacy and partial states, narrow layouts, and keyboard focus.
8. `scripts/clipping-smoke.mjs --nested-toolbar` passes 11 toolbar layout scenarios.
9. No unit tests were created or run. All Gmail and helper responses were synthetic.
10. Quota evidence: `test-results/quota-observability/run-1790981993653/evidence.json`.
11. UI evidence: `test-results/ui-fixture/gmail-usage.png` and `gmail-usage-mobile.png`.
12. Toolbar evidence: `test-results/clipping/0.4.7-1790981930893/report.json`.
13. Business rules: `docs/tests/gmail-quota.md`.
14. Reproduce quota E2E checks with `node test-results/quota-observability/verify.mjs` after building the extension.

## 0.4.6 cleanup

1. Extension and helper TypeScript checks pass.
2. The production extension build passes.
3. `scripts/smoke.mjs` passes for Gmail, four Outlook hosts, and the standalone preview.
4. Demo category deletion preserves sample messages under Uncategorized after reload.
5. `scripts/ui-smoke.mjs` passes for native Gmail routes, account selection, keyboard controls, connection errors, progress, Stop, and resume.
6. `scripts/clipping-smoke.mjs` passes all 43 layout scenarios with no page errors or unexpected requests.
7. The mobile preview screenshot retains wrapped categories and controls without horizontal overflow.
8. An isolated copy of the built extension passes eight categorization checks through actual `dock:api` messages.
9. The synthetic five-message run produces two successes, one retained-decision failure, and two skips.
10. Multipart decoding preserves text, decodes HTML and external text bodies, and excludes file attachments.
11. Label mutations preserve Inbox, unread state, unrelated labels, and the selected target label.
12. Resume reuses saved decisions when categories match and reclassifies unfinished work when definitions change.
13. Stop pauses a quota wait before another Gmail request. Label refresh respects persisted pacing.
14. Category creation, editing, deletion, import, duplicate names, and missing IDs pass through the extension API.
15. Packaging excludes credentials, dependencies, and browser profiles. Each ZIP entry is compared with its source file.
16. Jev questions, the pinned model, retry settings, extension identity, and OAuth permissions remain unchanged.
17. Current business rules remain in `docs/tests/gmail-navigation.md` and `docs/tests/gmail-toolbar.md`.
18. This cleanup uses synthetic mail and API responses. It does not recheck live Gmail or Jev service behavior.
19. No unit tests were created or run. No real mail was classified or modified.
20. Layout evidence: `test-results/clipping/0.4.6-1790980493227/report.json`.
21. Categorization evidence: `test-results/cleanup-pipeline/run-1790980846529/evidence.json`.

## Reproduce

1. Run the extension checks from the project root:

```powershell
npm ci
npm run typecheck
npm run build
npm run package
# Set CHROMIUM_EXECUTABLE if Playwright's default Chromium is unavailable.
node scripts/smoke.mjs
node scripts/ui-smoke.mjs
node scripts/clipping-smoke.mjs
```

2. Run the helper check from `helper`:

```powershell
npm ci
npm run typecheck
```

3. The temporary categorization harness is `test-results/cleanup-pipeline/verify.mjs`. It loads a copied extension and synthetic API responses.
4. Live Jev verification remains an explicit command: `npm run verify:jev` from the configured helper.
