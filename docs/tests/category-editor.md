# Category editor rules

1. A fresh install starts with three separate categories named `Edit Me!` and blank descriptions.
2. Uncategorized remains available as the system category.
3. Reloads and extension updates retain existing saved category definitions.
4. Edit and F2 open a compact surface below the selected category.
5. Add opens the same editor below the Add category button.
6. Icon and Color share the first row. Name and Description follow in that order.
7. The editor stays inside the viewport without horizontal scrolling or a dimmed background.
8. Save retains the category ID and persists its icon, color, name, and description.
9. Cancel, Escape, and clicks outside the editor discard unsaved changes.
10. Escape restores focus to the category tab or Add category button that opened the editor.
11. Duplicate saved names remain invalid. Each starter can be renamed independently.
12. Browser checks use isolated Chromium and synthetic Gmail pages. They do not access live mail.
13. `node scripts/smoke.mjs` checks fresh defaults, editor behavior, persistence, and narrow viewport bounds.
14. `node scripts/clipping-smoke.mjs` checks existing saved categories and Gmail wrapper geometry.
15. A saved category retains its current color when the user edits other fields, even if that color is outside the palette.
16. Selecting another category's Edit button replaces the open editor and discards the first unsaved draft.
17. Clicking an unconfigured starter category opens its editor.
18. Mouse clicks focus both text fields, open Icon and Color, and activate Save and Cancel inside Gmail's category row.
19. The editor stops pointer and mouse events from reaching Gmail handlers without cancelling native control behavior.
