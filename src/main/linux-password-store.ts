// #2374: Chromium gives `safeStorage` the `basic` store on a Linux desktop that it does not map to a
// keyring (Hyprland, Sway, i3, LXQt). `isEncryptionAvailable()` is then false and no sign-in is kept.
// Name the Secret Service there, as the hosting launchers do. When no Secret Service runs, encryption
// stays unavailable, as before.
// The rule mirrors `base::nix::GetDesktopEnvironment` and os_crypt `SelectBackend` (Electron 44), so a
// desktop that Chromium maps to libsecret or KWallet keeps its own choice.
import { app } from "electron";

// `XDG_CURRENT_DESKTOP` values that Chromium maps to libsecret or KWallet: exact match, first match wins.
const MAPPED_DESKTOPS: ReadonlySet<string> = new Set([
  "Unity",
  "Deepin",
  "GNOME",
  "X-Cinnamon",
  "KDE",
  "Pantheon",
  "XFCE",
  "UKUI",
  "COSMIC",
]);
const LIBSECRET_SESSIONS: ReadonlySet<string> = new Set(["deepin", "gnome", "mate", "xubuntu", "ukui"]);

function chromiumPicksBasic(env: NodeJS.ProcessEnv): boolean {
  for (const desktop of (env.XDG_CURRENT_DESKTOP ?? "").split(":").map((value) => value.trim())) {
    if (MAPPED_DESKTOPS.has(desktop)) return false;
    if (desktop === "LXQt") return true;
  }
  const session = env.DESKTOP_SESSION ?? "";
  if (LIBSECRET_SESSIONS.has(session) || session.includes("xfce")) return false;
  if (session === "kde4" || session === "kde-plasma") return false;
  // KDE3 has no D-Bus KWallet, so Chromium uses `basic` there.
  if (session === "kde") return env.KDE_SESSION_VERSION === undefined;
  if (env.GNOME_DESKTOP_SESSION_ID !== undefined) return false;
  if (env.KDE_FULL_SESSION !== undefined) return env.KDE_SESSION_VERSION === undefined;
  return true;
}

/** Selects the Secret Service where Chromium would use `basic`. A `--password-store` the user gives wins. */
export function configureLinuxPasswordStore(): boolean {
  if (process.platform !== "linux" || app.commandLine.hasSwitch("password-store")) return false;
  if (!chromiumPicksBasic(process.env)) return false;
  app.commandLine.appendSwitch("password-store", "gnome-libsecret");
  return true;
}
