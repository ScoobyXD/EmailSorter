# Gmail email error rules

1. The errors dropdown shows full run errors and each failed email's saved error.
2. Failed emails retain their message ID, subject, and sender when those headers are available.
3. Opening the dropdown loads missing headers for older failures. It does not start or resume categorization.
4. An unavailable email keeps its saved error and message ID link.
5. Message links use the saved run's Gmail account. In-place navigation requires a matching account.
6. Error details fit inside the viewport and scroll independently of Gmail's toolbar.
7. Escape closes the dropdown and restores focus to its trigger. Outside clicks also close it.
8. The synthetic browser check is `node scripts/error-smoke.mjs`. It intercepts every browser request.

## 0.4.14 merge verification

1. Main includes the error dropdown and sorting throughput changes. Existing toolbar, sidebar, and day-range edits remain present.
2. TypeScript, the production build, the error dropdown check, and the toolbar UI check pass.
3. The packaged extension passes the editor smoke check and all 44 clipping scenarios.
4. Browser fixtures reload the worker after direct storage seeds. Product caching remains unchanged.
5. No unit tests or production Gmail/Jev calls ran.
