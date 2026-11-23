import { app } from "electron";

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
  if (session === "kde") return env.KDE_SESSION_VERSION === undefined;
  if (env.GNOME_DESKTOP_SESSION_ID !== undefined) return false;
  if (env.KDE_FULL_SESSION !== undefined) return env.KDE_SESSION_VERSION === undefined;
  return true;
}

export function configureLinuxPasswordStore(): boolean {
  if (process.platform !== "linux" || app.commandLine.hasSwitch("password-store")) return false;
  if (!chromiumPicksBasic(process.env)) return false;
  app.commandLine.appendSwitch("password-store", "gnome-libsecret");
  return true;
}
