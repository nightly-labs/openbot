// Electron side of `scripts/linux-gpu-fallback-e2e.ts`. It starts the GPU mode as `src/main/index.ts`
// does and opens a window with a blurred backdrop. It reports the WebGL renderer of the page.
// It writes the state to `--ready-file` when the page has loaded. A "quit" line or the end of stdin
// quits the app, so the app also quits when the test stops. A "crash" line crashes the main process.
import { writeFileSync } from "node:fs";
import { app, BrowserWindow, crashReporter } from "electron";
import { configureLinuxGpu } from "../src/main/linux-gpu-mode";

function argument(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!value) throw new Error(`Missing --${name}=`);
  return value.slice(name.length + 3);
}

// A closed output must not stop the test app with an error dialog.
process.stdout.on("error", () => undefined);
process.stderr.on("error", () => undefined);
const userDataPath = argument("user-data");
app.setPath("userData", userDataPath);
// As `src/main/index.ts`, with its default `crashDumps` path: the next start reads the dumps.
crashReporter.start({ uploadToServer: false });
const mode = configureLinuxGpu({
  userDataPath,
  ownsInstance: true,
  server: process.argv.includes("--server"),
  startConfirmMs: Number(argument("confirm-ms")),
});
// `--hang-on-quit`: a teardown that does not end, as when `dev:stop` or the shutdown deadline stops it.
if (process.argv.includes("--hang-on-quit")) app.on("before-quit", (event) => event.preventDefault());
// No top-level await: Electron does not get ready until an ESM main module has run to its end.
void app.whenReady().then(async () => {
  // `--context-lost`: the exit of a GPU process that Chromium restarts after a GPU context loss.
  // A test cannot make the driver lose the context, so it sends the event that Electron sends.
  if (process.argv.includes("--context-lost")) {
    app.emit("child-process-gone", {}, { type: "GPU", reason: "abnormal-exit", exitCode: 34 });
  }
  const window = new BrowserWindow({ width: 480, height: 320 });
  await window.loadURL(
    `data:text/html,${encodeURIComponent(
      "<body style='margin:0;background:linear-gradient(45deg,#f60,#06f)'>" +
        "<div style='margin:40px;height:200px;backdrop-filter:blur(24px)'>GPU fallback</div></body>",
    )}`,
  );
  // The renderer name shows if WebGL runs on the GPU driver or on SwiftShader, or is null without WebGL.
  const webglRenderer: string | null = await window.webContents.executeJavaScript(
    `(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      if (!gl) return null;
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    })()`,
  );
  writeFileSync(
    argument("ready-file"),
    JSON.stringify({
      pid: process.pid,
      mode,
      hardwareAccelerationEnabled: app.isHardwareAccelerationEnabled(),
      gpuCompositing: app.getGPUFeatureStatus().gpu_compositing,
      webglRenderer,
      crashDumps: app.getPath("crashDumps"),
    }),
  );
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    if (chunk.includes("crash")) process.crash();
    if (chunk.includes("quit")) app.quit();
  });
  process.stdin.on("end", () => app.quit());
});
