import { captureToViewport, type Box } from "./coords";

const HOST_ID = "svt-debug-overlay-host";

export function clearDebugOverlay(): void {
  document.getElementById(HOST_ID)?.remove();
}

export function showDebugOverlay(opts: {
  videoRect: { x: number; y: number; w: number; h: number };
  dpr: number;
  capturedDataUrl: string;
  cropW: number;
  cropH: number;
  boxesInCapturePx: Box[];
}): void {
  clearDebugOverlay();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483647;
  `;

  // Show the cropped capture as a translucent ghost over the video — proves the
  // outer crop rect maps back to the video's viewport rect exactly.
  const ghost = document.createElement("img");
  ghost.src = opts.capturedDataUrl;
  ghost.style.cssText = `
    position: absolute;
    left: ${opts.videoRect.x}px;
    top: ${opts.videoRect.y}px;
    width: ${opts.videoRect.w}px;
    height: ${opts.videoRect.h}px;
    opacity: 0.25;
    outline: 2px solid magenta;
  `;
  host.appendChild(ghost);

  // Red outlines for each hand-coded (or OCR-supplied) box, mapped through the transform.
  for (const box of opts.boxesInCapturePx) {
    const v = captureToViewport(box, { x: opts.videoRect.x, y: opts.videoRect.y }, opts.dpr);
    const rect = document.createElement("div");
    rect.style.cssText = `
      position: absolute;
      left: ${v.x}px;
      top: ${v.y}px;
      width: ${v.w}px;
      height: ${v.h}px;
      outline: 2px solid red;
      box-sizing: border-box;
    `;
    host.appendChild(rect);
  }

  document.documentElement.appendChild(host);

  setTimeout(() => clearDebugOverlay(), 5000);
}
