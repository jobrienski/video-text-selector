import { handleVideoClick } from "./lifecycle";
import { showToast } from "./drm";

console.log("[svt-content] loaded on", location.href);

// Cmd on Mac, Ctrl on Windows/Linux. Detect once at module load — platform
// can't change during a session. Ctrl-click on Mac is the native right-click
// gesture, so we explicitly do NOT accept it there; the page's context menu
// should appear instead.
const IS_MAC = (() => {
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData && typeof uaData.platform === "string") return uaData.platform === "macOS";
  return /Mac|iPhone|iPod|iPad/.test(navigator.platform);
})();

function isActivationModifier(e: MouseEvent | PointerEvent): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey;
}

function activationVideoTarget(e: MouseEvent | PointerEvent): HTMLVideoElement | null {
  if (!isActivationModifier(e)) return null;
  return e.target instanceof HTMLVideoElement ? e.target : null;
}

// Video players (YouTube et al.) bind pointerdown/mousedown on the <video> for
// their own modifier-drag gestures. We intercept at the document level in the
// capture phase and stopImmediatePropagation so the page's listeners never see
// the event. Triggering handleVideoClick from pointerdown gives the earliest
// accurate coordinates and avoids racing with mousedown→drag gestures.
function onPointerDown(e: PointerEvent): void {
  const video = activationVideoTarget(e);
  if (!video) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (!chrome.runtime?.id) {
    showToast("Extension was reloaded — refresh this page");
    return;
  }
  void handleVideoClick(video, { x: e.clientX, y: e.clientY });
}

function swallow(e: MouseEvent | PointerEvent): void {
  if (!activationVideoTarget(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

document.addEventListener("pointerdown", onPointerDown, true);
document.addEventListener("mousedown", swallow, true);
document.addEventListener("mouseup", swallow, true);
document.addEventListener("click", swallow, true);
document.addEventListener("dblclick", swallow, true);
