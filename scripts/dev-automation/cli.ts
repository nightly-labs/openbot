// AI-facing bridge to the live dev app. Read-only by default; anything that
// changes app state needs --allow-mutations. This tool never seeds, resets or
// copies openbot.db: it drives the instance you already have open.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { readScriptArguments } from "../script-arguments";
import {
  assertMutationAllowed,
  connectToDevApp,
  describeDevPages,
  devBrowserPages,
  matchPages,
  openDevBrowser,
  readTargetId,
  resolveAutomationPort,
} from "./cdp-client";
import { compareProfiles, profileCpu } from "./cpu-profile";
import { parseCpuReport } from "./cpu-sampling";
import {
  type DevInstanceRecord,
  type DevInstanceService,
  describeDevInstance,
  readDevInstanceRecords,
  selectDevInstance,
} from "./instance-registry";
import { profileMemory, writeHeapSnapshot } from "./memory-profile";
import {
  clickByRole,
  parseAutomationRole,
  parseWaitTarget,
  reportableScreenshotPath,
  resolveScreenshotPath,
  resolveWritablePath,
  screenshotTo,
  snapshotPage,
  typeByRole,
  type WaitTarget,
  waitForRole,
} from "./tools";

// Diagnostics go to stderr so stdout carries only the final JSON document,
// which stays parseable for the calling agent.
// `debug` so the renderer console and page errors this tool subscribes to are
// visible; the default `info` threshold would drop them.
const logger = createOpenBotLogger("dev-automation", (line) => process.stderr.write(`${line}\n`), "debug");

const DEFAULT_TIMEOUT_MS = 10_000;
const SCREENSHOT_ROOT = join(process.cwd(), ".openbot-build", "dev-automation");
const CPU_ROOT = join(SCREENSHOT_ROOT, "cpu");
const MEMORY_ROOT = join(SCREENSHOT_ROOT, "memory");
const DEFAULT_CPU_DURATION_MS = 60_000;
const MAX_CPU_DURATION_MS = 600_000;
const DEFAULT_CPU_INTERVAL_MS = 5_000;
// A sampler that runs every few hundred milliseconds becomes the load it is
// there to measure, and the counters it reads are cumulative, so nothing is
// lost by asking rarely.
const MIN_CPU_INTERVAL_MS = 1_000;

const USAGE = [
  "Usage: bun scripts/dev-automation/cli.ts <instances|pages|snapshot|click|type|screenshot|cpu|memory> [flags]",
  "",
  "Target:     --instance=<id> | --port=<port>, --service=<app|test-client>, --page=<target-id|url-substring>",
  "click/type: --role=<role> --name=<name> [--text=<text>] [--submit] [--exact] --allow-mutations",
  "Waiting:    --wait-for=<role>,<name>, --timeout=<ms>",
  "screenshot: --out=<path>",
  "cpu:        --duration=<ms> --interval=<ms> --label=<name> --compare=<report.json> --out=<path>",
  "memory:     --label=<name> --heap-snapshot=<target-id|url-substring> --out=<path>",
].join("\n");

const OPTIONS = {
  "allow-mutations": { type: "boolean" },
  compare: { type: "string" },
  duration: { type: "string" },
  exact: { type: "boolean" },
  "heap-snapshot": { type: "string" },
  instance: { type: "string" },
  interval: { type: "string" },
  label: { type: "string" },
  name: { type: "string" },
  out: { type: "string" },
  page: { type: "string" },
  port: { type: "string" },
  role: { type: "string" },
  service: { type: "string" },
  submit: { type: "boolean" },
  text: { type: "string" },
  timeout: { type: "string" },
  "wait-for": { type: "string" },
} as const;

type Flags = NonNullable<ReturnType<typeof readScriptArguments<typeof OPTIONS>>>["values"];
type StringFlag = {
  [Name in keyof typeof OPTIONS]: (typeof OPTIONS)[Name]["type"] extends "string" ? Name : never;
}[keyof typeof OPTIONS];

// `null` means the flag is absent, `""` means it was passed empty. The two
// differ for `--text=`, which legitimately clears a field.
function flagValue(flags: Flags, name: StringFlag): string | null {
  return flags[name] ?? null;
}

function requireFlagValue(flags: Flags, name: StringFlag): string {
  const value = flagValue(flags, name);
  if (value === null || value === "") throw new Error(`Missing required --${name}=<value>.`);
  return value;
}

