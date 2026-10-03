# Gmail quota rules

1. Each run records Gmail request attempts by API method, with request counts, unit costs, subtotals, and a total.
2. Accounting and pacing use one [Google quota cost table](https://developers.google.com/workspace/gmail/api/reference/quota), checked on October 2, 2026.
3. Each method entry saves its unit cost so later code changes do not recalculate past estimates.
4. Every automatic retry counts as another attempt, including authentication, server, rate-limit, and network retries.
5. Successes, HTTP errors, and network errors have separate counters. Requests without a confirmed response remain visible.
6. The attempt is saved before dispatch. An interrupted dispatch or lost response can make Google's actual usage differ from the estimate.
7. Waiting and stopping before admission add no attempts. A stop or restart during the durable admission can leave an unknown outcome.
8. Resume and browser restart preserve counters. Manual resume requests are included but are not marked as automatic retries.
9. A new run starts at zero and preserves the previous summary. The latest 20 previous summaries remain in local storage.
10. Account changes preserve run history. Each summary identifies its original account.
11. Connection, category edits, and label refresh requests outside a run do not enter its totals.
12. Older runs show unavailable usage. Resuming an older run starts partial tracking without estimating its earlier requests.
13. Gmail usage shows the current run and previous summaries. Opening it reads saved state and makes no Gmail requests.
14. The public usage response excludes message items, classifier decisions, ownership markers, and helper credentials.
15. Every Gmail operation shares a 6,000-unit minute budget with no reserve. The project quota still needs account-specific verification.
16. Admission reserves each method's quota before dispatch. At most eight Gmail fetches overlap. Response persistence does not hold the admission lock.
17. Eight workers claim pending emails once per active run. Each available worker takes the next email without waiting for the other workers.
18. Classifications share four helper slots and a 240-request minute limit. Helper health synchronizes the allowance on start and resume.
19. Ordinary reads and unchanged UI snapshots do not save state. Attempts, decisions, results, cooldowns, and progress remain durable checkpoints.
20. The normal read-classify-modify path uses six whole-state saves: two admissions, two outcomes, one decision, and one completion.
21. A successful completion counts only after its progress save succeeds. A saved decision is reused after interruption when categories still match.
22. Timings use monotonic clocks and bounded counts, sums, and maxima. Existing checkpoints and responses carry them without dedicated telemetry writes.
23. Completed emails per minute equals measured successes times 60,000 divided by active elapsed milliseconds. Skips and failures are excluded.
24. Active elapsed time starts after helper preflight and includes discovery, labels, cooldowns, and Stop drain. Pauses and browser downtime are excluded.
25. A restart marks timing coverage partial. Saved measured time and completions continue on resume. No missing interval is guessed.
26. Aggregate durations can overlap. Gmail request duration includes response body reads. Jev duration includes any SDK retry waits but exposes no retry count.
27. Each checkpoint includes storage timings from preceding writes. The checkpoint's own write appears only in a later checkpoint. Timing never forces a final write.
28. A normal read and label update consume 25 units. The theoretical ceiling is 240 emails per minute before setup, attachments, retries, and latency.
29. Jev remains on `jev-1.13.0` with the same question, criteria, input semantics, and retry configuration.
30. Label updates preserve INBOX, UNREAD, unrelated labels, ownership checks, category validation, and the no-match result.
