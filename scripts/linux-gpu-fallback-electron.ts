import { writeFileSync } from "node:fs";
import { app, BrowserWindow, crashReporter } from "electron";
import { configureLinuxGpu } from "../src/main/linux-gpu-mode";

function argument(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!value) throw new Error(`Missing --${name}=`);
  return value.slice(name.length + 3);
}

process.stdout.on("error", () => undefined);
process.stderr.on("error", () => undefined);
const userDataPath = argument("user-data");
app.setPath("userData", userDataPath);
crashReporter.start({ uploadToServer: false });
const mode = configureLinuxGpu({
  userDataPath,
  ownsInstance: true,
  server: process.argv.includes("--server"),
  startConfirmMs: Number(argument("confirm-ms")),
});
if (process.argv.includes("--hang-on-quit")) app.on("before-quit", (event) => event.preventDefault());
void app.whenReady().then(async () => {
  if (process.argv.includes("--context-lost")) {
    app.emit("child-process-gone", {}, { type: "GPU", reason: "abnormal-exit", exitCode: 34 << 8 });
  }
  const window = new BrowserWindow({ width: 480, height: 320 });
  await window.loadURL(
    `data:text/html,${encodeURIComponent(
      "<body style='margin:0;background:linear-gradient(45deg,#f60,#06f)'>" +
        "<div style='margin:40px;height:200px;backdrop-filter:blur(24px)'>GPU fallback</div></body>",
    )}`,
  );
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
