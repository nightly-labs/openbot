import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { app, BrowserWindow, screen, type WebContents, webContents } from "electron";
import { z } from "zod";
import { BrowserHost } from "../src/backend/browser-host";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DynamicToolCallParams, DynamicToolResult } from "../src/backend/protocol";

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixtureRoot = argument("fixture-root");
const reportPath = argument("report-path");
const runId = argument("run-id");
const pagePreload = argument("page-preload");

const cases: string[] = [];
const timings: Record<string, number> = {};
const sizeSchema = z.object({ outer: z.array(z.number()), inner: z.array(z.number()), visibility: z.string() });
const chromeSchema = z.object({
  keys: z.array(z.string()),
  types: z.array(z.string()),
  native: z.string(),
  constructs: z.boolean(),
});
const framesSchema = z.object({ sync: z.string(), syncLoadTimes: z.string(), loaded: z.string(), openbot: z.string() });
const pageEventSchema = z.object({
  type: z.string(),
  target: z.string(),
  trusted: z.boolean(),
  key: z.string().optional(),
  code: z.string().optional(),
  keyCode: z.number().optional(),
  shift: z.boolean(),
  x: z.number().optional(),
  y: z.number().optional(),
  at: z.number(),
});
interface ClickValues {
  moves: number;
  holdMs: number;
}
const values: {
  hiddenTab?: z.infer<typeof sizeSchema>;
  chrome?: z.infer<typeof chromeSchema>;
  frames?: z.infer<typeof framesSchema>;
  crossFrame?: string[];
  keys?: Array<Pick<z.infer<typeof pageEventSchema>, "key" | "code" | "keyCode" | "shift">>;
  hiddenClick?: ClickValues;
  shownClick?: ClickValues;
  webgl?: { real: Array<[string, string] | null>; tab: Array<[string, string] | null> };
} = {};
if (process.platform === "linux") {
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
}
const THREAD_ID = "fixture-thread";
const TURN_ID = "fixture-turn";

const PAGE = `<!doctype html><meta charset="utf-8"><title>fingerprint</title>
<input id="field" autocomplete="off"><input id="long" autocomplete="off"><input id="other" autocomplete="off">
<button id="target" style="margin:40px;width:120px;height:40px">Target</button>
<script>
  window.__events = [];
  const record = (event) => window.__events.push({
    type: event.type, target: event.target.id, trusted: event.isTrusted, key: event.key, code: event.code,
    keyCode: event.keyCode, shift: event.shiftKey, x: event.clientX, y: event.clientY, at: performance.now(),
  });
  for (const type of ["keydown", "keyup", "mousemove", "mousedown", "mouseup", "click"]) addEventListener(type, record, true);
</script>`;

const PRINT_PAGE = `<!doctype html><meta charset="utf-8"><title>print</title>
<script>
  window.__printEvents = 0;
  addEventListener("beforeprint", () => { window.__printEvents += 1; });
  window.__printResults = [String(print())];
  const frame = document.createElement("iframe");
  document.documentElement.appendChild(frame);
  frame.contentWindow.addEventListener("beforeprint", () => { window.__printEvents += 1; });
  window.__printResults.push(String(frame.contentWindow.print()));
  const written = document.createElement("iframe");
  document.documentElement.appendChild(written);
  const view = written.contentDocument.defaultView;
  view.addEventListener("beforeprint", () => { window.__printEvents += 1; });
  window.__printResults.push(String(view.print()));
</script>`;

const server = createServer((request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(request.url === "/print" ? PRINT_PAGE : PAGE);
});

let browser: BrowserHost | undefined;
let window: BrowserWindow | undefined;
let sequence = 0;
let currentPhase = "entry";

void main().catch((error) => {
  process.stderr.write(`${redactText(String(error))}\n`);
  app.exit(1);
});

