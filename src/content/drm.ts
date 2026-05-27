// DRM-protected video on Chromium captures as a near-uniform black frame via captureVisibleTab.
// We sample the cropped image and flag it as DRM if the vast majority of sampled pixels are very dark.

export async function isLikelyDrm(dataUrl: string): Promise<boolean> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    // Downscale the captured frame into a 32x32 tiny canvas via drawImage, then read
    // all 1024 pixels with a single getImageData call. Avoids the 32x32 grid of
    // single-pixel readbacks that triggered the willReadFrequently warning and was
    // costing ~200ms (each 1x1 getImageData forces a GPU→CPU sync).
    const samples = 32;
    const tiny = new OffscreenCanvas(samples, samples);
    const ctx = tiny.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0, samples, samples);
    const data = ctx.getImageData(0, 0, samples, samples).data;
    let darkPixels = 0;
    const total = samples * samples;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (r <= 6 && g <= 6 && b <= 6) darkPixels++;
    }
    return darkPixels / total >= 0.95;
  } finally {
    bitmap.close();
  }
}

export function showToast(message: string): void {
  const TOAST_ID = "svt-toast";
  document.getElementById(TOAST_ID)?.remove();
  const el = document.createElement("div");
  el.id = TOAST_ID;
  el.textContent = message;
  el.style.cssText = `
    position: fixed;
    left: 50%;
    bottom: 32px;
    transform: translateX(-50%);
    background: rgba(20, 20, 20, 0.92);
    color: #fff;
    font: 13px/1.4 -apple-system, system-ui, sans-serif;
    padding: 8px 14px;
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.35);
    z-index: 2147483647;
    opacity: 0;
    transition: opacity 120ms ease-out;
    pointer-events: none;
  `;
  document.documentElement.appendChild(el);
  requestAnimationFrame(() => (el.style.opacity = "1"));
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 200);
  }, 2400);
}
