export type Box = { x: number; y: number; w: number; h: number };

// Capture-image coords (pixels in the cropped PNG returned by the SW) → viewport coords (CSS px).
// The cropped image is exactly `videoRect * dpr` in pixel dimensions, anchored at
// (videoRect.x * dpr, videoRect.y * dpr) in the original captureVisibleTab frame. So the only
// mapping needed inside the patch is "divide by dpr and translate by videoRect origin".
export function captureToViewport(box: Box, videoRectOrigin: { x: number; y: number }, dpr: number): Box {
  return {
    x: box.x / dpr + videoRectOrigin.x,
    y: box.y / dpr + videoRectOrigin.y,
    w: box.w / dpr,
    h: box.h / dpr,
  };
}

export function viewportToCapture(box: Box, videoRectOrigin: { x: number; y: number }, dpr: number): Box {
  return {
    x: (box.x - videoRectOrigin.x) * dpr,
    y: (box.y - videoRectOrigin.y) * dpr,
    w: box.w * dpr,
    h: box.h * dpr,
  };
}
