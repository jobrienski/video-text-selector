# Video Text Selector

A Chromium browser extension that lets you select and copy text shown inside an HTML5 video — chyrons, captions burned into the picture, slide text, on-screen quotes — without pausing playback.

Click on a word in the video while holding the platform modifier — **⌘ Cmd-click on macOS, Ctrl-click on Windows and Linux**. The extension captures the current frame, OCRs the text around the click, and pops up a small "lifted" card containing a selectable, copyable text layer over the original pixels. The video keeps playing behind it. Drag-select, then ⌘-C (Mac) or Ctrl-C (Win/Linux), done.

> On macOS, Ctrl-click is the system right-click gesture — the extension intentionally ignores it so the native context menu still works.

## What it does

- **Click-driven OCR.** One capture + one OCR per click — no continuous per-frame work, no background CPU drain.
- **Plays behind the card.** The card is a deliberately lifted "object" with a soft shadow; the video underneath keeps playing. Doesn't disrupt the viewing flow.
- **Native selection semantics.** Drag-select across multiple lines and paragraphs, persist selection while the cursor leaves the card, copy with the system clipboard.
- **Preview-style highlight.** One continuous lavender bar per visual line, matching macOS Live Text / Preview rather than per-glyph fragments.
- **List-aware copy.** Bulleted and numbered lists are detected and pasted with one item per line; wrapped prose joins as one continuous sentence; distinct paragraphs (e.g. a slide title + body) are separated by newlines.
- **Soft-subtitle fast path.** If the video has a WebVTT `<track>` cue active at the click time, the cue text is used directly — no OCR needed.
- **Fully offline.** Tesseract.js and its English language model are bundled in the extension. Nothing about your viewing is sent to any server.

## Limitations

- **Non-DRM video only.** Chromium's `captureVisibleTab` returns a black frame for DRM/EME-protected content (Netflix, Disney+, etc.). The extension detects this and shows a "Can't capture protected video" toast instead of an empty card.
- **English only** in v1 — the bundled Tesseract model is `eng.traineddata`.
- OCR quality depends on the video's text contrast and resolution. High-contrast chyrons and slide text work very well; stylized or low-contrast text less so.

## Install (unpacked, for now)

1. Clone this repo and build (see Developer section below).
2. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`, etc.).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `dist/` directory from your clone.
5. Open a page with a non-DRM HTML5 video. Hold **⌘** (Mac) or **Ctrl** (Windows/Linux) and click on text inside the video.

## Developer

### Stack

- **Vite + `@crxjs/vite-plugin`** — MV3 manifest, content-script HMR, asset emission.
- **TypeScript** strict mode.
- **Tesseract.js v5** running inside a Chrome offscreen document (MV3 service workers can't host the wasm worker; offscreen docs give it an extension-origin CSP that allows wasm).
- No runtime framework; the patch is plain DOM.

### Build from source

Requires Node 20+ and npm. The project assumes a recent Node (developed against Node 22 via Volta).

```sh
git clone https://github.com/jobrienski/video-text-selector
cd video-text-selector
npm install
npm run build
```

The built extension lands in `dist/`. Load it via `chrome://extensions` → Load unpacked → pick `dist/`.

For iterative development:

```sh
npm run dev    # vite dev with HMR
npm run typecheck   # tsc --noEmit
```

After `npm run dev`, you still need to reload the extension in `chrome://extensions` to pick up manifest/service-worker changes; content-script changes hot-reload.

### Layout

```
src/
├── manifest.ts             # MV3 manifest (TS, via @crxjs)
├── background/
│   └── service-worker.ts   # chrome.tabs.captureVisibleTab + offscreen doc lifecycle
├── content/
│   ├── index.ts            # cmd-click handler installed at document capture phase
│   ├── lifecycle.ts        # state machine: idle → capturing → ocring → lifted → fading
│   ├── capture.ts          # content↔SW capture round-trip
│   ├── coords.ts           # capture-image ↔ viewport coord transforms
│   ├── overlay.ts          # lifted-card DOM, drag-select state machine, ::selection styling
│   ├── captions.ts         # textTracks fast-path
│   ├── drm.ts              # near-uniform-black detection + toast
│   ├── ocr.ts              # content-side OCR message client (routes to offscreen)
│   └── ocr-msg.ts          # shared message types
├── offscreen/
│   └── offscreen.ts        # Tesseract worker host, word/line filtering, list detection
└── ...
public/assets/tesseract/    # worker.min.js, wasm core, eng.traineddata.gz
offscreen.html              # offscreen-doc HTML loader
```

### How it fits together

