# jwestrob.github.io — Quaternion Julia Hero

This static microsite renders an icosahedral quaternion–Julia fractal (Three.js) as a live background. The UI now includes a collapsible header, a hero side panel, and a top-right controls drawer layered over the visualization.

## Local preview
- Open `index.html` in any modern browser, or
- Serve the folder with a static server (`python3 -m http.server`).

## GitHub Pages deployment
1. Push to `main`.
2. In **Settings → Pages**, choose **Branch: main / root**.
3. (Optional) Add a custom domain and include a `CNAME` file.

## Configuration & UI
- Header (≈7.5 vh) and left hero panel (≈25 vw) are collapsible via accessible toggles.
- The ⚙︎ button opens a top-right controls drawer (Esc closes). Sliders call `window.__viz.setParams()` without rerender loops.
- By default the drawer adjusts animation toggles, bloom/exposure/roughness, and fractal slice/fold/iterations.
- The hero background pauses via `IntersectionObserver` when you scroll past the hero sentinel.
- The site fetches `polyprotein.fna`, normalises it to uppercase DNA, and uses it as the default sequence unless you provide `?seq=`.

## License
MIT for code. Artwork and sequences © Jacob West-Roberts.