function requireTextFlag(flags: Flags): string {
  const value = flagValue(flags, "text");
  if (value === null) throw new Error("Missing required --text=<value>.");
  return value;
}

function readTimeout(flags: Flags): number {
  const raw = flagValue(flags, "timeout");
  if (raw === null) return DEFAULT_TIMEOUT_MS;
  const timeout = Number(raw);
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 120_000) {
    throw new Error("--timeout must be an integer of 1..120000 ms.");
  }
  return timeout;
}

// Dev is meant to be fully testable, so any window can be driven - but the
// aim has to be deliberate. An empty selector would match every target and
// land wherever the list happens to start.
function readPageSelector(flags: Flags): string | null {
  const raw = flagValue(flags, "page");
  if (raw === null) return null;
  if (raw.trim() === "") throw new Error("--page=<target-id|url-substring> cannot be empty.");
  return raw;
}

// Honoured by every command: before the capture for `snapshot` and
// `screenshot`, after the action for `click` and `type`, which is where the
// race actually is.
function readWaitTarget(flags: Flags): WaitTarget | null {
  const raw = flagValue(flags, "wait-for");
  if (raw === null) return null;
  if (raw.trim() === "") throw new Error("--wait-for=<role>,<name> cannot be empty.");
  return parseWaitTarget(raw);
}

function readMilliseconds(flags: Flags, name: StringFlag, fallback: number, minimum: number, maximum: number): number {
  const raw = flagValue(flags, name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`--${name} must be an integer of ${minimum}..${maximum} ms.`);
  }
  return value;
}

function readService(flags: Flags): DevInstanceService {
  const raw = flagValue(flags, "service");
  if (raw === null || raw === "app") return "app";
  if (raw === "test-client") return "test-client";
  throw new Error("--service must be app or test-client.");
}

interface AutomationTarget {
  port: number;
  expectedRendererPort: number | null;
  // The dev supervisor process the registry published, and the anchor for the
  // `ps` walk in `cpu`. Null when no record owns this port.
  pid: number | null;
  instanceNamed: boolean;
  description: string;
}

// Resolution order, and why: an explicit port or instance is an instruction
// and wins. Otherwise the registry decides, and the record of the worktree
// this command runs in is the one an agent almost always means - the default
// port is a last resort, kept read-only by `instanceNamed: false`.
function resolveTarget(flags: Flags, records: DevInstanceRecord[], service: DevInstanceService): AutomationTarget {
  const explicitPort = resolveAutomationPort(
    flagValue(flags, "port") ?? undefined,
    process.env.OPENBOT_DEV_REMOTE_DEBUGGING_PORT,
  );
  const requestedInstance = flagValue(flags, "instance");
  if (requestedInstance !== null && flagValue(flags, "port") !== null) {
    throw new Error("Pass either --instance=<id> or --port=<port>, not both: they can name different instances.");
  }
  if (explicitPort.explicit && requestedInstance === null) {
    const published = records.find((record) => record.remoteDebuggingPort === explicitPort.port);
    // An explicit port is an instruction and stays authoritative - this is dev,
    // and driving another worktree's app on purpose is legitimate. But a
    // mistyped digit resolves silently to a different developer's profile,
    // where a click or a keystroke lands in real conversations, so say whose
    // app this is rather than refuse it.
    if (published && resolve(published.projectRoot) !== resolve(process.cwd())) {
      logger.warn(
        `--port=${explicitPort.port} belongs to another worktree (${published.projectRoot}), not this one. ` +
          "Mutations will change that instance's profile.",
      );
    }
    return {
      port: explicitPort.port,
      expectedRendererPort: published?.rendererPort ?? null,
      pid: published?.pid ?? null,
      instanceNamed: true,
      description: published ? describeDevInstance(published) : `:${explicitPort.port}`,
    };
  }
  const selection = selectDevInstance(records, {
    projectRoot: process.cwd(),
    instanceId: requestedInstance,
    service,
  });
  if (selection.kind === "ambiguous") {
    throw new Error(
      `${selection.candidates.length} dev instances match. Re-run with --instance=<id>:\n` +
        selection.candidates.map((record) => `- ${describeDevInstance(record)}`).join("\n"),
    );
  }
  if (selection.kind === "unknown") {
    if (requestedInstance !== null) {
      throw new Error(
        `No live dev instance has --instance=${requestedInstance}. ` +
          (selection.candidates.length > 0
            ? `Live now:\n${selection.candidates.map((record) => `- ${describeDevInstance(record)}`).join("\n")}`
            : "Nothing is published; start `bun run dev` in the worktree you mean."),
      );
    }
    return {
      port: explicitPort.port,
      expectedRendererPort: null,
      pid: null,
      instanceNamed: false,
      description: `:${explicitPort.port} (no registry record)`,
    };
  }
  return {
    port: selection.record.remoteDebuggingPort,
    expectedRendererPort: selection.record.rendererPort,
    pid: selection.record.pid,
    // A foreign instance is the dev app of another worktree. Readable, so an
    // agent can still take a snapshot, but not something to click blind.
    instanceNamed: selection.match !== "foreign",
    description: `${describeDevInstance(selection.record)} [${selection.match}]`,
  };
}

