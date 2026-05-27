export type CaptureRequest = {
  type: "capture";
  videoRect: { x: number; y: number; w: number; h: number };
  dpr: number;
};

export type CaptureResponse =
  | { ok: true; dataUrl: string; cropW: number; cropH: number }
  | { ok: false; error: string };

export async function requestCapture(videoEl: HTMLVideoElement): Promise<CaptureResponse> {
  if (!chrome.runtime?.id) {
    return { ok: false, error: "extension context invalidated" };
  }
  const rect = videoEl.getBoundingClientRect();
  const req: CaptureRequest = {
    type: "capture",
    videoRect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    dpr: window.devicePixelRatio,
  };
  try {
    const resp = (await chrome.runtime.sendMessage(req)) as CaptureResponse;
    return resp ?? { ok: false, error: "no response from service worker" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
