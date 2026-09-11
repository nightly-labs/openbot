// The Electron half of the news image generator. Plain JavaScript because
// Electron runs this file directly and cannot read TypeScript.
//
// It opens one hidden window, injects the bundle that news-og-images.ts built,
// and asks it for one data URL per image. The page is `about:blank` with context
// isolation on: the injected code runs in the isolated world, which shares the
// DOM but nothing else, and no file is ever loaded into the page.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow } from "electron";

// SwiftShader rather than the real GPU. A CI runner has no GPU at all, and using
// the same rasteriser everywhere means a locally built image and a CI-built image
// are the same picture.
app.commandLine.appendSwitch("use-gl", "angle");
app.commandLine.appendSwitch("use-angle", "swiftshader");
app.commandLine.appendSwitch("enable-unsafe-swiftshader");

// A build tool must not leave a process behind when its last window closes.
app.on("window-all-closed", () => app.quit());

try {
  await main();
  app.exit(0);
} catch (error) {
  console.error(`news-og: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
}

async function main() {
  const controlPath = process.argv[2];
  if (!controlPath) throw new Error("Pass the path of the control file as the first argument.");
  const control = JSON.parse(await readFile(controlPath, "utf8"));

  await app.whenReady();

  const window = new BrowserWindow({
    show: false,
    width: control.viewportWidth,
    height: control.viewportHeight,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webgl: true,
      // A hidden window still has to produce frames: the shader library sizes its
      // canvas from a ResizeObserver, which only runs on a rendering tick.
      paintWhenInitiallyHidden: true,
      backgroundThrottling: false,
    },
  });

  try {
    await window.loadURL("about:blank");
    await window.webContents.executeJavaScript(control.fontScript);
    await window.webContents.executeJavaScript(control.bundle);

    for (const job of control.jobs) {
      const dataUrl = await window.webContents.executeJavaScript(`window.openBotNewsOg.render(${JSON.stringify(job)})`);
      await writeImage(path.join(control.outputDirectory, job.fileName), dataUrl);
    }
  } finally {
    window.destroy();
  }
}

async function writeImage(filePath, dataUrl) {
  const comma = typeof dataUrl === "string" ? dataUrl.indexOf(",") : -1;
  if (comma === -1) throw new Error(`The page did not return an image for ${filePath}.`);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(dataUrl.slice(comma + 1), "base64"));
}
