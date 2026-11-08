// Compiles and renders the production forms in an isolated DOM. No app or browser is started.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import solidPlugin from "@solidjs/vite-plugin";
import { build } from "vite";

interface DomReport {
  passed: boolean;
  checks: string[];
  before: string;
  after: string;
}
// The repository uses this typed boundary for jsdom, which has no bundled declarations.
const {
  JSDOM,
}: {
  JSDOM: new (
    html: string,
    options: { url: string; runScripts: "outside-only"; pretendToBeVisual: boolean },
  ) => { window: Window & typeof globalThis & { runHermesProfileDom: () => Promise<DomReport> } };
} = require("jsdom");

const out = resolve(import.meta.dirname, "../.openbot-build/hermes-profiles-dom-e2e");
await mkdir(out, { recursive: true });
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://fixture.invalid",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
dom.window.matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
});
dom.window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
try {
  const compiled = await build({
    configFile: false,
    plugins: [solidPlugin()],
    logLevel: "error",
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      "import.meta.url": JSON.stringify("https://fixture.invalid/fixture.js"),
    },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve(import.meta.dirname, "provider-fakes/hermes-profiles-dom.tsx"),
        formats: ["iife"],
        name: "HermesProfileDom",
      },
    },
  });
  const outputs = Array.isArray(compiled) ? compiled : [compiled];
  const chunk = outputs
    .flatMap((entry) => ("output" in entry ? entry.output : []))
    .find((entry) => entry.type === "chunk");
  assert.ok(chunk && chunk.type === "chunk", "DOM fixture did not compile");
  dom.window.eval(chunk.code);
  const run = dom.window.runHermesProfileDom;
  assert.equal(typeof run, "function");
  const report = await run();
  assert.equal(report.passed, true);
  await writeFile(resolve(out, "before.html"), report.before);
  await writeFile(resolve(out, "after.html"), report.after);
  await writeFile(
    resolve(out, "report.json"),
    `${JSON.stringify({ ...report, before: "before.html", after: "after.html" }, null, 2)}\n`,
  );
  // Machine-readable: production DOM verification.
  process.stdout.write(`${JSON.stringify({ passed: true, checks: report.checks }, null, 2)}\n`);
} catch (error) {
  await writeFile(
    resolve(out, "report.json"),
    `${JSON.stringify({ passed: false, error: error instanceof Error ? error.stack : String(error) }, null, 2)}\n`,
  );
  throw error;
} finally {
  dom.window.close();
}
