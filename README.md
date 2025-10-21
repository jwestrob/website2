# jwestrob.github.io — Quaternion Julia Hero

This static site renders an icosahedral quaternion–Julia fractal (Three.js) behind the hero section, preserving the black-and-gold aesthetic from `quaternion_julia.html`.

## Local preview
- Open `index.html` in any modern browser, or
- Serve the folder with a static server (`python3 -m http.server`).

## GitHub Pages deployment
1. Push to `main`.
2. In **Settings → Pages**, choose **Branch: main / root**.
3. (Optional) Add a custom domain and include a `CNAME` file.

## Configuration
- Hero defaults live in the inline module boot script in `index.html` and in `assets/js/visualizer.js`. A floating control panel (desktop) lets you tweak parameters, toggle animation, paste sequences, and manually recenter the view.
- On first paint the hero fetches `polyprotein.fna`, normalizes it to uppercase DNA, and uses that as the default sequence unless a `?seq=` override is present.
- `cameraAzimuth`/`cameraElevation` (degrees) steer the static view; `cameraDistance` keeps the fractal framed.
- Set `enablePost: true` in `index.html` if you want bloom + FXAA postprocessing (disabled by default for faster paint).
- Append `?seq=ACGT...` or amino-acid sequences to the page URL to derive fractal parameters.
- Honors `prefers-reduced-motion`: animation stops automatically.
- Falls back to `assets/poster/hero-poster.jpg` when WebGL or JavaScript is unavailable.

## License
MIT for code. Artwork and sequences © Jacob West-Roberts.
