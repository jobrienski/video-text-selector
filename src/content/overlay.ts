import { captureToViewport } from "./coords";
import type { LineBox, ParagraphBox } from "./ocr-msg";

const HOST_ID = "svt-overlay-host";
const STYLE_ID = "svt-overlay-style";

export type MountOpts = {
  videoRect: { x: number; y: number; w: number; h: number };
  dpr: number;
  capturedDataUrl: string;
  cropW: number;
  cropH: number;
  // All paragraphs to render in this patch (typically all paragraphs from one Tesseract block).
  // Within a paragraph, lines are joined by " "; between paragraphs, by "\n".
  paragraphs: ParagraphBox[];
  padPx: number;
};

export type MountedPatch = {
  host: HTMLElement;
  patch: HTMLElement;
  remove: () => void;
};

export function clearPatch(): void {
  document.getElementById(HOST_ID)?.remove();
}

export function findParagraphNearestClick(
  paragraphs: ParagraphBox[],
  clickCapturePx: { x: number; y: number },
): ParagraphBox | null {
  if (paragraphs.length === 0) return null;
  // Pick the line nearest the click (containing-y-band first, then min Euclidean to bbox center),
  // and return the paragraph that owns it.
  let containing: ParagraphBox | null = null;
  let bestDist = Infinity;
  let bestByDist: ParagraphBox | null = null;
  for (const para of paragraphs) {
    for (const line of para.lines) {
      const { x0, y0, x1, y1 } = line.bbox;
      if (clickCapturePx.y >= y0 && clickCapturePx.y <= y1 && clickCapturePx.x >= x0 - 40 && clickCapturePx.x <= x1 + 40) {
        containing = para;
        break;
      }
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const d = Math.hypot(clickCapturePx.x - cx, clickCapturePx.y - cy);
      if (d < bestDist) {
        bestDist = d;
        bestByDist = para;
      }
    }
    if (containing) break;
  }
  return containing ?? bestByDist;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${HOST_ID} {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483647;
    }
    #${HOST_ID} .svt-patch {
      position: absolute;
      pointer-events: auto;
      user-select: none;
      overflow: hidden;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.25),
        0 8px 28px rgba(0, 0, 0, 0.45);
      opacity: 0;
      transform: scale(0.98);
      transition: opacity 120ms ease-out, transform 120ms ease-out;
      will-change: opacity, transform;
    }
    #${HOST_ID} .svt-patch.svt-lifted {
      opacity: 1;
      transform: scale(1);
    }
    #${HOST_ID} .svt-patch.svt-fading {
      opacity: 0;
      transform: scale(0.99);
      transition: opacity 150ms ease-in, transform 150ms ease-in;
    }
    #${HOST_ID} .svt-patch img {
      display: block;
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      user-select: none;
      -webkit-user-drag: none;
    }
    #${HOST_ID} .svt-text-layer {
      position: absolute;
      inset: 0;
      pointer-events: auto;
      user-select: text;
      -webkit-user-select: text;
      cursor: text;
    }
    #${HOST_ID} .svt-line {
      position: absolute;
      color: transparent;
      -webkit-text-fill-color: transparent;
      white-space: pre;
      font-family: sans-serif;
      line-height: 1;
      transform-origin: left top;
      user-select: text;
      -webkit-user-select: text;
    }
    #${HOST_ID} .svt-line::selection {
      background: rgba(180, 150, 220, 0.45);
      color: transparent;
      -webkit-text-fill-color: transparent;
    }
    #${HOST_ID} .svt-line::-moz-selection {
      background: rgba(180, 150, 220, 0.45);
      color: transparent;
    }
    #${HOST_ID} .svt-caption-text {
      padding: 10px 14px;
      font: 14px/1.45 -apple-system, system-ui, "Segoe UI", sans-serif;
      color: #f5f5f5;
      background: rgba(20, 20, 20, 0.94);
      border-radius: 4px;
      user-select: text;
      -webkit-user-select: text;
      cursor: text;
      white-space: pre-wrap;
      max-width: inherit;
    }
    #${HOST_ID} .svt-caption-text::selection {
      background: rgba(80, 140, 255, 0.45);
    }
  `;
  document.documentElement.appendChild(style);
}

export function mountPatch(opts: MountOpts): MountedPatch {
  clearPatch();
  ensureStyle();

  const host = document.createElement("div");
  host.id = HOST_ID;

  // Sort paragraphs by y0, lines within each by y0 — gives stable DOM order
  // matching visual top-to-bottom reading order.
  const paragraphs = [...opts.paragraphs]
    .map((p) => ({ ...p, lines: [...p.lines].sort((a, b) => a.bbox.y0 - b.bbox.y0) }))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const allLines = paragraphs.flatMap((p) => p.lines);
  if (allLines.length === 0) {
    throw new Error("mountPatch called with no lines");
  }

  // Union bbox across every line in every paragraph.
  const pad = opts.padPx;
  let ux0 = Infinity;
  let uy0 = Infinity;
  let ux1 = -Infinity;
  let uy1 = -Infinity;
  for (const line of allLines) {
    if (line.bbox.x0 < ux0) ux0 = line.bbox.x0;
    if (line.bbox.y0 < uy0) uy0 = line.bbox.y0;
    if (line.bbox.x1 > ux1) ux1 = line.bbox.x1;
    if (line.bbox.y1 > uy1) uy1 = line.bbox.y1;
  }
  const cropCx0 = Math.max(0, ux0 - pad);
  const cropCy0 = Math.max(0, uy0 - pad);
  const cropCx1 = Math.min(opts.cropW, ux1 + pad);
  const cropCy1 = Math.min(opts.cropH, uy1 + pad);
  const cropCw = cropCx1 - cropCx0;
  const cropCh = cropCy1 - cropCy0;

  // Map to viewport coords.
  const patchVp = captureToViewport(
    { x: cropCx0, y: cropCy0, w: cropCw, h: cropCh },
    { x: opts.videoRect.x, y: opts.videoRect.y },
    opts.dpr,
  );

  const patch = document.createElement("div");
  patch.className = "svt-patch";
  patch.style.left = `${patchVp.x}px`;
  patch.style.top = `${patchVp.y}px`;
  patch.style.width = `${patchVp.w}px`;
  patch.style.height = `${patchVp.h}px`;

  // Show the relevant slice of the captured image. Same crop math as v1.
  const scale = patchVp.w / cropCw;
  const img = document.createElement("img");
  img.src = opts.capturedDataUrl;
  img.style.width = `${opts.cropW * scale}px`;
  img.style.height = `${opts.cropH * scale}px`;
  img.style.left = `${-cropCx0 * scale}px`;
  img.style.top = `${-cropCy0 * scale}px`;
  img.draggable = false;
  patch.appendChild(img);

  // Text layer: one positioned <span class="svt-line"> per line. Separator text
  // nodes between lines encode the copy semantics:
  //   - " " between lines within the same paragraph (visually-wrapped sentence)
  //   - "\n" between paragraphs (distinct logical units, e.g. title → body)
  // Range.toString() walks DOM order and emits these characters verbatim.
  //
  // Each line's hit area is extended vertically — half the gap to its true
  // neighbor (above and below, regardless of paragraph boundaries), or all the
  // way to the patch edge for the first/last line. This keeps a drag through
  // inter-line whitespace continuously "over text" the way native selection
  // expects. Visible glyphs stay at their original bbox y0 (via padding-top).
  const textLayer = document.createElement("div");
  textLayer.className = "svt-text-layer";

  // Flatten paragraphs → ordered list of lines tagged with their paragraph index.
  type FlatLine = { line: LineBox; paragraphIdx: number };
  const flatLines: FlatLine[] = [];
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi];
    if (!para) continue;
    for (const line of para.lines) flatLines.push({ line, paragraphIdx: pi });
  }

  for (let i = 0; i < flatLines.length; i++) {
    const entry = flatLines[i];
    if (!entry) continue;
    const { line, paragraphIdx } = entry;

    const prev = i > 0 ? flatLines[i - 1]?.line : null;
    const next = i < flatLines.length - 1 ? flatLines[i + 1]?.line : null;
    const gapAboveCap = prev ? Math.max(0, line.bbox.y0 - prev.bbox.y1) / 2 : Math.max(0, line.bbox.y0 - cropCy0);
    const gapBelowCap = next ? Math.max(0, next.bbox.y0 - line.bbox.y1) / 2 : Math.max(0, cropCy1 - line.bbox.y1);
    textLayer.appendChild(renderLine(line, cropCx0, cropCy0, scale, gapAboveCap, gapBelowCap));

    if (i < flatLines.length - 1) {
      const nextEntry = flatLines[i + 1];
      const sameParagraph = nextEntry && nextEntry.paragraphIdx === paragraphIdx;
      textLayer.appendChild(document.createTextNode(sameParagraph ? " " : "\n"));
    }
  }
  patch.appendChild(textLayer);

  host.appendChild(patch);
  document.documentElement.appendChild(host);

  // Trigger CSS transition into the lifted state on the next frame.
  requestAnimationFrame(() => patch.classList.add("svt-lifted"));

  const teardownDrag = installDragSelect(patch, textLayer);

  return {
    host,
    patch,
    remove: () => {
      teardownDrag();
      host.remove();
    },
  };
}

// Take over selection management while the user is dragging inside the patch.
// Once pointerdown lands on the text layer, we capture the pointer to the layer,
// clamp every subsequent pointermove to the patch's bounding rect, find the
// caret position via the standard API, and rebuild the selection Range manually.
// This keeps the visible selection alive when the cursor exits the patch — the
// browser's default selection algorithm collapses in that case because it has
// no text node under the cursor.
function installDragSelect(patch: HTMLElement, textLayer: HTMLElement): () => void {
  type Caret = { node: Node; offset: number };
  let anchor: Caret | null = null;
  let activePointerId: number | null = null;

  const caretAt = (x: number, y: number): Caret | null => {
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(x, y);
      if (!pos) return null;
      return { node: pos.offsetNode, offset: pos.offset };
    }
    if (doc.caretRangeFromPoint) {
      const r = doc.caretRangeFromPoint(x, y);
      if (!r) return null;
      return { node: r.startContainer, offset: r.startOffset };
    }
    return null;
  };

  const clampToPatch = (x: number, y: number): { x: number; y: number } => {
    const r = patch.getBoundingClientRect();
    return {
      x: Math.max(r.left + 1, Math.min(r.right - 1, x)),
      y: Math.max(r.top + 1, Math.min(r.bottom - 1, y)),
    };
  };

  // Resolve a viewport (x, y) to a caret position by routing through the nearest
  // line's actual text glyph area (not its padded box). This avoids the case
  // where `caretPositionFromPoint` lands inside a line's padding-top/-bottom and
  // returns an unexpected position (which appears to be why drag-out-bottom was
  // not extending the selection).
  const caretInNearestLine = (clampedX: number, clampedY: number): Caret | null => {
    const lines = Array.from(textLayer.querySelectorAll<HTMLElement>(".svt-line"));
    if (lines.length === 0) return caretAt(clampedX, clampedY);

    let best: { el: HTMLElement; textTop: number; textBottom: number } | null = null;
    let bestDist = Infinity;
    for (const el of lines) {
      const rect = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      const padTop = parseFloat(cs.paddingTop) || 0;
      const padBottom = parseFloat(cs.paddingBottom) || 0;
      const textTop = rect.top + padTop;
      const textBottom = rect.bottom - padBottom;
      const dist =
        clampedY < textTop ? textTop - clampedY : clampedY > textBottom ? clampedY - textBottom : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = { el, textTop, textBottom };
      }
    }
    if (!best) return caretAt(clampedX, clampedY);
    const rect = best.el.getBoundingClientRect();
    // Also clamp X to this line's tight horizontal extent. Without this, a cursor
    // past the right (or left) end of a short line lands in the wider patch's
    // empty text-layer region — caretPositionFromPoint returns null there and the
    // selection visually collapses until the cursor returns over text.
    const targetX = Math.max(rect.left + 1, Math.min(rect.right - 1, clampedX));
    const targetY = Math.max(best.textTop + 1, Math.min(best.textBottom - 1, clampedY));
    return caretAt(targetX, targetY);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return; // primary button only
    if (!(e.target instanceof Node)) return;
    if (!textLayer.contains(e.target)) return;
    const c = caretAt(e.clientX, e.clientY);
    if (!c) return;
    anchor = c;
    activePointerId = e.pointerId;
    try {
      textLayer.setPointerCapture(e.pointerId);
    } catch {
      // Some pointer types (e.g., synthetic events) may reject capture; ignore.
    }
    // Replace any existing selection with a collapsed range at the anchor.
    const sel = document.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(c.node, c.offset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (anchor === null) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    const { x, y } = clampToPatch(e.clientX, e.clientY);
    const focus = caretInNearestLine(x, y);
    if (!focus) return;
    const sel = document.getSelection();
    if (!sel) return;

    // Order start/end correctly: anchor and focus can be on either side.
    const orderRange = document.createRange();
    try {
      orderRange.setStart(anchor.node, anchor.offset);
    } catch {
      return;
    }
    const cmp = orderRange.comparePoint(focus.node, focus.offset);
    const range = document.createRange();
    try {
      if (cmp >= 0) {
        range.setStart(anchor.node, anchor.offset);
        range.setEnd(focus.node, focus.offset);
      } else {
        range.setStart(focus.node, focus.offset);
        range.setEnd(anchor.node, anchor.offset);
      }
    } catch {
      return;
    }
    sel.removeAllRanges();
    sel.addRange(range);
    e.preventDefault();
  };

  const endDrag = (e: PointerEvent) => {
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    if (activePointerId !== null) {
      try {
        textLayer.releasePointerCapture(activePointerId);
      } catch {
        // already released or never captured
      }
    }
    anchor = null;
    activePointerId = null;
  };

  textLayer.addEventListener("pointerdown", onPointerDown);
  textLayer.addEventListener("pointermove", onPointerMove);
  textLayer.addEventListener("pointerup", endDrag);
  textLayer.addEventListener("pointercancel", endDrag);

  return () => {
    textLayer.removeEventListener("pointerdown", onPointerDown);
    textLayer.removeEventListener("pointermove", onPointerMove);
    textLayer.removeEventListener("pointerup", endDrag);
    textLayer.removeEventListener("pointercancel", endDrag);
  };
}

export function mountCaptionPatch(opts: {
  clickViewport: { x: number; y: number };
  text: string;
}): MountedPatch {
  clearPatch();
  ensureStyle();

  const host = document.createElement("div");
  host.id = HOST_ID;

  const patch = document.createElement("div");
  patch.className = "svt-patch svt-caption-patch";
  // Anchor near the click; CSS shifts so the click point sits inside the patch.
  patch.style.left = `${Math.max(8, opts.clickViewport.x - 12)}px`;
  patch.style.top = `${Math.max(8, opts.clickViewport.y - 12)}px`;
  patch.style.maxWidth = "min(640px, 90vw)";

  const inner = document.createElement("div");
  inner.className = "svt-caption-text";
  inner.textContent = opts.text;
  patch.appendChild(inner);
  host.appendChild(patch);
  document.documentElement.appendChild(host);

  requestAnimationFrame(() => patch.classList.add("svt-lifted"));

  return { host, patch, remove: () => host.remove() };
}

export function fadeAndRemove(mounted: MountedPatch, onDone?: () => void): void {
  const { patch, host } = mounted;
  patch.classList.remove("svt-lifted");
  patch.classList.add("svt-fading");
  const finish = () => {
    host.remove();
    onDone?.();
  };
  // Fall back to a timer in case transitionend doesn't fire.
  const timer = setTimeout(finish, 220);
  patch.addEventListener(
    "transitionend",
    () => {
      clearTimeout(timer);
      finish();
    },
    { once: true },
  );
}

function renderLine(
  line: LineBox,
  cropOx: number,
  cropOy: number,
  scale: number,
  padAboveCap: number,
  padBelowCap: number,
): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "svt-line";
  span.textContent = line.text;

  const wCapPx = line.bbox.x1 - line.bbox.x0;
  const hCapPx = line.bbox.y1 - line.bbox.y0;
  const left = (line.bbox.x0 - cropOx) * scale;
  const top = (line.bbox.y0 - cropOy) * scale;
  const w = wCapPx * scale;
  const h = hCapPx * scale;
  const padTop = padAboveCap * scale;
  const padBottom = padBelowCap * scale;

  // Position the span at (top - padTop) and pad it back down by padTop so the
  // actual text glyphs still render at the original `top`. Selection hit area
  // covers padTop + h + padBottom; visible glyphs stay at the bbox position.
  span.style.left = `${left}px`;
  span.style.top = `${top - padTop}px`;
  span.style.fontSize = `${h}px`;
  span.style.height = `${h + padTop + padBottom}px`;
  span.style.paddingTop = `${padTop}px`;
  span.style.paddingBottom = `${padBottom}px`;
  span.style.boxSizing = "border-box";
  span.dataset.targetWidth = String(w);
  return span;
}

// Apply scaleX per line so each rendered line's width matches its bbox width.
// Called after mount so layout has settled.
export function fitLineWidths(host: HTMLElement): void {
  const lines = host.querySelectorAll<HTMLSpanElement>(".svt-line");
  for (const line of lines) {
    const target = parseFloat(line.dataset.targetWidth ?? "0");
    if (!Number.isFinite(target) || target <= 0) continue;
    line.style.transform = "";
    const natural = line.getBoundingClientRect().width;
    if (natural <= 0) continue;
    const sx = target / natural;
    line.style.transform = `scaleX(${sx})`;
  }
}
