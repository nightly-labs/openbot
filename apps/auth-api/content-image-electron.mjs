// The Electron half of the article image generator. Plain JavaScript because
// Electron runs this file directly and cannot read TypeScript.
//
// It opens one hidden window, injects the bundle that render-content-images.ts
// built, and asks it for one data URL per image. The page is `about:blank` with
// context isolation on: the injected code runs in the isolated world, which
// shares the DOM but nothing else, and no file is ever loaded into the page.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow } from "electron";

// A build tool must not leave a process behind when its last window closes.
app.on("window-all-closed", () => app.quit());

// Printed before anything that can hang, so a build that sees this line and
// nothing after it knows the process ran and stopped on the way to ready.
console.log("content-images: Electron started.");

// No top-level await here. Electron sends `ready` only after this module has
// finished loading, so awaiting `app.whenReady()` at the top level waits for
// itself and never ends.
main().then(
  () => app.exit(0),
  (error) => {
    console.error(`content-images: ${error instanceof Error ? error.message : String(error)}`);
    app.exit(1);
  },
);

async function main() {
  const controlPath = process.argv[2];
  if (!controlPath) throw new Error("Pass the path of the control file as the first argument.");
  const control = JSON.parse(await readFile(controlPath, "utf8"));

  await app.whenReady();
  console.log(`content-images: the renderer is ready, ${control.jobs.length} images to draw.`);

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

    // One line per image. The build watches this: a long render and a stuck one
    // look the same from outside, and the only difference is whether anything
    // still arrives.
    let done = 0;
    for (const job of control.jobs) {
      const dataUrl = await window.webContents.executeJavaScript(
        `window.openBotContentImage.render(${JSON.stringify(job)})`,
      );
      await writeImage(path.join(control.outputDirectory, job.fileName), dataUrl);
      done += 1;
      console.log(`content-images: ${done}/${control.jobs.length} ${job.fileName}`);
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
