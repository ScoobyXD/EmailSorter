# Gmail toolbar rules

1. Dock controls share Gmail's action row between the native actions and pagination.
2. Controls stay in that row when the message list scrolls, including pages that load at a saved scroll position.
3. Buttons, the days slider, and the resume checkbox receive pointer and keyboard input above Gmail's toolbar decoration.
4. Native actions and pagination keep their existing nodes and behavior.
5. Scrolling does not remove or replace the controls host.
6. Unrecognized layouts use the existing row above the category tabs.
7. Categorization starts only after the user presses Categorize emails.
8. Closing Connection returns focus to its toolbar button without changing the message list's scroll position.
9. The day slider accepts whole numbers from 0 to 100. Zero is a zero-length lookback window.
10. Active controls follow this order: day slider, progress bar, labeled and processed counts, Stop, Gmail usage.
11. Existing runs keep their original date window when resumed. Older saved preferences above 100 become 100 for new runs.
