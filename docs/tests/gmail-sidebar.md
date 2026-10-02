# Gmail sidebar rules

1. Drag the sidebar's right edge to change its width.
2. The label list and message area follow the sidebar edge.
3. Sidebar width stays between 180 and 600 pixels and leaves space for the message area.
4. The resize handle accepts keyboard focus and announces its current width.
5. Left and Right arrows change width by 10 pixels. Shift changes the step to 40 pixels.
6. Double-click or Enter restores Gmail's default width and removes the saved preference.
7. The browser saves the preferred width and restores it after reload.
8. A narrow window limits the visible width without replacing the saved preference.
9. Gmail's main menu can collapse the sidebar. Expansion restores the preferred width.
10. Gmail route changes and replacement navigation elements retain one working resize handle.
11. Native folder links, message controls, and category actions retain their behavior.
12. Home selects the minimum width. End selects the largest width that leaves space for the message area.
13. Escape cancels an active drag and retains the previous saved width.
14. `node scripts/sidebar-smoke.mjs` checks the built extension in isolated Chromium with synthetic Gmail content.
15. Hover, dragging, and keyboard focus show a blue edge. Pointer exit after dragging restores the gray edge.