function readComparisonReport(path: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read --compare=${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const report = parseCpuReport(parsed);
  if (!report) throw new Error(`--compare=${path} is not a cpu report this tool wrote.`);
  return report;
}

async function measureCpu(flags: Flags, target: AutomationTarget): Promise<void> {
  const durationMs = readMilliseconds(
    flags,
    "duration",
    DEFAULT_CPU_DURATION_MS,
    MIN_CPU_INTERVAL_MS,
    MAX_CPU_DURATION_MS,
  );
  const intervalMs = readMilliseconds(flags, "interval", DEFAULT_CPU_INTERVAL_MS, MIN_CPU_INTERVAL_MS, durationMs);
  const label = flagValue(flags, "label") ?? "run";
  const comparePath = flagValue(flags, "compare");
  const baseline = comparePath === null || comparePath === "" ? null : readComparisonReport(comparePath);
  // Resolved before the run, not after it: a rejected `--out` should cost the
  // developer nothing, and finding out at the end throws a minute of sampling
  // away. `--compare` stays relative to the working directory, because it only
  // reads and the usual call passes the path an earlier run printed.
  const out = flagValue(flags, "out");
  const outPath = out === null || out === "" ? null : resolveWritablePath(CPU_ROOT, out, ".json", "CPU reports");
  const browser = await openDevBrowser(target.port, logger, { ownerPid: target.pid });
  let profile: Awaited<ReturnType<typeof profileCpu>>;
  try {
    logger.info(`sampling for ${durationMs} ms every ${intervalMs} ms`);
    profile = await profileCpu({ browser, rootPid: target.pid, durationMs, intervalMs, label, logger });
  } finally {
    await browser.close();
  }
  const document = baseline ? { ...profile, delta: compareProfiles(baseline, profile) } : profile;
  if (outPath !== null) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
    logger.info(`wrote ${redactText(outPath)}`);
  }
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
}

async function measureMemory(flags: Flags, target: AutomationTarget): Promise<void> {
  const label = flagValue(flags, "label") ?? "run";
  const out = flagValue(flags, "out");
  const outPath = out === null || out === "" ? null : resolveWritablePath(MEMORY_ROOT, out, ".json", "Memory reports");
  const heapSelector = flagValue(flags, "heap-snapshot");
  if (heapSelector !== null && heapSelector.trim() === "") {
    throw new Error("--heap-snapshot=<target-id|url-substring> cannot be empty.");
  }
  const browser = await openDevBrowser(target.port, logger, { ownerPid: target.pid });
  let document: Awaited<ReturnType<typeof profileMemory>> & { heapSnapshot?: string };
  try {
    document = await profileMemory({ browser, rootPid: target.pid, label, logger });
    if (heapSelector !== null) {
      const [page, ...others] = await matchPages(devBrowserPages(browser), heapSelector, readTargetId);
      if (!page) throw new Error("--heap-snapshot matched no page. List them with `dev:automation pages`.");
      if (others.length > 0) throw new Error("--heap-snapshot matched more than one page. Pass a target id.");
      const snapshotPath = resolveWritablePath(
        MEMORY_ROOT,
        `heap-${Date.now()}.heapsnapshot`,
        ".heapsnapshot",
        "Heap snapshots",
      );
      await writeHeapSnapshot(page, snapshotPath, logger);
      document = { ...document, heapSnapshot: reportableScreenshotPath(snapshotPath, process.cwd()) };
    }
  } finally {
    await browser.close();
  }
  if (outPath !== null) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
    logger.info(`wrote ${redactText(outPath)}`);
  }
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
}

