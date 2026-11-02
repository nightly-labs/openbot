// A Claude agent session on Windows when the Claude CLI is a `.cmd` wrapper. The npm install of
// Claude Code puts `claude.cmd` on PATH. Node does not start a `.cmd` with no shell (`spawn EINVAL`),
// so the session failed to start and the provider row showed "spawn EINVAL". The real Claude Agent
// SDK starts a stand-in CLI in a folder whose name holds a space, in two variants:
//   - `npm`: the npm wrapper. The SDK starts the program that the wrapper names, with no `cmd.exe`.
//   - `other-wrapper`: any other `.cmd`. It starts through `cmd.exe`. The stand-in does not stop at
//     the end of its input, so only a kill of the whole `cmd.exe` tree stops it.
// Windows only. `bun run test:claude:windows-cmd`; exit 0 = each session started with the arguments
// unchanged, and stop left no Claude process. Writes .openbot-build/claude-windows-cmd-e2e/report.json.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import { runCauseEffect } from "../src/backend/effect-boundary";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-windows-cmd-e2e");

interface VariantReport {
  name: string;
  passed: boolean;
  argv?: string[];
  parent?: string;
  standInStopped?: boolean;
  error?: string;
}

interface Variant {
  name: string;
  /** Whether `cmd.exe` starts the stand-in. */
  throughCmd: boolean;
  /** Writes the stand-in program and its wrapper in `bin`, and returns the wrapper path. */
  install: (bin: string, standIn: string) => Promise<string>;
}

const VARIANTS: Variant[] = [
  {
    name: "npm",
    throughCmd: false,
    install: async (bin, standIn) => {
      const program = join(bin, "node_modules", "@anthropic-ai", "claude-code");
      await mkdir(program, { recursive: true });
      await writeFile(join(program, "cli.js"), standIn);
      // The shape that npm's `cmd-shim` writes for a JavaScript program.
      const wrapper = join(bin, "claude.cmd");
      await writeFile(
        wrapper,
        [
          "@ECHO off",
          "GOTO start",
          ":find_dp0",
          "SET dp0=%~dp0",
          "EXIT /b",
          ":start",
          "SETLOCAL",
          "CALL :find_dp0",
          `SET _prog=${process.execPath}`,
          'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
          "",
        ].join("\r\n"),
      );
      return wrapper;
    },
  },
  {
    name: "other-wrapper",
    throughCmd: true,
    install: async (bin, standIn) => {
      await writeFile(join(bin, "stand-in.cjs"), standIn);
      const wrapper = join(bin, "claude.cmd");
      await writeFile(wrapper, `@"${process.execPath}" "%~dp0stand-in.cjs" %*\r\n`);
      return wrapper;
    },
  },
];

if (process.platform !== "win32") {
  process.stdout.write("Windows only.\n");
  process.exit(1);
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor<T>(what: string, read: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read().catch(() => null);
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(what);
    await new Promise((done) => setTimeout(done, 50));
  }
}

async function readStandIn(file: string): Promise<{ pid: number; ppid: number; argv: string[] }> {
  const value = JSON.parse(await readFile(file, "utf8"));
  assert.ok(isDynamicRecord(value) && isNumber(value.pid) && isNumber(value.ppid) && Array.isArray(value.argv));
  return { pid: value.pid, ppid: value.ppid, argv: value.argv.filter(isString) };
}

/** The image name of a running process, such as `cmd.exe`. */
function imageName(pid: number): string {
  const row = execFileSync("tasklist", ["/fo", "csv", "/nh", "/fi", `PID eq ${pid}`], { encoding: "utf8" });
  return /^"([^"]+)"/.exec(row.trim())?.[1]?.toLowerCase() ?? "";
}

async function runVariant(variant: Variant): Promise<VariantReport> {
  const report: VariantReport = { name: variant.name, passed: false };
  const root = await mkdtemp(join(tmpdir(), `openbot-claude-windows-cmd-e2e-${variant.name}-`));
  let client: ClaudeAgentClient | null = null;
  let standInPid: number | null = null;
  try {
    // A user folder such as `C:\Users\Jane Doe`: `cmd.exe` splits an unquoted path at the space.
    const bin = join(root, "Jane Doe", "npm");
    await mkdir(bin, { recursive: true });
    const recorded = join(root, "stand-in.json");
    const standIn = [
      'const fs = require("node:fs");',
      `const file = ${JSON.stringify(recorded)};`,
      'fs.writeFileSync(file + ".tmp", JSON.stringify({ pid: process.pid, ppid: process.ppid, argv: process.argv.slice(2) }));',
      'fs.renameSync(file + ".tmp", file);',
      "process.stdin.resume();",
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n");
    const executable = await variant.install(bin, standIn);
    const workspace = join(root, "workspace");
    await mkdir(workspace);

    client = new ClaudeAgentClient({ executable, version: "2.1.310", source: "system" });
    client.start();
    await runCauseEffect(client.request("thread/start", { cwd: workspace, persistSession: false }, (value) => value));

    const started = await waitFor("The Claude process did not start.", () => readStandIn(recorded), 10_000);
    standInPid = started.pid;
    report.argv = started.argv;
    report.parent = imageName(started.ppid);
    assert.equal(report.parent === "cmd.exe", variant.throughCmd, "Only another wrapper starts through cmd.exe.");
    const format = started.argv.indexOf("--output-format");
    assert.ok(format >= 0 && started.argv[format + 1] === "stream-json", "The arguments arrive unchanged.");
    assert.ok(
      started.argv.includes("--setting-sources=user,project,local"),
      "An argument with commas arrives as one argument.",
    );

    await runCauseEffect(client.stop());
    client = null;
    report.standInStopped = await waitFor(
      "The Claude process is still running after stop.",
      async () => (running(started.pid) ? null : true),
      15_000,
    );
    report.passed = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (client) await runCauseEffect(client.stop()).catch(() => undefined);
    if (standInPid !== null && running(standInPid)) execFileSync("taskkill", ["/pid", String(standInPid), "/T", "/F"]);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
  return report;
}

const variants: VariantReport[] = [];
for (const variant of VARIANTS) variants.push(await runVariant(variant));
const report = { passed: variants.every((variant) => variant.passed), variants };
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.passed ? 0 : 1);
