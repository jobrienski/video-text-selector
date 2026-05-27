import type { OcrRequest, OcrResponse, OcrResult } from "./ocr-msg";
export type { LineBox, SymbolBox, OcrResult } from "./ocr-msg";

export async function ocr(imageDataUrl: string): Promise<OcrResult> {
  if (!chrome.runtime?.id) throw new Error("extension context invalidated");
  const req: OcrRequest = { type: "ocr", dataUrl: imageDataUrl };
  let resp: OcrResponse;
  try {
    resp = (await chrome.runtime.sendMessage(req)) as OcrResponse;
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }
  if (!resp || resp.ok === false) {
    throw new Error(resp?.ok === false ? resp.error : "no response from service worker");
  }
  return resp.result;
}
