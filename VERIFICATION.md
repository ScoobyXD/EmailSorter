# Dock verification — October 2, 2026

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
