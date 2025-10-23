# Open Issues & Next Steps

## Updates — 2025-10-21
- Refactored `assets/js/layout.js` to export `initLayout({ viz })`; main module calls it explicitly, guaranteeing listener binding after the visualizer resolves.
- Likewise `assets/js/ui-controls.js` now exports `initControls({ viz })`, removing reliance on `window.__viz` side effects.
- `index.html` imports both initializers (`initLayout`, `initControls`) after creating the visualizer.
- Controls drawer CSS now anchors below the header (`top: var(--header-h)`) with constrained height and scroll, preventing it from spilling off the viewport edge.
- Header collapse reworked into a floating arrow handle that remains accessible when the bar is hidden.
- Toggling animation controls now forces an explicit reduced-motion override inside `visualizer.js` so the slice sweep runs even if the page was paused (e.g., due to initial prefers-reduced-motion or the scroll sentinel).
- Controls drawer replicates the original demo UI: sequence textarea + apply button, recenter action, animation toggles separated from sliders, and a collapsible “Docs” section with reference copy. `initControls` syncs values from the live visualizer state and updates status text.
- Docs toggle now prevents default legend behavior, flips `aria-expanded`, rotates the chevron, and explicitly sets `display: grid/none` so the reference panes truly expand/collapse across browsers (`assets/js/ui-controls.js`).
- Layout pause/resume now uses a simple scroll threshold (≈0.92 × viewport height) instead of the invisible sentinel, so the hero animates immediately on load and pauses only after you scroll past the fold.
- Header handle now rotates independently of the header (`data-collapsed` mirrored onto the button) so collapsing/restoring works reliably.
- Controls drawer slides completely out of view when collapsed (`translateX(100% + clamp(12px,2vw,32px))`), removing the visible sliver on wide or narrow displays.
- Added a “Active Parameters” telemetry panel beneath the sequence block to display the live visualizer settings; updates via `syncControls` in `assets/js/ui-controls.js`.
- Hero side panel auto-hides once you scroll past the hero boundary (`data-outside="true"`), preventing overlap with CV/contact sections while keeping collapse controls available above the fold.

## Current Focus
- Visualizer defaults still load `polyprotein.fna` when no sequence is supplied; revisit once real copy/links are ready.
- Run through mobile viewport to confirm drawer, bottom sheet, and blur handles feel good on touch devices.

## Next Validation Pass
1. Reload: `initLayout` should log no errors; header and hero panel collapse toggles should update `data-collapsed` and animate.
2. Toggle the controls drawer via ⚙︎ — it should slide fully into view beneath the header, respect width clamp, and remain keyboard reachable.
3. Scroll to `#cv`: scroll-threshold pause should stop/resume the visualizer without console noise.
4. Mobile width (<768px): ensure drawer width constraint holds, panel bottom sheet still collapses, and blur handles remain legible.

Keep this file updated as we iterate.
