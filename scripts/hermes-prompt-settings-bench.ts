import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { visibleDynamicTools } from "../src/backend/agent/tool-catalog";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { HERMES_AGENT_SETTINGS, type HermesAgentSettings } from "../src/backend/hermes-settings";
import { hermesHome } from "../src/backend/process-confinement";
import { getRecord, getString, isRecord } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { median } from "./dev-automation/bench-stats";
import { runTurn, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/hermes-prompt-settings-bench");
const DEFAULT_MODEL = "nous:meituan/longcat-2.5:free";
const REPLY_PROMPT = "Reply with the single word OK. Do not use any tool.";
const TASK_PROMPT =
  "Read notes.md and count.txt with the read_file tool. Then reply with one line: the title of notes.md " +
  "and the number in count.txt.";
const DEVELOPER_INSTRUCTIONS = "You are Ada, a careful assistant in an end-to-end benchmark.";
const TURN_TIMEOUT_MS = 240_000;

interface Variant {
  name: string;
  openbotSettings: boolean;
  userAgent?: HermesAgentSettings;
}

const REFERENCE_TOOLSETS = ["web", "code_execution", "delegation", "memory", "skills"] as const;

const VARIANTS: Variant[] = [
  { name: "current", openbotSettings: true },
  { name: "without-openbot-settings", openbotSettings: false },
  { name: "coding-context-focus", openbotSettings: false, userAgent: { coding_context: "focus" } },
  { name: "browser-off", openbotSettings: false, userAgent: { disabled_toolsets: ["browser"] } },
  { name: "user-keys-win", openbotSettings: true, userAgent: { coding_context: "auto", disabled_toolsets: [] } },
  ...REFERENCE_TOOLSETS.map((toolset) => ({
    name: `without-${toolset.replaceAll("_", "-")}`,
    openbotSettings: true,
    userAgent: { disabled_toolsets: ["browser", toolset] },
  })),
];

interface Request {
  input: number;
  output: number;
  cacheRead: number;
}

interface TurnReport {
  status: string | null;
  error: string | null;
  reply: string;
  requests: Request[];
  promptTokens: number;
  usage: unknown;
  toolSearch: { kept: number; deferred: number; deferredTokens: number } | null;
  systemPromptChars: number | null;
}

function option(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function userHermesRoot(): string {
  const home = hermesHome();
  return basename(dirname(home)) === "profiles" ? dirname(dirname(home)) : home;
}

function browserEnvironment(root: string): Record<string, string> {
  const store = join(root, "tools");
  let facts: unknown;
  try {
    facts = JSON.parse(readFileSync(join(store, "facts.json"), "utf8"));
  } catch {
    return {};
  }
  const environment: Record<string, string> = {};
  const paths: string[] = [];
  for (const name of ["agent-browser", "chromium"]) {
    const env = getRecord(getRecord(getRecord(facts, "packages"), name), "env");
    for (const [key, value] of Object.entries(env ?? {})) {
      const values = (Array.isArray(value) ? value : [value]).filter((item) => typeof item === "string");
      const expanded = values.map((item) => item.replaceAll("{{store}}", store));
      if (key === "PATH") paths.push(...expanded);
      else if (expanded[0]) environment[key] = expanded[0];
    }
  }
  if (paths.length > 0) environment.PATH = [...paths, process.env.PATH ?? ""].join(delimiter);
  return environment;
}

function hermes(executable: string, args: readonly string[], home: string): void {
  const result = spawnSync(executable, args, {
    env: { ...process.env, HERMES_HOME: home, HERMES_DISABLE_LAZY_INSTALLS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(-2000);
    throw new Error(`hermes ${args.join(" ")} exited with ${result.status ?? result.signal}:\n${output}`);
  }
}

function launchers(root: string): string {
  const folder = join(root, "hermes-agent", ".hermes", "bin");
  if (!existsSync(folder)) return "";
  return readdirSync(folder)
    .sort()
    .map((name) => `${name}\n${readFileSync(join(folder, name), "utf8")}`)
    .join("\n");
}

function removeEmptyFolder(path: string): void {
  try {
    rmdirSync(path);
  } catch {}
}

function makeWorkspace(root: string): string {
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "notes.md"), "# Harbor inventory\n\nThe crates arrive on Monday.\n");
  writeFileSync(join(workspace, "count.txt"), "42\n");
  writeFileSync(join(workspace, "count.py"), 'print(open("count.txt").read().strip())\n');
  spawnSync("git", ["init", "--quiet"], { cwd: workspace, stdio: "ignore" });
  return workspace;
}

const API_CALL = /API call #\d+: .* in=(\d+) out=(\d+) (?:.*cache=(\d+)\/\d+)?/u;
const TOOL_SEARCH = /tool_search activated .*?: (\d+) core\/visible tools kept, (\d+) deferred \(~(\d+) tokens\)/u;

function systemPromptChars(home: string, session: string): number | null {
  const path = join(home, "state.db");
  if (!existsSync(path)) return null;
  const database = new Database(path, { readonly: true });
  try {
    const row = database
      .query<{ length: number | null }, [string]>(
        "SELECT length(COALESCE(p.prompt, s.system_prompt)) AS length FROM sessions s " +
          "LEFT JOIN system_prompts p ON p.hash = s.system_prompt_hash WHERE s.id = ?",
      )
      .get(session);
    return row?.length ?? null;
  } finally {
    database.close();
  }
}

async function measureTurn(
  client: AgentClient,
  diagnostics: string[],
  home: string,
  workspace: string,
  model: string,
  text: string,
): Promise<TurnReport> {
  diagnostics.length = 0;
  const started = await runCauseEffect(
    client.request(
      "thread/start",
      {
        cwd: workspace,
        model,
        developerInstructions: DEVELOPER_INSTRUCTIONS,
        dynamicTools: visibleDynamicTools("hermes"),
      },
      (value) => value,
    ),
  );
  const thread = getString(getRecord(started, "thread"), "id");
  if (!thread) throw new Error("thread/start answers no thread id.");
  let usage: unknown = null;
  const onUsage = (notification: { method: string; params?: unknown }) => {
    if (notification.method === "openbot/usage" && getString(notification.params, "threadId") === thread)
      usage = isRecord(notification.params) ? notification.params.usage : null;
  };
  client.on("notification", onUsage);
  const turn = await runTurn(client, thread, { model, text, timeoutMs: TURN_TIMEOUT_MS }).finally(() =>
    client.off("notification", onUsage),
  );
  const lines = diagnostics.splice(0).flatMap((chunk) => chunk.split("\n"));
  const requests = lines.flatMap((line) => {
    const match = API_CALL.exec(line);
    return match ? [{ input: Number(match[1]), output: Number(match[2]), cacheRead: Number(match[3] ?? 0) }] : [];
  });
  const search = lines
    .flatMap((line) => {
      const match = TOOL_SEARCH.exec(line);
      return match ? [match] : [];
    })
    .reduce<RegExpExecArray | null>((most, match) => (Number(match[2]) > Number(most?.[2] ?? -1) ? match : most), null);
  if (client.releaseThread) await runCauseEffect(client.releaseThread(thread)).catch(() => undefined);
  return {
    status: turn.status,
    error: turn.error,
    reply: turn.reply.slice(0, 200),
    requests,
    promptTokens: requests.reduce((sum, request) => sum + request.input, 0),
    usage,
    toolSearch: search
      ? { kept: Number(search[1]), deferred: Number(search[2]), deferredTokens: Number(search[3]) }
      : null,
    systemPromptChars: systemPromptChars(home, thread),
  };
}

const only = option("variant");
const runsOption = option("runs") ?? "3";
const runs = Number(runsOption);
if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive integer, not ${runsOption}.`);
const model = option("model") ?? DEFAULT_MODEL;
const verbose = process.argv.includes("--verbose");
const names = only ? [...new Set(only.split(","))] : undefined;
const variants = names ? VARIANTS.filter((variant) => names.includes(variant.name)) : VARIANTS;
if (variants.length !== (names?.length ?? VARIANTS.length))
  throw new Error(`Unknown variant ${only}. Variants: ${VARIANTS.map((v) => v.name).join(", ")}`);

const root = userHermesRoot();
const profiles = join(root, "profiles");
const profilesExisted = existsSync(profiles);
const profile = `openbot-bench-${randomBytes(4).toString("hex")}`;
const home = join(profiles, profile);
const launchersBefore = launchers(root);

const driver = requireProviderDriver("hermes");
const cli = await runCauseEffect(driver.resolveCli());
const scratch = mkdtempSync(join(tmpdir(), "openbot-hermes-bench-"));
const [provider, ...modelName] = model.split(":");
interface VariantReport {
  name: string;
  summary: Record<string, number | null>;
  turns: Array<{ run: number; reply: TurnReport; task: TurnReport }>;
}
const variantReports: VariantReport[] = [];
const report = {
  date: new Date().toISOString(),
  hermesVersion: cli.version,
  model,
  runs,
  openbotSettings: HERMES_AGENT_SETTINGS,
  variants: variantReports,
};

let failed = false;
let profileCreated = false;
let cleanedUp = false;
function cleanUp(): void {
  if (cleanedUp) return;
  cleanedUp = true;
  rmSync(scratch, { recursive: true, force: true });
  if (profileCreated) {
    try {
      hermes(cli.executable, ["profile", "delete", "-y", profile], root);
    } catch (error) {
      if (existsSync(home)) throw error;
    }
    rmSync(join(profiles, ".deleted", profile), { force: true });
  }
  if (!profilesExisted) {
    removeEmptyFolder(join(profiles, ".deleted"));
    removeEmptyFolder(profiles);
  }
  if (launchers(root) !== launchersBefore) {
    process.stderr.write(
      `The bench changed the Hermes launchers in ${join(root, "hermes-agent", ".hermes", "bin")}.\n`,
    );
    failed = true;
  }
}
process.once("SIGINT", () => {
  try {
    cleanUp();
  } finally {
    process.exit(130);
  }
});

try {
  profileCreated = true;
  hermes(cli.executable, ["profile", "create", profile, "--no-alias"], root);
  Object.assign(process.env, browserEnvironment(root), {
    HERMES_HOME: home,
    HERMES_SHARED_AUTH_DIR: join(root, "shared"),
    HERMES_DISABLE_LAZY_INSTALLS: "1",
  });
  const workspace = makeWorkspace(scratch);
  hermes(cli.executable, ["auth", "add", "nous", "--type", "oauth", "--no-browser"], home);
  for (const variant of variants) {
    writeFileSync(
      join(home, "config.yaml"),
      stringifyYaml({
        model: { default: modelName.join(":"), provider },
        ...(variant.userAgent ? { agent: variant.userAgent } : {}),
      }),
    );
    const client = driver.createClient(cli, 120_000, {
      ...NO_PROVIDER_CREDENTIALS,
      ...(variant.openbotSettings ? { providerStateDirectory: join(scratch, "provider-state") } : {}),
    });
    const diagnostics: string[] = [];
    client.on("diagnostic", (message: string) => {
      diagnostics.push(message);
      if (verbose) process.stderr.write(`${message}\n`);
    });
    client.start();
    const turns: Array<{ run: number; reply: TurnReport; task: TurnReport }> = [];
    try {
      for (let run = 1; run <= runs; run++) {
        const reply = await measureTurn(client, diagnostics, home, workspace, model, REPLY_PROMPT);
        const task = await measureTurn(client, diagnostics, home, workspace, model, TASK_PROMPT);
        turns.push({ run, reply, task });
        for (const [name, turn] of [
          ["reply", reply],
          ["task", task],
        ] as const) {
          if (turn.error || turn.status !== "completed" || turn.requests.length === 0) failed = true;
          process.stdout.write(
            `${variant.name} #${run} ${name}: ${turn.status} ${turn.requests.length} requests, ` +
              `${turn.promptTokens} prompt tokens, tools ${turn.toolSearch?.kept ?? "?"}+${turn.toolSearch?.deferred ?? "?"}` +
              (turn.error ? `, error: ${turn.error}` : "") +
              "\n",
          );
        }
      }
    } finally {
      await stopClients([client]);
    }
    const measured = turns.flatMap((turn) => [turn.reply, turn.task]);
    const systemPromptChars = turns.flatMap((turn) => turn.reply.systemPromptChars ?? []);
    const kept = measured.flatMap((turn) => turn.toolSearch?.kept ?? []);
    const deferred = measured.flatMap((turn) => turn.toolSearch?.deferred ?? []);
    const summary = {
      replyPromptTokens: median(turns.map((turn) => turn.reply.promptTokens)),
      taskPromptTokens: median(turns.map((turn) => turn.task.promptTokens)),
      taskRequests: median(turns.map((turn) => turn.task.requests.length)),
      systemPromptChars: systemPromptChars.length > 0 ? median(systemPromptChars) : null,
      toolsKept: kept.length > 0 ? Math.max(...kept) : null,
      toolsDeferred: deferred.length > 0 ? Math.max(...deferred) : null,
    };
    variantReports.push({ name: variant.name, summary, turns });
    process.stdout.write(`${variant.name}: ${JSON.stringify(summary)}\n`);
  }
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
  cleanUp();
}
if (failed) process.exit(1);
