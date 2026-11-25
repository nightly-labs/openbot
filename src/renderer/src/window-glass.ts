type WindowGlassSource = "transparent-window" | "backdrop";

const sources = new Set<WindowGlassSource>();

export function setWindowGlass(source: WindowGlassSource, on: boolean): void {
  if (on) sources.add(source);
  else sources.delete(source);
  document.documentElement.toggleAttribute("data-openbot-window-glass", sources.size > 0);
}
