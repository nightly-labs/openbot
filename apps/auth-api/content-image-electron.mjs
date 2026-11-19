import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow } from "electron";

app.on("window-all-closed", () => app.quit());

console.log("content-images: Electron started.");

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
      paintWhenInitiallyHidden: true,
      backgroundThrottling: false,
    },
  });

  try {
    await window.loadURL("about:blank");
    await window.webContents.executeJavaScript(control.fontScript);
    await window.webContents.executeJavaScript(control.bundle);

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
