import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { chromium } from "playwright-core";
import { z } from "zod";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { RemoteDesktopRuntimePaths } from "../src/main/remote-desktop-runtime-artifact";
import { RemoteScreenGateway } from "../src/main/remote-screen-gateway";
import { SunshineMoonlightRuntime } from "../src/main/sunshine-moonlight-runtime";

declare global {
  interface Window {
    openbotNoPictureE2eReport?: (data: unknown) => void;
  }
}

const logger = createOpenBotLogger("remote-desktop-no-picture-e2e");
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/remote-desktop-no-picture-e2e");
const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const browserExecutable = option("browser-executable");
const MARKER = "sunshine-software-encoder";
const NO_PICTURE_TEXT = sourceText("error.remote.noPictureSwitchEncoder");
const TOO_SLOW_TEXT = sourceText("error.remote.streamTooSlowLowerQuality");
const UNUSED_PATHS: RemoteDesktopRuntimePaths = {
  sunshine: "/nonexistent/sunshine",
  moonlightWebServer: "/nonexistent/web-server",
  moonlightStreamer: "/nonexistent/streamer",
};
const DISPLAY = { id: "1", label: "Primary display", width: 1920, height: 1080, primary: true };
const STREAM_WITHOUT_FRAMES = `<!doctype html><html><head><meta charset="utf-8"><script>
window.RTCPeerConnection = class {
  connectionState = "connected";
  async getStats() { return new Map([["video", { type: "inbound-rtp", kind: "video", framesDecoded: 0 }]]); }
};
</script></head><body><script>addEventListener("load", () => { window.openbotE2ePeer = new RTCPeerConnection(); });</script></body></html>`;

const viewerReportSchema = z.object({
  source: z.literal("openbot-moonlight"),
  type: z.literal("viewer-state"),
  state: z.string(),
  message: z.string().optional(),
  noPicture: z.boolean().optional(),
});
type ViewerReport = z.infer<typeof viewerReportSchema>;

function listen(server: Server): Promise<number> {
  return new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolveListen(typeof address === "object" && address !== null ? address.port : 0);
    }),
  );
}

function createRuntime(platform: "win32" | "linux", stateDirectory: string) {
  return new SunshineMoonlightRuntime({
    paths: UNUSED_PATHS,
    stateDirectory,
    platform,
    credentials: { username: "openbot-e2e", password: "openbot-local-e2e-only" },
    getDisplays: () => [DISPLAY],
    getIceServers: () => Effect.succeed([]),
    allocateSunshineBasePort: () => Effect.succeed(47_990),
    allocateMoonlightPort: () => Effect.succeed(48_990),
    allocateWebRtcPortRange: () => Effect.succeed({ min: 49_000, max: 49_010 }),
    spawnProcess: () => {
      throw new Error("The E2E test does not start Sunshine.");
    },
  });
}

