const WINDOW_CONTROLS_OVERLAY_ATTRIBUTE = "data-openbot-window-controls-overlay";

export function followWindowControlsOverlay(): () => void {
  const overlay = navigator.windowControlsOverlay;
  if (!overlay) return () => {};
  const mark = () => document.documentElement.toggleAttribute(WINDOW_CONTROLS_OVERLAY_ATTRIBUTE, overlay.visible);
  mark();
  overlay.addEventListener("geometrychange", mark);
  return () => {
    overlay.removeEventListener("geometrychange", mark);
    document.documentElement.removeAttribute(WINDOW_CONTROLS_OVERLAY_ATTRIBUTE);
  };
}
