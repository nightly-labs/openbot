/**
 * What makes the window clear: the transparent window shows the blurred desktop, and an animated
 * backdrop shows its scene. `styles/window-glass.css` makes the frame, the panes and the surfaces
 * clear tints while one of them is on.
 */
type WindowGlassSource = "transparent-window" | "backdrop";

const sources = new Set<WindowGlassSource>();

export function setWindowGlass(source: WindowGlassSource, on: boolean): void {
  if (on) sources.add(source);
  else sources.delete(source);
  document.documentElement.toggleAttribute("data-openbot-window-glass", sources.size > 0);
}
