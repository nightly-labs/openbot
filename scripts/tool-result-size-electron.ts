import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { redactText } from "@openbot/logging";
import { app, BrowserWindow, nativeImage, screen, webContents } from "electron";
import { z } from "zod";
import { BrowserHost } from "../src/backend/browser-host";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DynamicToolCallParams, DynamicToolResult } from "../src/backend/protocol";
import { parseBrowserToolText } from "./browser-snapshot-text";

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixtureRoot = argument("fixture-root");
const reportPath = argument("report-path");
const runId = argument("run-id");

/** The marked box that the click case finds in the screenshot, in CSS pixels. */
const BOX = { left: 300, top: 200, width: 120, height: 80 };
/** About 50 KB of JSON: under the old 64 KB failure limit, over a model text cap. */
const LARGE_VALUE = `Array.from({ length: 900 }, (_, id) => ({ id, name: "item " + id, text: "lorem ipsum dolor sit" }))`;
/** About 90 KB of JSON: over the 64 KB limit. */
const OVERSIZE_VALUE = `Array.from({ length: 1600 }, (_, id) => ({ id, name: "item " + id, text: "lorem ipsum dolor sit" }))`;

const measurements: Record<string, number | boolean | string> = {};
const snapshotSchema = z.object({ tabId: z.string(), revision: z.number(), url: z.string() });

const server = createServer((request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (request.url === "/long") response.end(longPage());
  else response.end(boxPage());
});

let browser: BrowserHost | undefined;
let window: BrowserWindow | undefined;
let sequence = 0;

void main().catch((error) => {
  process.stderr.write(`${redactText(String(error))}\n`);
  app.exit(1);
});

