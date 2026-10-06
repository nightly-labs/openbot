import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { resolveRemoteDesktopRuntime } from "../src/main/remote-desktop-runtime-artifact";
import { SunshineMoonlightRuntime } from "../src/main/sunshine-moonlight-runtime";

const logger = createOpenBotLogger("remote-desktop-runtime-smoke");

// Linux runs under a virtual X11 display, such as `xvfb-run`.
if (process.platform !== "darwin" && process.platform !== "linux") {
  throw new Error("The local runtime smoke test supports macOS and Linux only.");
}

const paths = await Effect.runPromise(
  resolveRemoteDesktopRuntime({
    isPackaged: false,
    resourcesPath: process.cwd(),
    sourceRoot: resolve("."),
    platform: process.platform,
    architecture: process.arch,
  }),
);
if (!paths) throw new Error("Build or install the remote desktop runtime before the smoke test.");
const stateDirectory = await mkdtemp(join(tmpdir(), "openbot-remote-runtime-smoke-"));
const runtime = new SunshineMoonlightRuntime({
  paths,
  stateDirectory,
  platform: process.platform,
  credentials: {
    username: process.env.OPENBOT_SMOKE_USERNAME ?? `openbot-${randomBytes(8).toString("hex")}`,
    password: process.env.OPENBOT_SMOKE_PASSWORD ?? randomBytes(24).toString("base64url"),
  },
  // The runtime shows only the Sunshine displays that match a local display, as Electron lists them.
  getDisplays: () => [{ id: "1", label: "Primary display", width: 1920, height: 1080, primary: true }],
  getIceServers: () => Effect.succeed([{ urls: "stun:127.0.0.1:3478" }]),
  onDiagnostic: (source, message) => process.stderr.write(`[${source}] ${message}`),
});

try {
  const state = await runCauseEffect(runtime.start());
  if (!state.baseUrl.startsWith("http://127.0.0.1:")) throw new Error("Moonlight Web did not bind to loopback.");
  if (state.hostIds.length !== 4 || !state.hostIds.every(Number.isInteger) || !Number.isInteger(state.desktopAppId)) {
    throw new Error("Moonlight Web did not pair with the Sunshine Desktop application.");
  }
  if (state.displays.length === 0 || !state.selectedDisplayId) {
    throw new Error("Sunshine did not return a native display identifier.");
  }
  const streamPage = await fetch(`${state.baseUrl}/stream.html`);
  if (!streamPage.ok) throw new Error(`Moonlight stream page failed with HTTP ${streamPage.status}.`);
  logger.info(
    `Remote desktop runtime is ready on loopback (hosts ${state.hostIds.join(", ")}, app ${state.desktopAppId}).`,
  );
} finally {
  await runCauseEffect(runtime.stop());
  await rm(stateDirectory, { recursive: true, force: true });
}
