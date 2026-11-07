// Electron side of `scripts/attachment-video-seek-e2e.ts`. It serves `--video` with `fileResponse` on
// `openbot-attachment`, with the scheme privileges of `src/main/index.ts`, as
// `src/main/session-configuration.ts` does. A page on the scheme asks for byte ranges and seeks a
// <video>. The result goes to `--report`, and then the app quits.
import { writeFileSync } from "node:fs";
import { app, BrowserWindow, protocol } from "electron";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { fileResponse } from "../src/main/file-response";

function argument(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!value) throw new Error(`Missing --${name}=`);
  return value.slice(name.length + 3);
}

// The page runs this. A seek that does not end in 10 seconds counts as failed.
const PROBE = `(async () => {
  const url = "openbot-attachment://local/video";
  const ranged = async (range) => {
    const response = await fetch(url, { headers: { Range: range } });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      range,
      status: response.status,
      contentRange: response.headers.get("Content-Range"),
      acceptRanges: response.headers.get("Accept-Ranges"),
      length: bytes.length,
      head: Array.from(bytes.subarray(0, 4)),
    };
  };
  const size = Number((await fetch(url, { method: "HEAD" })).headers.get("Content-Length"));
  const ranges = [];
  for (const range of ["bytes=100-199", "bytes=-100", "bytes=" + size + "-", "bytes=100-", "bytes=-" + (size + 100), "bytes=5-3"]) {
    ranges.push(await ranged(range));
  }
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  document.body.append(video);
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error("The video did not load: " + video.error?.message));
    video.src = url;
  });
  const target = video.duration * 0.75;
  const seeked = new Promise((resolve) => video.addEventListener("seeked", () => resolve(true), { once: true }));
  video.currentTime = target;
  const done = await Promise.race([seeked, new Promise((resolve) => setTimeout(() => resolve(false), 10000))]);
  const seekable = video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0;
  return { size, ranges, duration: video.duration, seekable, target, seeked: done, currentTime: video.currentTime };
})()`;

// A closed output must not stop the test app with an error dialog.
process.stdout.on("error", () => undefined);
process.stderr.on("error", () => undefined);
app.setPath("userData", argument("user-data"));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "openbot-attachment",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);
const videoPath = argument("video");
const reportPath = argument("report");
// No top-level await: Electron does not get ready until an ESM main module has run to its end.
void app.whenReady().then(async () => {
  protocol.handle("openbot-attachment", (request) =>
    new URL(request.url).pathname === "/video"
      ? runCauseEffect(fileResponse(videoPath, request, { "Content-Type": "video/mp4" }))
      : new Response("<!doctype html><body></body>", { headers: { "Content-Type": "text/html" } }),
  );
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  try {
    await window.loadURL("openbot-attachment://local/page");
    writeFileSync(reportPath, JSON.stringify(await window.webContents.executeJavaScript(PROBE)));
  } catch (error) {
    writeFileSync(reportPath, JSON.stringify({ error: String(error) }));
  }
  app.quit();
});