async function main(): Promise<void> {
  app.setPath("userData", join(fixtureRoot, "profile"));
  app.setPath("sessionData", join(fixtureRoot, "session"));
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object", "Fixture server address missing.");
    const origin = `http://127.0.0.1:${address.port}`;
    await app.whenReady();
    window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      focusable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    browser = new BrowserHost(window, join(fixtureRoot, "downloads"), join(fixtureRoot, "tabs.json"));
    const host = browser;
    const call = (tool: string, args: DynamicToolCallParams["arguments"]) =>
      runCauseEffect(
        host.handleDynamicTool({
          namespace: "openbot_browser",
          tool,
          arguments: args,
          ownerAgentId: "fixture-agent",
          threadId: "fixture-thread",
          turnId: "fixture-turn",
          callId: `size-${++sequence}`,
        }),
      );
    const text = (result: DynamicToolResult) => {
      const item = result.contentItems.find((content) => content.type === "inputText");
      assert(item?.type === "inputText", "Missing tool text.");
      return item.text;
    };
    const image = (result: DynamicToolResult) => {
      const item = result.contentItems.find((content) => content.type === "inputImage");
      assert(item?.type === "inputImage", "Missing tool image.");
      return item.imageUrl;
    };
    const open = async (path: string) => {
      const tab = await runCauseEffect(host.open(`${origin}${path}`, "fixture-thread", "fixture-agent"));
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === tab.url);
      assert(contents, "Missing owned fixture contents.");
      const first = snapshotSchema.parse(
        parseBrowserToolText(text(await call("snapshot", { tabId: tab.id, image: "never" }))),
      );
      return { tab, contents, revision: first.revision };
    };

    measurements.displayScaleFactor = screen.getPrimaryDisplay().scaleFactor;
    const page = await open("/box");
    const viewport = z
      .object({ width: z.number(), height: z.number(), scale: z.number() })
      .parse(
        await page.contents.executeJavaScript("({ width: innerWidth, height: innerHeight, scale: devicePixelRatio })"),
      );
    measurements.cssViewport = `${viewport.width}x${viewport.height}`;
    measurements.devicePixelRatio = viewport.scale;

    // Full screenshot: the size, the bytes and Claude's estimate of image tokens (width × height / 750).
    const shotUrl = image(await call("screenshot", { tabId: page.tab.id }));
    const shot = nativeImage.createFromDataURL(shotUrl);
    const shotSize = shot.getSize();
    measurements.screenshotPixels = `${shotSize.width}x${shotSize.height}`;
    measurements.screenshotBase64Bytes = shotUrl.length;
    measurements.screenshotEstimatedTokens = Math.ceil((shotSize.width * shotSize.height) / 750);
    measurements.screenshotMatchesCssViewport =
      shotSize.width === viewport.width && shotSize.height === viewport.height;

    // A point read from the image must hit the box: the image pixel is the CSS pixel of the click.
    const box = markedBox(shot);
    assert(box, "The marked box is not in the screenshot.");
    const point = { x: Math.round((box.left + box.right) / 2), y: Math.round((box.top + box.bottom) / 2) };
    measurements.boxCenterInImage = `${point.x},${point.y}`;
    const clicked = await call("click", { tabId: page.tab.id, target: { kind: "point", ...point }, snapshot: false });
    assert.equal(clicked.success, true, text(clicked));
    measurements.pointFromImageHitsBox = (await page.contents.executeJavaScript("window.boxClicks")) === 1;

    // An emulated viewport: a point read from the image must still hit the box.
    const shotAndClick = async () => {
      const css = z
        .object({ width: z.number(), height: z.number() })
        .parse(await page.contents.executeJavaScript("({ width: innerWidth, height: innerHeight })"));
      const emulated = nativeImage.createFromDataURL(image(await call("screenshot", { tabId: page.tab.id })));
      const size = emulated.getSize();
      const found = markedBox(emulated);
      assert(found, "The marked box is not in the emulated screenshot.");
      const before = Number(await page.contents.executeJavaScript("window.boxClicks"));
      const at = { x: Math.round((found.left + found.right) / 2), y: Math.round((found.top + found.bottom) / 2) };
      const result = await call("click", { tabId: page.tab.id, target: { kind: "point", ...at }, snapshot: false });
      assert.equal(result.success, true, text(result));
      const after = Number(await page.contents.executeJavaScript("window.boxClicks"));
      return `${size.width}x${size.height} image, ${css.width}x${css.height} CSS, ${after === before + 1 ? "hit" : "miss"}`;
    };
    for (const [name, environment] of [
      ["emulatedLargerThanView", { preset: "custom", width: 1920, height: 1200, deviceScaleFactor: 1 }],
      ["emulatedScale3", { preset: "custom", width: 800, height: 600, deviceScaleFactor: 3 }],
      ["emulatedMobilePreset", { preset: "mobile" }],
    ] as const) {
      const set = await call("set_environment", { tabId: page.tab.id, ...environment });
      assert.equal(set.success, true, text(set));
      measurements[name] = await shotAndClick();
    }
    const reset = await call("set_environment", { tabId: page.tab.id, preset: "fill" });
    assert.equal(reset.success, true, text(reset));

    // Element screenshot of the box.
    const read = parseBrowserToolText(text(await call("snapshot", { tabId: page.tab.id, image: "never" })));
    const boxElement = z
      .object({ elements: z.array(z.object({ ref: z.string(), name: z.string() })) })
      .parse(read)
      .elements.find((element) => element.name === "Target");
    assert(boxElement, "The box element has no ref.");
    const elementUrl = image(await call("screenshot", { tabId: page.tab.id, ref: boxElement.ref }));
    const elementSize = nativeImage.createFromDataURL(elementUrl).getSize();
    measurements.elementScreenshotPixels = `${elementSize.width}x${elementSize.height}`;
    measurements.elementScreenshotBase64Bytes = elementUrl.length;

    // The snapshot image, when the agent asks for it.
    const withImage = await call("snapshot", { tabId: page.tab.id, image: "always" });
    const snapshotImage = nativeImage.createFromDataURL(image(withImage)).getSize();
    measurements.snapshotImagePixels = `${snapshotImage.width}x${snapshotImage.height}`;

    // Large text results.
    const evaluated = await call("evaluate", { tabId: page.tab.id, expression: LARGE_VALUE });
    measurements.evaluateValueJsonChars = JSON.stringify(await page.contents.executeJavaScript(LARGE_VALUE)).length;
    measurements.evaluateResultChars = text(evaluated).length;
    measurements.evaluateSuccess = evaluated.success;
    const oversize = await call("evaluate", { tabId: page.tab.id, expression: OVERSIZE_VALUE }).then(
      (result) => ({ success: result.success, text: text(result) }),
      (error: unknown) => ({ success: false, text: String(error) }),
    );
    measurements.evaluateOver64KbSuccess = oversize.success;
    measurements.evaluateOver64KbResultChars = oversize.text.length;
    // The engine gives no part of this value, so the error must say how to get it.
    measurements.evaluateOver64KbSaysHow = oversize.text.includes("JSON.stringify(value).slice(0, ");

    const script = await call("run_script", {
      tabId: page.tab.id,
      finalSnapshot: false,
      script: `return await evaluate(${JSON.stringify(LARGE_VALUE)});`,
    });
    measurements.runScriptResultChars = text(script).length;
    measurements.runScriptSuccess = script.success;
    const scriptWithSnapshot = await call("run_script", {
      tabId: page.tab.id,
      script: `return await evaluate(${JSON.stringify(LARGE_VALUE)});`,
    });
    measurements.runScriptWithSnapshotResultChars = text(scriptWithSnapshot).length;

    // A value whose escaped form is much longer than its JSON: the cut must still end.
    const quoted = await call("run_script", {
      tabId: page.tab.id,
      finalSnapshot: false,
      script: `return '"'.repeat(20000);`,
    });
    measurements.runScriptQuotedResultChars = text(quoted).length;
    // A string value is cut in its own characters, so the note counts what the script returned.
    const quotedPayload = z.object({ value: z.string(), valueCut: z.string() }).safeParse(JSON.parse(text(quoted)));
    measurements.runScriptStringNoteCountsString =
      quotedPayload.success &&
      quotedPayload.data.valueCut.includes(`first ${quotedPayload.data.value.length} of 20000 characters`);

    // The agent reads a large value in slices of 16,000 characters and follows each note. The escaped
    // form of a slice is longer than the limit, so each slice is cut again. The parts must join to the value.
    const fullJson = JSON.stringify(await page.contents.executeJavaScript(LARGE_VALUE));
    let joined = "";
    let partReads = 0;
    let partCuts = 0;
    let notesAgree = true;
    for (let start: number | null = 0; start !== null && partReads < 20; ) {
      partReads += 1;
      const part = text(
        await call("evaluate", {
          tabId: page.tab.id,
          expression: `JSON.stringify(${LARGE_VALUE}).slice(${start}, ${start + 16_000})`,
        }),
      );
      const newline = part.indexOf("\n");
      const got = z.string().parse(JSON.parse(newline < 0 ? part : part.slice(0, newline)));
      joined += got;
      if (newline < 0) start = got.length === 16_000 ? start + got.length : null;
      else {
        const note = part.slice(newline + 1);
        partCuts += 1;
        notesAgree &&= note.includes(`first ${got.length} of 16000 characters`) && note.includes(`N + ${got.length}`);
        start += got.length;
      }
    }
    measurements.partReads = partReads;
    measurements.partCuts = partCuts;
    measurements.partNotesCountTheSlice = notesAgree;
    measurements.partsJoinToValue = joined === fullJson;

    const long = await open("/long");
    measurements.longSnapshotResultChars = text(await call("snapshot", { tabId: long.tab.id, image: "never" })).length;

    const report = {
      status: "passed",
      runId,
      sourceSha: argument("source-sha"),
      electron: process.versions.electron,
      measurements,
      scope:
        "Owned hidden native process, temporary profile, and loopback pages. BrowserHost.handleDynamicTool. No provider calls. Image tokens are Claude's width × height / 750 estimate before any provider resize.",
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      `${JSON.stringify({ status: "failed", runId, measurements, reason: redactText(String(error)) }, null, 2)}\n`,
    );
    process.exitCode = 1;
  } finally {
    if (browser) await runCauseEffect(browser.destroy());
    if (window && !window.isDestroyed()) window.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.exit(Number(process.exitCode ?? 0));
  }
}

/** The bounds, in image pixels, of the pure magenta pixels. */
function markedBox(image: Electron.NativeImage) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      // BGRA.
      const blue = bitmap[offset] ?? 0;
      const green = bitmap[offset + 1] ?? 255;
      const red = bitmap[offset + 2] ?? 0;
      if (blue > 240 && green < 15 && red > 240) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
}

function boxPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Box</title>
    <style>body { margin: 0; background: #fff; }</style>
    <button type="button" aria-label="Target" onclick="window.boxClicks = (window.boxClicks || 0) + 1"
      style="position: fixed; left: ${BOX.left}px; top: ${BOX.top}px; width: ${BOX.width}px; height: ${BOX.height}px; background: #ff00ff; border: 0; padding: 0"></button>
    <script>window.boxClicks = 0;</script>`;
}

function longPage(): string {
  const items = Array.from(
    { length: 1500 },
    (_, index) => `<p>Paragraph ${index}: lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>`,
  ).join("");
  const links = Array.from({ length: 300 }, (_, index) => `<a href="#l${index}">Link number ${index}</a>`).join(" ");
  return `<!doctype html><meta charset="utf-8"><title>Long</title><main>${links}${items}</main>`;
}
