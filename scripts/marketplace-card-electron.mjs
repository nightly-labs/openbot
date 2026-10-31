// The Electron half of the Marketplace share cards. Plain JavaScript because Electron runs this file
// directly. It works as apps/auth-api/content-image-electron.mjs does: one hidden `about:blank`
// window with context isolation, the bundle that marketplace-card.ts built injected into it, and one
// PNG written per job. No file is ever loaded into the page.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow } from "electron";

app.on("window-all-closed", () => app.quit());

console.log("marketplace-cards: Electron started.");

// No top-level await: Electron sends `ready` only after this module has loaded, so awaiting
// `app.whenReady()` at the top level waits for itself.
main().then(
  () => app.exit(0),
  (error) => {
    console.error(`marketplace-cards: ${error instanceof Error ? error.message : String(error)}`);
    app.exit(1);
  },
);

async function main() {
  const controlPath = process.argv[2];
  if (!controlPath) throw new Error("Pass the path of the control file as the first argument.");
  const control = JSON.parse(await readFile(controlPath, "utf8"));

  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 630,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      paintWhenInitiallyHidden: true,
      backgroundThrottling: false,
    },
  });

  try {
    await window.loadURL("about:blank");
    await window.webContents.executeJavaScript(control.fontScript);
    await window.webContents.executeJavaScript(control.bundle);
    let done = 0;
    for (const item of control.items) {
      const dataUrl = await window.webContents.executeJavaScript(
        `window.openBotMarketplaceCard.render(${JSON.stringify(item.job)})`,
      );
      const comma = typeof dataUrl === "string" ? dataUrl.indexOf(",") : -1;
      if (comma === -1) throw new Error(`The page did not return a card for ${item.fileName}.`);
      const filePath = path.join(control.outputDirectory, item.fileName);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, Buffer.from(dataUrl.slice(comma + 1), "base64"));
      done += 1;
      console.log(`marketplace-cards: drew ${done}/${control.items.length}`);
    }
  } finally {
    window.destroy();
  }
}