async function startHost(platform: "win32" | "linux", sessionCount: number) {
  const moonlight = createServer((request, response) => {
    if ((request.url ?? "").startsWith("/stream.html")) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(STREAM_WITHOUT_FRAMES);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const moonlightPort = await listen(moonlight);
  const stateDirectory = await mkdtemp(join(tmpdir(), `openbot-no-picture-e2e-${platform}-`));
  const runtime = createRuntime(platform, stateDirectory);
  const gateway = new RemoteScreenGateway({
    platform,
    unattended: false,
    runtimePaths: UNUSED_PATHS,
    runtimeStateDirectory: stateDirectory,
    getRuntimeCredentials: () => Effect.succeed({ username: "openbot-e2e", password: "openbot-local-e2e-only" }),
    getDisplays: () => [DISPLAY],
    getIceServers: () => Effect.succeed([]),
    createRuntime: () => ({
      start: () =>
        Effect.succeed({
          authHeader: "x-openbot-e2e",
          baseUrl: `http://127.0.0.1:${moonlightPort}`,
          hostId: 1,
          hostIds: [1, 2, 3, 4],
          desktopAppId: 1,
          displays: [DISPLAY],
          selectedDisplayId: DISPLAY.id,
        }),
      selectDisplay: () => Effect.void,
      stop: () => Effect.void,
      canSwitchToSoftwareEncoder: () => runtime.canSwitchToSoftwareEncoder(),
      noPictureReceived: runtime.noPictureReceived,
    }),
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!gateway.handlesHttp(url)) {
      response.writeHead(404);
      response.end();
      return;
    }
    void runCauseEffect(gateway.handleHttp(request, response, url));
  });
  const origin = `http://127.0.0.1:${await listen(server)}`;
  const viewerUrls: string[] = [];
  for (let index = 0; index < sessionCount; index += 1) {
    const session = await runCauseEffect(
      gateway.createSession({
        serverId: `no-picture-e2e-${platform}`,
        memberId: `no-picture-e2e-member-${index + 1}`,
        teamSessionId: `no-picture-e2e-team-session-${index + 1}`,
        teamSessionExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        publicHttpBaseUrl: origin,
      }),
    );
    viewerUrls.push(`${session.viewerUrl}#${session.viewerGrant}`);
  }
  const close = async () => {
    await runCauseEffect(gateway.stop());
    server.close();
    moonlight.close();
  };
  return { runtime, stateDirectory, viewerUrls, close };
}

async function markerUntil(stateDirectory: string): Promise<number | null> {
  return readFile(join(stateDirectory, MARKER), "utf8").then(Number, () => null);
}

async function sunshineEncoderLines(runtime: SunshineMoonlightRuntime, stateDirectory: string): Promise<string[]> {
  await Effect.runPromise(Effect.exit(runtime.start()));
  await Effect.runPromise(Effect.exit(runtime.stop()));
  const config = await readFile(join(stateDirectory, "sunshine.conf"), "utf8");
  return config.split("\n").filter((line) => line.startsWith("encoder"));
}

const browser = await chromium.launch(
  browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
);

async function watchUntilError(viewerUrl: string): Promise<ViewerReport> {
  const page = await browser.newPage();
  try {
    const errorReport = new Promise<ViewerReport>((resolveReport) => {
      void page.exposeBinding("openbotNoPictureE2eReport", (_source, data: unknown) => {
        const report = viewerReportSchema.safeParse(data);
        if (report.success && report.data.state === "error") resolveReport(report.data);
      });
    });
    await page.addInitScript(() => {
      addEventListener("message", (event) => window.openbotNoPictureE2eReport?.(event.data));
    });
    const hostHandledError = page.waitForResponse(
      (response) =>
        response.url().endsWith("/viewer-state") &&
        response.request().method() === "POST" &&
        viewerReportSchema.safeParse(response.request().postDataJSON()).data?.state === "error",
      { timeout: 120_000 },
    );
    await page.goto(viewerUrl);
    await page.waitForURL(/\/moonlight\/stream\.html/);
    const [report, response] = await Promise.all([errorReport, hostHandledError]);
    assert.equal(response.status(), 204);
    return report;
  } finally {
    await page.close();
  }
}

await mkdir(OUT, { recursive: true });
const [windowsHost, linuxHost, sharedWindowsHost] = await Promise.all([
  startHost("win32", 1),
  startHost("linux", 1),
  startHost("win32", 2),
]);
try {
  const [windowsReport, linuxReport, ...sharedReports] = await Promise.all([
    watchUntilError(windowsHost.viewerUrls[0] ?? ""),
    watchUntilError(linuxHost.viewerUrls[0] ?? ""),
    ...sharedWindowsHost.viewerUrls.map(watchUntilError),
  ]);

  assert.equal(windowsReport.noPicture, true);
  assert.equal(windowsReport.message, NO_PICTURE_TEXT);
  const windowsUntil = await markerUntil(windowsHost.stateDirectory);
  assert.ok(windowsUntil !== null && windowsUntil > Date.now(), "The Windows host saves the software encoder choice.");
  const windowsEncoder = await sunshineEncoderLines(windowsHost.runtime, windowsHost.stateDirectory);
  assert.deepEqual(windowsEncoder, ["encoder = software"]);
  assert.equal(windowsHost.runtime.canSwitchToSoftwareEncoder(), false);

  await writeFile(join(windowsHost.stateDirectory, MARKER), String(Date.now() - 1));
  const expiredEncoder = await sunshineEncoderLines(windowsHost.runtime, windowsHost.stateDirectory);
  assert.deepEqual(expiredEncoder, []);
  assert.equal(await markerUntil(windowsHost.stateDirectory), null);

  assert.equal(linuxReport.message, TOO_SLOW_TEXT);
  assert.equal(linuxReport.noPicture, undefined);
  assert.equal(await markerUntil(linuxHost.stateDirectory), null);

  assert.equal(sharedReports.length, 2);
  for (const sharedReport of sharedReports) {
    assert.equal(sharedReport.message, TOO_SLOW_TEXT);
    assert.equal(sharedReport.noPicture, undefined);
  }
  assert.equal(await markerUntil(sharedWindowsHost.stateDirectory), null);

  const report = {
    windows: { viewerReport: windowsReport, softwareEncoderUntil: windowsUntil, sunshineEncoder: windowsEncoder },
    windowsAfterExpiry: { sunshineEncoder: expiredEncoder },
    linux: { viewerReport: linuxReport },
    windowsWithTwoSessions: { viewerReports: sharedReports },
  };
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info("Remote desktop no-picture E2E passed.", { report: join(OUT, "report.json") });
} finally {
  await browser.close();
  for (const host of [windowsHost, linuxHost, sharedWindowsHost]) {
    await host.close();
    await rm(host.stateDirectory, { force: true, recursive: true });
  }
}