async function main(): Promise<void> {
  app.setPath("userData", join(fixtureRoot, "profile"));
  app.setPath("sessionData", join(fixtureRoot, "session"));
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
  phase("entry-start");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object", "Fixture server address missing.");
    const origin = `http://127.0.0.1:${address.port}`;
    await app.whenReady();
    phase("electron-ready");
    window = new BrowserWindow({
      show: false,
      opacity: 0,
      width: 1024,
      height: 768,
      focusable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    browser = new BrowserHost(window, join(fixtureRoot, "downloads"), join(fixtureRoot, "tabs.json"), {
      pagePreload,
    });
    const host = browser;

    const call = async (tool: string, args: DynamicToolCallParams["arguments"]): Promise<DynamicToolResult> => {
      const result = await Effect.runPromise(
        host.handleDynamicTool({
          namespace: "openbot_browser",
          tool,
          arguments: args,
          ownerAgentId: "fixture-agent",
          threadId: THREAD_ID,
          turnId: TURN_ID,
          callId: `fingerprint-${++sequence}`,
        } satisfies DynamicToolCallParams),
      );
      const text = result.contentItems.find((content) => content.type === "inputText");
      assert.equal(result.success, true, text?.type === "inputText" ? text.text : `${tool} failed.`);
      return result;
    };
    const open = async (): Promise<{ tabId: string; contents: WebContents }> => {
      const tab = await runCauseEffect(host.open(`${origin}/page-${++sequence}`, THREAD_ID, "fixture-agent"));
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === tab.url);
      assert(contents, "Missing fixture contents.");
      return { tabId: tab.id, contents };
    };
    const page = async <T>(contents: WebContents, expression: string, schema: z.ZodType<T>): Promise<T> =>
      schema.parse(await contents.executeJavaScript(expression, true));
    const takeEvents = (contents: WebContents) =>
      page(
        contents,
        "(() => { const events = window.__events; window.__events = []; return events; })()",
        z.array(pageEventSchema),
      );

    phase("cases");
    const { tabId, contents } = await open();

    {
      const size = await page(
        contents,
        "({ outer: [outerWidth, outerHeight], inner: [innerWidth, innerHeight], visibility: document.visibilityState })",
        sizeSchema,
      );
      values.hiddenTab = size;
      const [outerWidth = 0, outerHeight = 0] = size.outer;
      const [innerWidth = 0, innerHeight = 0] = size.inner;
      assert(outerWidth >= innerWidth, `A hidden tab's outer width ${outerWidth} is below its viewport.`);
      assert(outerHeight > innerHeight, `A hidden tab's outer height ${outerHeight} is not above its viewport.`);
      recordCase("hidden-tab-outer-size-holds-viewport");
      const display = screen.getPrimaryDisplay().workAreaSize;
      assert.notDeepEqual(size.inner, [1200, 800], "A hidden tab still has the fixed 1200x800 viewport.");
      assert.equal(innerWidth, Math.max(800, display.width), "A hidden tab's width is not the display's width.");
      recordCase("hidden-tab-viewport-follows-display");
      assert.equal(size.visibility, "visible", "A hidden agent tab tells the page that it is hidden.");
      recordCase("hidden-tab-is-visible-to-page");
    }

    {
      const chrome = await page(
        contents,
        `({
          keys: Object.keys(window.chrome),
          types: [typeof chrome.loadTimes, typeof chrome.csi, typeof chrome.app, typeof chrome.loadTimes().requestTime],
          native: Function.prototype.toString.call(chrome.loadTimes),
          constructs: (() => { try { new chrome.csi(); return true; } catch { return false; } })(),
        })`,
        chromeSchema,
      );
      values.chrome = chrome;
      assert.deepEqual(chrome.keys, ["loadTimes", "csi", "app"]);
      assert.deepEqual(chrome.types, ["function", "function", "object", "number"]);
      assert.equal(chrome.native, "function loadTimes() { [native code] }");
      assert.equal(chrome.constructs, false, "chrome.csi can be called with new.");
      recordCase("window-chrome-matches-chrome");

      const getter = await page(
        contents,
        "Object.getOwnPropertyDescriptor(window, 'outerWidth').get.toString()",
        z.string(),
      );
      assert.equal(getter, "function get outerWidth() { [native code] }");
      const maskedToString = await page(contents, "Function.prototype.toString.toString()", z.string());
      assert.equal(maskedToString, "function toString() { [native code] }");
      recordCase("replaced-functions-read-as-native");

      const stacks = await page(
        contents,
        `[
          () => Function.prototype.toString.call({}),
          () => Object.getOwnPropertyDescriptor(window, 'outerWidth').get.call({}),
        ].map((call) => { try { call(); return 'no error'; } catch (error) { return error.stack; } })`,
        z.array(z.string()),
      );
      assert(
        stacks.every((stack) => stack !== "no error" && !/at Object\.apply \(<anonymous>:\d+/.test(stack)),
        `A replaced function shows its trap in the stack: ${stacks.join(" | ")}`,
      );
      recordCase("replaced-function-errors-have-native-stacks");

      const cyclic = await page(
        contents,
        `[
          Function.prototype.toString,
          Object.getOwnPropertyDescriptor(window, 'outerWidth').get,
          Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get,
          WebGLRenderingContext.prototype.getParameter,
        ].map((method) => {
          const prototype = Object.getPrototypeOf(method);
          let result;
          try {
            Object.setPrototypeOf(method, Object.create(method));
            result = 'no error';
          } catch (error) {
            result = error instanceof TypeError ? error.message : 'not a TypeError';
            if (String(error.stack).includes('at Object.setPrototypeOf (<anonymous>:')) result += ' (trap frame)';
          }
          Object.setPrototypeOf(method, prototype);
          return Object.getPrototypeOf(method) === prototype ? result : result + ' (not restored)';
        })`,
        z.array(z.string()),
      );
      assert.deepEqual(cyclic, Array(4).fill("Cyclic __proto__ value"));
      recordCase("replaced-functions-refuse-cyclic-prototypes");

      const readGpu = `(() => ['webgl', 'webgl2'].map((kind) => {
        const gl = document.createElement('canvas').getContext(kind);
        const info = gl?.getExtension('WEBGL_debug_renderer_info');
        return info ? [gl.getParameter(info.UNMASKED_VENDOR_WEBGL), gl.getParameter(info.UNMASKED_RENDERER_WEBGL)] : null;
      }))()`;
      const gpuSchema = z.array(z.tuple([z.string(), z.string()]).nullable());
      const plain = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
      try {
        await plain.loadURL(`${origin}/plain`);
        values.webgl = {
          real: await page(plain.webContents, readGpu, gpuSchema),
          tab: await page(contents, readGpu, gpuSchema),
        };
      } finally {
        plain.destroy();
      }
      const getParameterSource = await page(
        contents,
        "[WebGLRenderingContext, WebGL2RenderingContext].map((context) => context.prototype.getParameter.toString())",
        z.array(z.string()),
      );
      assert.deepEqual(getParameterSource, Array(2).fill("function getParameter() { [native code] }"));
      const { real, tab } = values.webgl;
      if (process.platform === "linux") {
        assert(
          real.every((names) => names !== null),
          "A Linux server has no WebGL.",
        );
      }
      assert(
        tab.every((names) => names === null || !/SwiftShader/i.test(names.join())),
        `An agent tab names SwiftShader: ${JSON.stringify(tab)}`,
      );
      real.forEach((names, index) => {
        if (names && !/SwiftShader/i.test(names.join())) {
          assert.deepEqual(tab[index], names, "An agent tab changed the name of a real GPU.");
        }
      });
      recordCase("software-webgl-names-a-gpu");
    }

    {
      await call("evaluate", {
        tabId,
        expression: `(() => {
          let reads = 0;
          const error = new Error('probe');
          Error.prepareStackTrace = (formatted) => {
            if (formatted === error) reads += 1;
            return String(formatted);
          };
          console.debug(error);
          delete Error.prepareStackTrace;
          window.__consoleReads = reads;
          return reads;
        })()`,
      });
      assert.equal(
        await page(contents, "window.__consoleReads", z.number()),
        0,
        "The agent's evaluate lets DevTools read the page's console arguments.",
      );
      recordCase("agent-evaluate-leaves-console-unread");

      const failed = await Effect.runPromise(
        host.handleDynamicTool({
          namespace: "openbot_browser",
          tool: "evaluate",
          arguments: { tabId, expression: "(() => { throw new Error('page failure') })()" },
          ownerAgentId: "fixture-agent",
          threadId: THREAD_ID,
          turnId: TURN_ID,
          callId: `fingerprint-${++sequence}`,
        } satisfies DynamicToolCallParams),
      );
      const failure = failed.contentItems.find((content) => content.type === "inputText");
      assert.equal(failed.success, false, "A page error in evaluate was reported as a success.");
      assert(
        failure?.type === "inputText" && failure.text.includes("page failure"),
        "The evaluate error does not hold the page's message.",
      );
      recordCase("agent-evaluate-reports-page-errors");
    }

    {
      const printTab = await runCauseEffect(host.open(`${origin}/print`, THREAD_ID, "fixture-agent"));
      const printContents = webContents.getAllWebContents().find((item) => item.getURL() === printTab.url);
      assert(printContents, "Missing print fixture contents.");
      const printed = await page(
        printContents,
        "({ events: window.__printEvents, results: window.__printResults, native: print.toString() })",
        z.object({ events: z.number(), results: z.array(z.string()), native: z.string() }),
      );
      assert.equal(printed.events, 0, "A page in an agent tab started to print.");
      assert.deepEqual(printed.results, Array(3).fill("undefined"));
      assert.equal(printed.native, "function print() { [native code] }");
      recordCase("agent-tab-refuses-page-print");
      await runCauseEffect(host.close(printTab.id));
    }

    {
      const frames = await page(
        contents,
        `(async () => {
          const iframe = document.createElement('iframe');
          iframe.srcdoc = 'blank page';
          document.body.appendChild(iframe);
          const sync = typeof iframe.contentWindow.chrome;
          const syncLoadTimes = typeof iframe.contentWindow.chrome?.loadTimes;
          iframe.remove();
          const loaded = await new Promise((resolve) => {
            const frame = document.createElement('iframe');
            frame.src = '/frame';
            frame.onload = () => {
              resolve(typeof frame.contentWindow.chrome.loadTimes);
              frame.remove();
            };
            document.body.appendChild(frame);
          });
          return { sync, syncLoadTimes, loaded, openbot: typeof window.openbot + typeof window.require };
        })()`,
        framesSchema,
      );
      values.frames = frames;
      assert.equal(frames.sync, "object", "A new srcdoc frame has no window.chrome.");
      assert.equal(frames.syncLoadTimes, "function");
      assert.equal(frames.loaded, "function", "The preload did not run in a loaded frame.");
      recordCase("frame-window-chrome-matches-chrome");
      assert.equal(frames.openbot, "undefinedundefined", "The tab page can reach window.openbot or require.");
      recordCase("page-has-no-openbot-bridge");

      const crossFrame = await page(
        contents,
        `new Promise((resolve) => {
          const frame = document.createElement('iframe');
          frame.srcdoc = 'blank page';
          frame.onload = () => {
            const child = frame.contentWindow;
            const outer = (target) => Object.getOwnPropertyDescriptor(target, 'outerWidth').get;
            resolve([
              child.Function.prototype.toString.call(chrome.loadTimes),
              child.Function.prototype.toString.call(outer(window)),
              Function.prototype.toString.call(child.chrome.loadTimes),
              Function.prototype.toString.call(outer(child)),
              Function.prototype.toString.call(child.Function.prototype.toString),
            ]);
            frame.remove();
          };
          document.body.appendChild(frame);
        })`,
        z.array(z.string()),
      );
      values.crossFrame = crossFrame;
      assert.deepEqual(crossFrame, [
        "function loadTimes() { [native code] }",
        "function get outerWidth() { [native code] }",
        "function loadTimes() { [native code] }",
        "function get outerWidth() { [native code] }",
        "function toString() { [native code] }",
      ]);
      recordCase("frames-read-each-others-functions-as-native");
    }

    {
      await takeEvents(contents);
      const text = "Hi there 42!";
      const started = performance.now();
      await call("type", { tabId, target: { kind: "css", selector: "#field" }, text });
      timings.typeShortMs = Math.round(performance.now() - started);
      assert.equal(await page(contents, "document.getElementById('field').value", z.string()), text);
      const keys = (await takeEvents(contents)).filter((event) => event.type === "keydown");
      values.keys = keys.map(({ key, code, keyCode, shift }) => ({ key, code, keyCode, shift }));
      assert.equal(keys.length, text.length, "Short text was not typed as one key per character.");
      assert(
        keys.every((event) => event.trusted && (event.keyCode ?? 0) > 0 && event.code !== "Unidentified"),
        "A typed key has no key code.",
      );
      assert.equal(keys[0]?.shift, true, "An upper-case letter was typed without Shift.");
      assert.equal(keys[0]?.code, "KeyH");
      assert.equal(keys.at(-1)?.code, "Digit1");
      recordCase("short-text-types-key-events");

      const long = "a".repeat(200);
      const longStarted = performance.now();
      await call("type", { tabId, target: { kind: "css", selector: "#long" }, text: long });
      timings.typeLongMs = Math.round(performance.now() - longStarted);
      assert.equal(await page(contents, "document.getElementById('long').value", z.string()), long);
      assert.equal(
        (await takeEvents(contents)).filter((event) => event.type === "keydown").length,
        0,
        "Long text was typed key by key.",
      );
      recordCase("long-text-is-inserted");

      const mixed = "zażółć ok";
      await call("type", { tabId, target: { kind: "css", selector: "#other" }, text: mixed });
      assert.equal(await page(contents, "document.getElementById('other').value", z.string()), mixed);
      recordCase("text-with-no-us-key-is-inserted");

      await takeEvents(contents);
      const code = "if (x) {";
      await call("type", { tabId, target: { kind: "css", selector: "#long" }, text: code });
      assert.equal(await page(contents, "document.getElementById('long').value", z.string()), code);
      assert.equal(
        (await takeEvents(contents)).filter((event) => event.type === "keydown").length,
        0,
        "Text with an opening bracket was typed key by key.",
      );
      recordCase("text-that-editors-complete-is-inserted");
    }

    const click = async () => {
      await takeEvents(contents);
      const started = performance.now();
      await call("click", { tabId, target: { kind: "css", selector: "#target" } });
      const elapsed = Math.round(performance.now() - started);
      const events = await takeEvents(contents);
      const moves = events.filter((event) => event.type === "mousemove");
      const down = events.find((event) => event.type === "mousedown");
      const up = events.find((event) => event.type === "mouseup");
      assert(
        events.some((event) => event.type === "click" && event.target === "target" && event.trusted),
        "The click did not reach the button.",
      );
      assert(down && up && up.at - down.at >= 25, "The button was released with no hold.");
      return { elapsed, moves, holdMs: Math.round(up.at - down.at) };
    };

    {
      const hidden = await click();
      timings.hiddenClickMs = hidden.elapsed;
      values.hiddenClick = { moves: hidden.moves.length, holdMs: hidden.holdMs };
      recordCase("hidden-tab-click-lands-and-holds");
    }

    {
      assert(window, "Missing fixture window.");
      window.showInactive();
      await runCauseEffect(host.activate(tabId));
      await runCauseEffect(host.setVisible({ visible: true, bounds: { x: 0, y: 0, width: 1000, height: 700 } }));
      const shown = await click();
      timings.shownClickMs = shown.elapsed;
      values.shownClick = { moves: shown.moves.length, holdMs: shown.holdMs };
      assert(shown.moves.length >= 3, `The pointer moved in ${shown.moves.length} events, not along a path.`);
      assert(new Set(shown.moves.map((move) => `${move.x},${move.y}`)).size >= 3, "The pointer path has no length.");
      recordCase("shown-tab-click-moves-along-path");
    }

    await writeReport("passed");
    app.exit(0);
  } catch (error) {
    await writeReport("failed", error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    server.close();
    window?.destroy();
  }
}

function phase(name: string): void {
  currentPhase = name;
}

function recordCase(name: string): void {
  cases.push(name);
}

async function writeReport(status: "passed" | "failed", reason?: string): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        status,
        runId,
        sourceSha: argument("source-sha"),
        harnessRuntime: argument("harness-runtime"),
        bunVersion: argument("bun-version"),
        electron: process.versions.electron,
        platform: process.platform,
        phase: currentPhase,
        cases,
        timings,
        values,
        ...(reason === undefined ? {} : { reason: redactText(reason) }),
      },
      null,
      2,
    )}\n`,
  );
}
