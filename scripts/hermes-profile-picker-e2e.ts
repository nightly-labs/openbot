import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import solidPlugin from "@solidjs/vite-plugin";
import { build } from "vite";
import {
  PROFILE_PICKER_CASES,
  type ProfilePickerCase,
  type ProfilePickerReport,
} from "./provider-fakes/hermes-profile-picker-report";

const selected = process.argv.slice(2);
const cases: ProfilePickerCase[] = [];
for (const name of selected.length ? selected : PROFILE_PICKER_CASES) {
  const known = PROFILE_PICKER_CASES.find((candidate) => candidate === name);
  assert.ok(known, `Unknown picker case ${name}.`);
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
        runHermesProfilePicker: (cases: ProfilePickerCase[]) => Promise<ProfilePickerReport>;
      };
  };
} = require("jsdom");

const out = resolve(import.meta.dirname, "../.openbot-build/hermes-profile-picker-e2e");
const reportName = selected.length ? cases.join("+") : "all";
await mkdir(out, { recursive: true });
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
let report: ProfilePickerReport | { passed: false; error: string };
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
        entry: resolve(import.meta.dirname, "provider-fakes/hermes-profile-picker.tsx"),
        formats: ["iife"],
        name: "HermesProfilePicker",
      },
    },
  });
  const chunk = (Array.isArray(compiled) ? compiled : [compiled])
    .flatMap((entry) => ("output" in entry ? entry.output : []))
    .find((entry) => entry.type === "chunk");
  assert.ok(chunk?.type === "chunk", "The production DOM fixture did not compile.");
  const root = resolve(import.meta.dirname, "..");
  const files = new Set([
    import.meta.filename,
    resolve(import.meta.dirname, "provider-fakes/hermes-profile-picker-report.ts"),
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
    `${JSON.stringify({ head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), sources }, null, 2)}\n`,
  );
  dom.window.eval(chunk.code);
  report = await dom.window.runHermesProfilePicker(cases);
} catch (error) {
  report = { passed: false, error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
} finally {
  dom.window.close();
}
await writeFile(resolve(out, `${reportName}.json`), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
