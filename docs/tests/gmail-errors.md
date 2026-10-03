# Gmail email error rules

1. The errors dropdown shows full run errors and each failed email's saved error.
2. Failed emails retain their message ID, subject, and sender when those headers are available.
3. Opening the dropdown loads missing headers for older failures. It does not start or resume categorization.
4. An unavailable email keeps its saved error and message ID link.
5. Message links use the saved run's Gmail account. In-place navigation requires a matching account.
6. Error details fit inside the viewport and scroll independently of Gmail's toolbar.
7. Escape closes the dropdown and restores focus to its trigger. Outside clicks also close it.
8. The synthetic browser check is `node scripts/error-smoke.mjs`. It intercepts every browser request.
