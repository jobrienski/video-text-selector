import { requestCapture } from "./capture";
import { activeCueText } from "./captions";
import { isLikelyDrm, showToast } from "./drm";
import { ocr } from "./ocr";
import {
  fadeAndRemove,
  findParagraphNearestClick,
  fitLineWidths,
  mountCaptionPatch,
  mountPatch,
  type MountedPatch,
} from "./overlay";
import type { ParagraphBox } from "./ocr-msg";

type State =
  | { kind: "idle" }
  | { kind: "capturing"; cancelToken: { cancelled: boolean } }
  | { kind: "ocring"; cancelToken: { cancelled: boolean } }
  | { kind: "lifted"; mounted: MountedPatch; teardown: () => void }
  | { kind: "fading" };

let state: State = { kind: "idle" };

function cancelInflight(): void {
  if (state.kind === "capturing" || state.kind === "ocring") {
    state.cancelToken.cancelled = true;
    state = { kind: "idle" };
  }
  if (state.kind === "lifted") {
    state.teardown();
    fadeAndRemove(state.mounted, () => {
      if (state.kind === "fading") state = { kind: "idle" };
    });
    state = { kind: "fading" };
  }
}

// Cluster paragraphs by y-coherence with the chosen one. Walks outward from
// the chosen paragraph in both directions; stops when the y-gap to the next
// candidate exceeds ~3× the median line height. Keeps a slide's title + body
// together but drops a player timestamp far below.
function clusterByYCoherence(siblings: ParagraphBox[], chosen: ParagraphBox): ParagraphBox[] {
  if (siblings.length <= 1) return siblings;
  const sorted = [...siblings].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const chosenIndex = sorted.indexOf(chosen);
  if (chosenIndex < 0) return [chosen];

  const allHeights = sorted
    .flatMap((p) => p.lines.map((l) => l.bbox.y1 - l.bbox.y0))
    .sort((a, b) => a - b);
  const medianHeight = allHeights[Math.floor(allHeights.length / 2)] ?? 20;
  const gapThreshold = medianHeight * 3;

  const cluster: ParagraphBox[] = [chosen];

  for (let i = chosenIndex - 1; i >= 0; i--) {
    const candidate = sorted[i];
    const innerNeighbor = sorted[i + 1];
    if (!candidate || !innerNeighbor) break;
    const gap = innerNeighbor.bbox.y0 - candidate.bbox.y1;
    if (gap > gapThreshold) break;
    cluster.unshift(candidate);
  }
  for (let i = chosenIndex + 1; i < sorted.length; i++) {
    const candidate = sorted[i];
    const innerNeighbor = sorted[i - 1];
    if (!candidate || !innerNeighbor) break;
    const gap = candidate.bbox.y0 - innerNeighbor.bbox.y1;
    if (gap > gapThreshold) break;
    cluster.push(candidate);
  }
  return cluster;
}

function installLifted(mounted: MountedPatch): void {
  const beginFade = () => {
    if (state.kind !== "lifted") return;
    state.teardown();
    fadeAndRemove(state.mounted, () => {
      if (state.kind === "fading") state = { kind: "idle" };
    });
    state = { kind: "fading" };
  };

  const onCopy = (e: ClipboardEvent) => {
    // Chromium derives the copied text from the layout tree, which skips zero-width text nodes
    // (our inter-word spaces have font-size: 0). Override with Range.toString() — pure DOM
    // traversal — so inter-word spaces are preserved verbatim.
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (mounted.host.contains(range.commonAncestorContainer)) {
        const text = range.toString();
        if (text.length > 0 && e.clipboardData) {
          e.clipboardData.setData("text/plain", text);
          e.preventDefault();
        }
      }
    }
    queueMicrotask(beginFade);
  };
  const onPointerDown = (e: PointerEvent) => {
    if (!(e.target instanceof Node)) return;
    if (mounted.host.contains(e.target)) return;
    beginFade();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") beginFade();
  };
  document.addEventListener("copy", onCopy, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKey, true);

  const teardown = () => {
    document.removeEventListener("copy", onCopy, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKey, true);
  };

  state = { kind: "lifted", mounted, teardown };
}

