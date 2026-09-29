/**
 * A packaged Linux host has no desktop session. Headless mode keeps the Electron process and its
 * hidden renderer up so agents and the Team API can run under Xvfb. It is not a Chromium
 * `--headless` switch: that flag is Chromium's own and must not be passed to the AppImage.
 */

export function readHeadlessMode(environment: NodeJS.ProcessEnv, argv: readonly string[]): boolean {
  const value = environment.OPENBOT_HEADLESS?.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no" || value === "") return false;
  return argv.includes("--openbot-headless");
}