1. **cmd-click on a `<video>`** in any page → content script intercepts at the document capture phase, `preventDefault` + `stopImmediatePropagation` so the page's own video player (e.g. YouTube's drag-to-fast-forward) never sees the gesture.
2. **Capture path.** Content asks the service worker for a screenshot via `chrome.runtime.sendMessage`. The SW calls `chrome.tabs.captureVisibleTab`, crops to the video's bbox via an `OffscreenCanvas`, returns a data URL.
3. **DRM check.** Content downsamples the cropped image to 32×32, checks for near-uniform black. If protected, shows a toast and bails.
4. **OCR.** Content forwards the data URL to the offscreen document, which runs Tesseract.js. The result is filtered (low-confidence words, isolated icon misreads, fragments from Tesseract word-splits) and grouped into paragraphs by y-gap, line-height ratio, and list-pattern detection.
5. **Patch.** The chosen paragraph cluster is rendered as one positioned `<canvas>`/`<img>` slice of the captured frame plus an invisible per-line `<span>` text layer. `::selection` is styled lavender; padding-based hit-areas keep selection alive across line gaps; pointer capture keeps it alive when the cursor leaves the patch.
6. **Copy.** A `copy` event listener overrides the clipboard payload with `Range.toString()` so layout-tree quirks (zero-width spaces, padding regions) don't corrupt the output.

### Architectural notes worth knowing if you're hacking on this

- **`captureVisibleTab` vs canvas `drawImage`** — we use the former because most CDN-hosted videos are cross-origin and would taint a canvas. `captureVisibleTab` returns rendered pixels regardless and dodges the taint.
- **Offscreen document, not service worker, for Tesseract.** MV3 SWs run in a worker context that can't `new Worker()` for the wasm runtime. Offscreen documents are extension-origin HTML pages with the right CSP (`'wasm-unsafe-eval'` is set in the manifest).
- **Pointer capture for drag-select.** When the cursor leaves the lifted card, the browser's default selection algorithm has no text node under the cursor and collapses. We `setPointerCapture` on the text layer, take over selection extension manually via `Range`, and clamp the cursor to the patch + the chosen line's text box on every `pointermove`.

## Release

Produce a Chrome Web Store–ready zip with:

```sh
npm run package
```

The artifact lands at `release/video-text-selector-v{version}.zip`. `manifest.json` is at the **root** of the zip (no `dist/` wrapper), with all compiled scripts, the offscreen HTML, the bundled Tesseract assets, and the icons — exactly the layout the Chrome Web Store Developer Dashboard expects.

Before tagging a release, bump the version in **both** [src/manifest.ts](src/manifest.ts) and [package.json](package.json) — they should match. The zip filename comes from the built manifest's `version` field, so what's in `manifest.json` is what ships.

The icons are placeholders ("VTS" on a lavender background) generated by:

```sh
npm run generate-icons
```

To swap in real artwork, drop your own `icon16.png` / `icon48.png` / `icon128.png` into [public/icons/](public/icons/) — those paths are what the manifest references. No code changes needed.

To verify a zip before uploading:

```sh
unzip -l release/video-text-selector-v0.1.0.zip | head
unzip -p release/video-text-selector-v0.1.0.zip manifest.json | jq .name
```

`manifest.json` should be at the top-level (no leading path component), and the name should be "Video Text Selector".

Upload at https://chrome.google.com/webstore/devconsole.

## Contributing

Issues and PRs welcome. A few notes that'll save you time:

- **Manual testing is the primary signal.** There's no test framework. The development loop is: change → `npm run build` → reload extension in `chrome://extensions` → refresh the page → ⌘-click on the test video. The page console (filter for `[svt-]`) and the offscreen console (open via the "offscreen" link in `chrome://extensions` after the first OCR) carry timing logs and filter-drop diagnostics.
- **Test against the worst cases.** YouTube (intercepts events itself, has its own controls overlay), Netflix/Disney+ (DRM should be detected, not silently fail), high-DPI displays (coord transform), and pages where the video isn't at the origin (scroll offset).
- **Don't add framework dependencies.** The patch is plain DOM by design — keeps it small and means it can't conflict with the host page's React/Vue/etc.
- **Prefer heuristic-tuning PRs over heuristic-replacement PRs.** The OCR-filter and paragraph-split heuristics live in `src/offscreen/offscreen.ts` and have evolved against real video frames; if you find a case where they misfire, please include the captured frame (DevTools → break in the offscreen worker on the failing input) and the `[svt-ocr]` log lines.
- **Code style:** TS strict; no semicolons-vs-not bikeshedding (whatever Prettier defaults to); short, scoped commits.

## License

Choose your license before publishing. (TODO — `package.json` currently says ISC, which is fine, but pick deliberately.)
