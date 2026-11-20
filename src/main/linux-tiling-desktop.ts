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

function isTilingLinuxDesktop(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv): boolean {
  if (platform !== "linux") return false;
  if (TILING_DESKTOP_SOCKETS.some((name) => Boolean(environment[name]?.trim()))) return true;
  return (environment.XDG_CURRENT_DESKTOP ?? "")
    .split(":")
    .some((desktop) => TILING_DESKTOPS.has(desktop.trim().toLowerCase()));
}

const NO_MINIMUM_SIZE = { minWidth: 0, minHeight: 0 } as const;

export function windowMinimumSize(preferred: { readonly minWidth: number; readonly minHeight: number }) {
  return isTilingLinuxDesktop(process.platform, process.env) ? NO_MINIMUM_SIZE : preferred;
}
