// Builds only the production routine editor's DOM harness. No browser, GUI, provider or live host.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CreateRoutineInput, UpdateRoutineInput } from "@openbot/contracts/ipc";
import solidPlugin from "@solidjs/vite-plugin";
import { Schema } from "effect";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "vite";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { parseCreateRoutine, parseUpdateRoutine } from "../src/main/ipc/agent-inputs";

const out = resolve(import.meta.dirname, "../.openbot-build/routine-silent-status-dom-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-routine-dom-"));
const database = new OpenBotDatabase(root);
const routines = new AgentRoutineStore(database);
const agentId = "dom-fixture";
const saves: { action: string; input: CreateRoutineInput | UpdateRoutineInput }[] = [];
const api = {
  listRoutines: async () => routines.list(agentId),
  createRoutine: async (input: CreateRoutineInput) => {
    saves.push({ action: "create", input });
    return routines.create(parseCreateRoutine(input));
  },
  updateRoutine: async (input: UpdateRoutineInput) => {
    saves.push({ action: "update", input });
    return routines.update(parseUpdateRoutine(input));
  },
  listRoutineRuns: async () => [],
  deleteRoutine: async () => {
    throw new Error("Delete is outside this fixture.");
  },
  testRoutine: async () => {
    throw new Error("Test is outside this fixture.");
  },
  onEvent: () => () => {},
};
let dom: JSDOM | undefined;
let passed = false;
let checks: string[] = [];
try {
  await runCauseEffect(database.initialize());
  await mkdir(out, { recursive: true });
  await build({
    configFile: false,
    logLevel: "warn",
    plugins: [solidPlugin()],
    define: { "import.meta.env.PROD": "false", "process.env.NODE_ENV": JSON.stringify("test"), "process.env": "{}" },
    build: {
      emptyOutDir: false,
      outDir: out,
      minify: false,
      lib: {
        entry: resolve(import.meta.dirname, "routine-silent-status-dom-fixture.tsx"),
        name: "SilentRoutineDom",
        formats: ["iife"],
        fileName: () => "fixture.js",
      },
    },
  });
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => {
    throw error;
  });
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://fixture.invalid",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole,
  });
  Object.defineProperty(dom.window, "structuredClone", { value: structuredClone });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }),
  });
  Object.defineProperty(dom.window, "ResizeObserver", {
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  Object.defineProperty(dom.window, "IntersectionObserver", {
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  const report = JSON.parse(
    await readFile(resolve(out, "../routine-silent-status-e2e/consumer-messages.json"), "utf8"),
  );
  Object.defineProperty(dom.window, "silentRoutineFixture", {
    value: {
      api,
      saved: async () => routines.list(agentId),
      messages: report.messages,
      silentRunId: report.silentRunId,
    },
  });
  // Network is outside this fixture. Any attempted request fails the test.
  Object.defineProperty(dom.window, "fetch", {
    value: () => {
      throw new Error("Network is disabled in this fixture.");
    },
  });
  dom.window.eval(await readFile(join(out, "fixture.js"), "utf8"));
  const result = Schema.decodeUnknownSync(
    Schema.Struct({ checks: Schema.Array(Schema.String), html: Schema.Array(Schema.String) }),
  )(await dom.window.eval("window.runSilentRoutineEditor()"));
  checks = [...result.checks];
  for (const [index, html] of result.html.entries()) await writeFile(join(out, `render-${index + 1}.html`), html);
  database.close();
  const reopened = new OpenBotDatabase(root);
  await runCauseEffect(reopened.initialize());
  assert.equal(new AgentRoutineStore(reopened).list(agentId)[0]?.silent, false);
  reopened.close();
  checks.push("The edited value remains after the database reopens.");
  passed = true;
} finally {
  dom?.window.close();
  if (!passed) database.close();
  await writeFile(
    join(out, "report.json"),
    JSON.stringify(
      {
        passed,
        checks,
        saves,
        scope: "Production DOM components and isolated SQLite. Native layout and Electron are not verified.",
      },
      null,
      2,
    ),
  );
  await rm(root, { recursive: true, force: true });
}