export async function handleVideoClick(video: HTMLVideoElement, clickViewport: { x: number; y: number }): Promise<void> {
  cancelInflight();

  // Caption fast-path: if there's an active soft-subtitle cue right now, use it and skip OCR entirely.
  const cueText = activeCueText(video);
  if (cueText) {
    console.log("[svt-lifecycle] caption fast-path:", JSON.stringify(cueText));
    const mounted = mountCaptionPatch({ clickViewport, text: cueText });
    installLifted(mounted);
    return;
  }

  const cancelToken = { cancelled: false };
  state = { kind: "capturing", cancelToken };

  const t0 = performance.now();
  const rect = video.getBoundingClientRect();
  const resp = await requestCapture(video);
  const tCapture = performance.now();
  if (cancelToken.cancelled) return;
  if (!resp.ok) {
    console.warn("[svt-lifecycle] capture failed:", resp.error);
    if (resp.error.includes("context invalidated")) {
      showToast("Extension was reloaded — refresh this page");
    }
    state = { kind: "idle" };
    return;
  }

  // DRM detection: a near-uniform-black capture means the frame was protected.
  try {
    if (await isLikelyDrm(resp.dataUrl)) {
      console.log("[svt-lifecycle] DRM-protected frame detected, aborting");
      showToast("Can't capture protected video");
      state = { kind: "idle" };
      return;
    }
  } catch (err) {
    console.warn("[svt-lifecycle] DRM check failed (proceeding):", err);
  }
  const tDrm = performance.now();
  if (cancelToken.cancelled) return;

  state = { kind: "ocring", cancelToken };
  let paragraphs;
  try {
    const result = await ocr(resp.dataUrl);
    paragraphs = result.paragraphs;
  } catch (err) {
    console.warn("[svt-lifecycle] ocr failed:", err);
    state = { kind: "idle" };
    return;
  }
  const tOcr = performance.now();
  if (cancelToken.cancelled) return;
  const totalLines = paragraphs.reduce((n, p) => n + p.lines.length, 0);
  if (paragraphs.length === 0) {
    console.log(
      `[svt-timing] capture ${(tCapture - t0).toFixed(0)}ms, drm ${(tDrm - tCapture).toFixed(0)}ms, ocr ${(tOcr - tDrm).toFixed(0)}ms — 0 paragraphs`,
    );
    state = { kind: "idle" };
    return;
  }
  console.log(
    `[svt-timing] capture ${(tCapture - t0).toFixed(0)}ms, drm ${(tDrm - tCapture).toFixed(0)}ms, ocr ${(tOcr - tDrm).toFixed(0)}ms, total ${(tOcr - t0).toFixed(0)}ms, ${paragraphs.length} paragraphs / ${totalLines} lines`,
  );

  const clickCapture = {
    x: (clickViewport.x - rect.x) * devicePixelRatio,
    y: (clickViewport.y - rect.y) * devicePixelRatio,
  };
  const chosen = findParagraphNearestClick(paragraphs, clickCapture);
  if (!chosen) {
    state = { kind: "idle" };
    return;
  }
  // Block-level grouping: pull in every paragraph from the same Tesseract block.
  // Then y-coherence filter: drop paragraphs that are vertically far from the
  // chosen one (e.g., player timestamp at the bottom of the frame got pulled
  // into the same block as the slide's text).
  const blockSiblings = paragraphs.filter((p) => p.blockIndex === chosen.blockIndex);
  const groupParagraphs = clusterByYCoherence(blockSiblings, chosen);
  console.log(
    `[svt-lifecycle] chose block ${chosen.blockIndex}: ${blockSiblings.length} block siblings → ${groupParagraphs.length} after y-cluster, ${groupParagraphs.reduce((n, p) => n + p.lines.length, 0)} lines`,
  );
  console.log(
    "[svt-lifecycle] cluster paragraphs:",
    groupParagraphs.map((p) => ({ text: p.text, bbox: p.bbox })),
  );
  // Dropped siblings — log these so we can see what's being filtered out.
  const dropped = blockSiblings.filter((p) => !groupParagraphs.includes(p));
  if (dropped.length > 0) {
    console.log(
      "[svt-lifecycle] dropped by y-cluster:",
      dropped.map((p) => ({ text: p.text, bbox: p.bbox })),
    );
  }

  const mounted = mountPatch({
    videoRect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    dpr: devicePixelRatio,
    capturedDataUrl: resp.dataUrl,
    cropW: resp.cropW,
    cropH: resp.cropH,
    paragraphs: groupParagraphs,
    padPx: 8,
  });
  requestAnimationFrame(() => fitLineWidths(mounted.host));
  installLifted(mounted);
}
