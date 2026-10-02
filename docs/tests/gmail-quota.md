# Gmail quota rules

1. Each run records Gmail request attempts by API method, with request counts, unit costs, subtotals, and a total.
2. Accounting and pacing use one [Google quota cost table](https://developers.google.com/workspace/gmail/api/reference/quota), checked on October 2, 2026.
3. Each method entry saves its unit cost so later code changes do not recalculate past estimates.
4. Every automatic retry counts as another attempt, including authentication, server, rate-limit, and network retries.
5. Successes, HTTP errors, and network errors have separate counters. Requests without a confirmed response remain visible.
6. The attempt is saved before dispatch. An interrupted dispatch or lost response can make Google's actual usage differ from the estimate.
7. Waiting and stopping before dispatch add no attempts. Responses from requests already in progress still update their run.
8. Resume and browser restart preserve counters. Manual resume requests are included but are not marked as automatic retries.
9. A new run starts at zero and preserves the previous summary. The latest 20 previous summaries remain in local storage.
10. Account changes preserve run history. Each summary identifies its original account.
11. Connection, category edits, and label refresh requests outside a run do not enter its totals.
12. Older runs show unavailable usage. Resuming an older run starts partial tracking without estimating its earlier requests.
13. Gmail usage shows the current run and previous summaries. Opening it reads saved state and makes no Gmail requests.
14. The public usage response excludes message items, classifier decisions, ownership markers, and helper credentials.
