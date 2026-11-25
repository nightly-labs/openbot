import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Effect } from "effect";
import { app, BrowserWindow } from "electron";
import { keepOverlayOnAllHyprlandWorkspaces } from "../src/main/linux-hyprland-overlay";
import { restartOnXWaylandForAboveApps, takeXWaylandRestartMarker } from "../src/main/linux-wayland-output";

const reportFile = process.env.OPENBOT_E2E_REPORT ?? "";

function record(value: unknown): void {
  appendFileSync(reportFile, `${JSON.stringify(value)}\n`);
}

const restartedFor = takeXWaylandRestartMarker(process.env, process.argv);

async function checkRestart(): Promise<void> {
  if (restartedFor !== null) {
    record({
      role: "child",
      reason: restartedFor,
      platform: app.commandLine.getSwitchValue("ozone-platform"),
      argv: process.argv.slice(2),
    });
    app.exit(0);
    return;
  }
  const restarted = await Effect.runPromise(restartOnXWaylandForAboveApps(process.env, app.getPath("userData")));
  record({ role: "parent", restarted, platform: app.commandLine.getSwitchValue("ozone-platform") });
  app.exit(0);
}

async function showOverlay(): Promise<void> {
  await app.whenReady();
  const window = new BrowserWindow({
    x: 100,
    y: 100,
    width: 320,
    height: 240,
    show: false,
    transparent: true,
    frame: false,
    type: "splash",
  });
  keepOverlayOnAllHyprlandWorkspaces(window, process.env);
  await window.loadURL("about:blank");
  window.showInactive();
  const bounds = window.getBounds();
  process.stdout.write(`@@shown ${JSON.stringify({ pid: process.pid, width: bounds.width, height: bounds.height })}\n`);
  createInterface({ input: process.stdin }).on("close", () => {
    window.destroy();
    app.exit(0);
  });
}

if (process.env.OPENBOT_E2E_SCENARIO === "restart") void checkRestart();
else void showOverlay();
