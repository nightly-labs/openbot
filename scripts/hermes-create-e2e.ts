import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import solidPlugin from "@solidjs/vite-plugin";
import { build } from "vite";
import {
  HERMES_CREATE_CASES,
  type HermesCreateCase,
  type HermesCreateReport,
} from "./provider-fakes/hermes-create-report";

const selected = process.argv.slice(2);
const cases: HermesCreateCase[] = [];
for (const name of selected.length ? selected : HERMES_CREATE_CASES) {
  const known = HERMES_CREATE_CASES.find((candidate) => candidate === name);
  assert.ok(known, `Unknown create case ${name}.`);
  cases.push(known);
}
const {
  JSDOM,
}: {
  JSDOM: new (
    html: string,
    options: { url: string; runScripts: "outside-only"; pretendToBeVisual: boolean },
  ) => {
    window: Window &
      typeof globalThis & {
        runHermesCreate: (cases: HermesCreateCase[]) => Promise<HermesCreateReport>;
        hermesCreateProgress: (stage: string) => void;
      };
  };
} = require("jsdom");

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, ".openbot-build/hermes-create-e2e");
const reportName = selected.length ? cases.join("+") : "all";
await mkdir(out, { recursive: true });
function createDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://fixture.invalid",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.matchMedia = (media) => ({
    matches: false,
    media,
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
  dom.window.hermesCreateProgress = (stage) => process.stdout.write(`${stage}\n`);
  return dom;
}
let dom = createDom();
const contextImports = [
  "../../providers",
  "../account/account-context",
  "../custom-agents/custom-agents-context",
  "../onboarding/onboarding-context",
  "../servers/server-settings",
  "../servers/servers-context",
  "./agent-actions",
  "./agents-context",
];
let report: HermesCreateReport | { passed: false; setupError: string };
try {
  const compiled = await build({
    configFile: false,
    plugins: [solidPlugin()],
    resolve: {
      alias: contextImports.map((find) => ({
        find,
        replacement: resolve(import.meta.dirname, "provider-fakes/hermes-create-contexts.tsx"),
      })),
    },
    logLevel: "error",
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      "import.meta.url": JSON.stringify("https://fixture.invalid/fixture.js"),
    },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve(import.meta.dirname, "provider-fakes/hermes-create.tsx"),
        formats: ["iife"],
        name: "HermesCreate",
      },
    },
  });
  const chunk = (Array.isArray(compiled) ? compiled : [compiled])
    .flatMap((entry) => ("output" in entry ? entry.output : []))
    .find((entry) => entry.type === "chunk");
  assert.ok(chunk?.type === "chunk", "The production create fixture did not compile.");
  const files = new Set([
    import.meta.filename,
    resolve(import.meta.dirname, "provider-fakes/hermes-create-report.ts"),
    ...contextImports.map((path) => resolve(root, "src/renderer/src/features/agents", `${path}.tsx`)),
    ...Object.keys(chunk.modules)
      .filter((path) => ["src/", "packages/", "scripts/"].some((prefix) => path.startsWith(resolve(root, prefix))))
      .map((path) => path.replace(/\?.*$/u, "")),
  ]);
  const sources = [];
  for (const file of [...files].sort()) {
    sources.push({
      path: relative(root, file),
      sha256: createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
    });
  }
  await writeFile(
    resolve(out, `${reportName}.sources.json`),
    `${JSON.stringify({ head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), contextImports, sources }, null, 2)}\n`,
  );
  const combined: HermesCreateReport = { passed: false, interface: "", cases: [] };
  for (const name of cases) {
    dom.window.eval(chunk.code);
    const part = await dom.window.runHermesCreate([name]);
    combined.interface = part.interface;
    combined.cases.push(...part.cases);
    dom.window.close();
    dom = createDom();
  }
  combined.passed = combined.cases.every((result) => result.passed);
  report = combined;
} catch (error) {
  report = { passed: false, setupError: error instanceof Error ? (error.stack ?? error.message) : String(error) };
} finally {
  dom.window.close();
}
await writeFile(resolve(out, `${reportName}.json`), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