async function main(): Promise<void> {
  const parsed = readScriptArguments({ usage: USAGE, options: OPTIONS, allowPositionals: true });
  if (parsed === null) return;
  const flags = parsed.values;
  const [command, ...extra] = parsed.positionals;
  if (extra.length > 0) throw new Error(`Unexpected argument '${extra[0]}'.\n${USAGE}`);
  if (command === "instances") {
    // Every diagnostic on stderr goes through the logger, which redacts. This
    // is the one place a registry field reaches stdout raw, and `projectRoot`
    // is a filesystem path the developer chose - a checkout under a directory
    // named after an email, or one holding a token, would otherwise be copied
    // into the transcript verbatim. Selection keeps using the raw records.
    const instances = readDevInstanceRecords().map((record) => ({
      ...record,
      profile: redactText(record.profile),
      projectRoot: redactText(record.projectRoot),
    }));
    process.stdout.write(`${JSON.stringify({ instances }, null, 2)}\n`);
    return;
  }
  if (
    command !== "pages" &&
    command !== "snapshot" &&
    command !== "click" &&
    command !== "type" &&
    command !== "screenshot" &&
    command !== "cpu" &&
    command !== "memory"
  ) {
    throw new Error(USAGE);
  }
  const target = resolveTarget(flags, readDevInstanceRecords(), readService(flags));
  logger.info(`target ${target.description}`);
  if (command === "pages") {
    const browser = await openDevBrowser(target.port, logger, { ownerPid: target.pid });
    try {
      const pages = await describeDevPages(devBrowserPages(browser), readTargetId);
      process.stdout.write(`${JSON.stringify({ pages }, null, 2)}\n`);
    } finally {
      await browser.close();
    }
    return;
  }
  // Read-only: `cpu` and `memory` attach CDP counters and run `ps`, and change nothing in
  // the app. So it stays out of the mutation gate below and works against an
  // instance nobody named.
  if (command === "cpu") {
    await measureCpu(flags, target);
    return;
  }
  if (command === "memory") {
    await measureMemory(flags, target);
    return;
  }
  if (command === "click" || command === "type") {
    assertMutationAllowed({
      command,
      allowMutations: flags["allow-mutations"] ?? false,
      instanceNamed: target.instanceNamed,
      target: target.description,
    });
  }
  const role = command === "click" || command === "type" ? parseAutomationRole(requireFlagValue(flags, "role")) : null;
  const name = command === "click" || command === "type" ? requireFlagValue(flags, "name") : null;
  const text = command === "type" ? requireTextFlag(flags) : null;
  // Substring matching is the default because control names carry context --
  // "Sign in to OpenCode" reads better than an exact label. `--exact` is for
  // the names that nest: a "Settings" gear beside "View agent settings".
  const exact = flags.exact ?? false;
  const timeoutMs = readTimeout(flags);
  const waitTarget = readWaitTarget(flags);
  const session = await connectToDevApp(target.port, logger, {
    expectedRendererPort: target.expectedRendererPort,
    pageSelector: readPageSelector(flags),
    ownerPid: target.pid,
  });
  try {
    const settle = async (): Promise<void> => {
      if (waitTarget) await waitForRole(session.page, waitTarget, timeoutMs, logger, exact);
    };
    if (command === "snapshot") {
      await settle();
      const snapshot = await snapshotPage(session.page, logger);
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    } else if (command === "click" && role && name) {
      logger.info(`click role=${role} name=${name}`);
      await clickByRole(session.page, role, name, timeoutMs, exact);
      await settle();
      const snapshot = await snapshotPage(session.page, logger);
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    } else if (command === "type" && role && name && text !== null) {
      logger.info(`type role=${role} name=${name} chars=${text.length} submit=${flags.submit ?? false}`);
      await typeByRole(session.page, role, name, text, timeoutMs, flags.submit ?? false, exact);
      await settle();
      const snapshot = await snapshotPage(session.page, logger);
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    } else if (command === "screenshot") {
      await settle();
      const out = resolveScreenshotPath(SCREENSHOT_ROOT, flagValue(flags, "out"), Date.now());
      await screenshotTo(session.page, out, logger);
      process.stdout.write(`${JSON.stringify({ screenshot: reportableScreenshotPath(out, process.cwd()) })}\n`);
    }
  } finally {
    await session.close();
  }
}

void main().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
