const TILING_DESKTOP_SOCKETS = ["HYPRLAND_INSTANCE_SIGNATURE", "SWAYSOCK", "I3SOCK", "NIRI_SOCKET"] as const;

const TILING_DESKTOPS: ReadonlySet<string> = new Set([
  "hyprland",
  "sway",
  "i3",
  "niri",
  "river",
  "dwl",
  "mango",
  "bspwm",
  "qtile",
  "awesome",
  "dwm",
  "xmonad",
  "herbstluftwm",
  "leftwm",
  "spectrwm",
]);

function currentDesktopNames(environment: NodeJS.ProcessEnv): string[] {
  return (environment.XDG_CURRENT_DESKTOP ?? "").split(":").map((desktop) => desktop.trim().toLowerCase());
}

function isTilingLinuxDesktop(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): boolean {
  if (platform !== "linux") return false;
  if (TILING_DESKTOP_SOCKETS.some((name) => Boolean(environment[name]?.trim()))) return true;
  return currentDesktopNames(environment).some((desktop) => TILING_DESKTOPS.has(desktop));
}

export function onNiriDesktop(environment: NodeJS.ProcessEnv): boolean {
  return Boolean(environment.NIRI_SOCKET?.trim()) || currentDesktopNames(environment).includes("niri");
}

export const onTilingLinuxDesktop = isTilingLinuxDesktop(process.platform, process.env);

const NO_MINIMUM_SIZE = { minWidth: 0, minHeight: 0 } as const;
const NARROWEST_DESKTOP_LAYOUT_WIDTH = 721;

export function windowMinimumSize(preferred: { readonly minWidth: number; readonly minHeight: number }) {
  return onTilingLinuxDesktop ? NO_MINIMUM_SIZE : preferred;
}

export function desktopLayoutZoomFactor(contentWidth: number, interfaceZoomFactor: number): number {
  if (!onTilingLinuxDesktop || contentWidth <= 0) return interfaceZoomFactor;
  return Math.min(interfaceZoomFactor, contentWidth / NARROWEST_DESKTOP_LAYOUT_WIDTH);
}
