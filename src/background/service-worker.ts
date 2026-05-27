import type { CaptureRequest, CaptureResponse } from "../content/capture";
import type { OcrRequest, OcrResponse } from "../content/ocr-msg";

type Message = { type: "ping" } | CaptureRequest | OcrRequest;

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  if (msg.type === "ping") {
    sendResponse({ type: "pong" });
    return false;
  }
  if (msg.type === "capture") {
    handleCapture(msg, sender)
      .then((resp) => sendResponse(resp))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies CaptureResponse),
      );
    return true;
  }
  if (msg.type === "ocr") {
    handleOcr(msg)
      .then((resp) => sendResponse(resp))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies OcrResponse),
      );
    return true;
  }
  return false;
});

async function handleCapture(msg: CaptureRequest, sender: chrome.runtime.MessageSender): Promise<CaptureResponse> {
  const windowId = sender.tab?.windowId;
  if (windowId === undefined) return { ok: false, error: "no window id on sender" };

  const fullDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });

  const cropX = Math.round(msg.videoRect.x * msg.dpr);
  const cropY = Math.round(msg.videoRect.y * msg.dpr);
  const cropW = Math.round(msg.videoRect.w * msg.dpr);
  const cropH = Math.round(msg.videoRect.h * msg.dpr);
  if (cropW <= 0 || cropH <= 0) return { ok: false, error: "video rect off-screen or zero-sized" };

  const fullBlob = await (await fetch(fullDataUrl)).blob();
  const fullBitmap = await createImageBitmap(fullBlob);
  const canvas = new OffscreenCanvas(cropW, cropH);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, error: "no 2d context on OffscreenCanvas" };
  ctx.drawImage(fullBitmap, -cropX, -cropY);
  fullBitmap.close();
  const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
  const dataUrl = await blobToDataUrl(croppedBlob);
  return { ok: true, dataUrl, cropW, cropH };
}

async function handleOcr(msg: OcrRequest): Promise<OcrResponse> {
  await ensureOffscreen();
  // Forward to offscreen document. Offscreen filters on { target: "offscreen" }.
  const resp = (await chrome.runtime.sendMessage({
    type: "ocr",
    target: "offscreen",
    dataUrl: msg.dataUrl,
  })) as { ok: true; result: OcrResponse extends { ok: true; result: infer R } ? R : never } | { ok: false; error: string };
  if (!resp || resp.ok === false) {
    return { ok: false, error: (resp && "error" in resp && resp.error) || "no response from offscreen" };
  }
  return { ok: true, result: resp.result };
}

const OFFSCREEN_URL = "offscreen.html";
let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  // chrome.offscreen.hasDocument is the simplest check.
  const has = await chrome.offscreen.hasDocument();
  if (has) return;
  if (creating) {
    await creating;
    return;
  }
  creating = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Tesseract.js OCR requires a Web Worker + WASM, which page-origin CSPs (e.g., YouTube) block.",
  });
  try {
    await creating;
  } finally {
    creating = null;
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

console.log("[svt-sw] service worker booted");
