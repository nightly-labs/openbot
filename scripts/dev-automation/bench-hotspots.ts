import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { readScriptArguments } from "../script-arguments";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BENCH_ROOT = join(PROJECT_ROOT, ".openbot-build", "dev-automation", "bench");
const TOP = 15;
const PROFILE_TOP = 25;

const USAGE = "Usage: bun scripts/dev-automation/bench-hotspots.ts --label=<bench label>";
const OPTIONS = { label: { type: "string" } } as const;

function records(value: unknown): DynamicRecord[] {
  return Array.isArray(value) ? value.filter(isDynamicRecord) : [];
}

function field(record: DynamicRecord, key: string): string {
  const value = record[key];
  if (isNumber(value)) return String(Math.round(value * 10) / 10);
  if (isString(value)) return value.replaceAll("|", "\\|");
  if (typeof value === "boolean") return value ? "yes" : "";
  return "";
}

function table(title: string, columns: string[], rows: DynamicRecord[]): string[] {
  if (rows.length === 0) return [];
  return [
    `#### ${title}`,
    "",
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.slice(0, TOP).map((row) => `| ${columns.map((column) => field(row, column)).join(" | ")} |`),
    "",
  ];
}

function child(record: unknown, key: string): DynamicRecord {
  if (!isDynamicRecord(record)) return {};
  const value = record[key];
  return isDynamicRecord(value) ? value : {};
}

function mainSection(main: unknown, explained: unknown): string[] {
  const plans = new Map(records(explained).map((plan) => [field(plan, "key"), plan]));
  const statements = records(child(main, "db").statements).map((row): DynamicRecord => {
    const plan = plans.get(field(row, "key"));
    return { ...row, scan: plan?.scan === true, tempBTree: plan?.tempBTree === true };
  });
  const loop = child(main, "loop");
  return [
    `Main process CPU ${field(loop, "cpuMsPerS")} ms/s, loop delay p99 ${field(loop, "delayP99Ms")} ms, max ${field(loop, "delayMaxMs")} ms, transactions ${field(child(main, "db"), "transactions")}.`,
    "",
    ...table(
      "DB statements by ms",
      ["key", "calls", "prepares", "ms", "rows", "paramBytes", "scan", "tempBTree"],
      statements,
    ),
    ...table(
      "DB statements by calls",
      ["key", "calls", "prepares", "ms"],
      [...statements].sort((left, right) => Number(right.calls) - Number(left.calls)),
    ),
    ...table("Main measures", ["key", "count", "ms"], isDynamicRecord(main) ? records(main.measures) : []),
    ...table("IPC to renderers", ["key", "messages", "bytes"], isDynamicRecord(main) ? records(main.ipc) : []),
    ...table(
      "Main timers",
      ["key", "kind", "scheduled", "fired", "ms"],
      isDynamicRecord(main) ? records(main.timers) : [],
    ),
  ];
}

function rendererSection(url: string, report: unknown): string[] {
  if (!isDynamicRecord(report)) return [];
  const solid = child(report, "solid");
  const totals = child(solid, "totals");
  const counters = Object.entries(child(report, "counters")).map(([key, count]) => ({ key, count }));
  return [
    `### Renderer ${field(report, "role")} ${url}`,
    "",
    `Solid observe ${field(solid, "observe") || "no"}: ${field(totals, "runs")} runs, ${field(totals, "selfMs")} ms self, ${field(totals, "wastedMs")} ms wasted, ${field(totals, "scopes")} scopes.`,
    "",
    ...table("Solid scopes by self ms", ["name", "kind", "runs", "selfMs", "wastedMs"], records(solid.scopesBySelfMs)),
    ...table("Solid scopes by runs", ["name", "kind", "runs"], records(solid.scopesByRuns)),
    ...table("Solid writes", ["name", "runs", "downstreamMs"], records(solid.writes)),
    ...table(
      "Solid root writes (causes)",
      ["name", "runs", "selfMs", "wastedMs"],
      records(child(report, "causes").rootWrites),
    ),
    ...table(
      "Solid scopes with source (causes)",
      ["name", "runs", "selfMs", "wastedMs"],
      records(child(report, "causes").scopes),
    ),
    ...table("Solid diagnostics", ["code", "count"], records(report.diagnostics)),
    ...table("Renderer counters", ["key", "count"], counters),
    ...table("Renderer timers", ["kind", "site", "scheduled", "fired", "ms"], records(report.timers)),
  ];
}

interface ProfileNode {
  id: number;
  functionName: string;
  place: string;
}

function profileSelfTime(profile: unknown): DynamicRecord[] {
  if (!isDynamicRecord(profile)) return [];
  const nodes = new Map<number, ProfileNode>();
  for (const node of records(profile.nodes)) {
    const frame = child(node, "callFrame");
    if (!isNumber(node.id)) continue;
    const url = isString(frame.url) ? frame.url : "";
    const line = isNumber(frame.lineNumber) ? frame.lineNumber + 1 : 0;
    nodes.set(node.id, {
      id: node.id,
      functionName: isString(frame.functionName) && frame.functionName ? frame.functionName : "(anonymous)",
      place: url ? `${url.slice(url.lastIndexOf("/") + 1)}:${line}` : "",
    });
  }
  const samples = Array.isArray(profile.samples) ? profile.samples : [];
  const deltas = Array.isArray(profile.timeDeltas) ? profile.timeDeltas : [];
  const selfUs = new Map<string, number>();
  let totalUs = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const id = samples[index];
    const delta = deltas[index];
    if (!isNumber(id) || !isNumber(delta) || delta <= 0) continue;
    const node = nodes.get(id);
    const key = node ? `${node.functionName} ${node.place}`.trim() : "(unknown)";
    selfUs.set(key, (selfUs.get(key) ?? 0) + delta);
    totalUs += delta;
  }
  const busyUs = totalUs - (selfUs.get("(idle)") ?? 0);
  return [...selfUs]
    .filter(([key]) => key !== "(idle)")
    .sort((left, right) => right[1] - left[1])
    .slice(0, PROFILE_TOP)
    .map(([frame, us]) => ({
      frame,
      selfMs: us / 1_000,
      busyPct: busyUs > 0 ? (us / busyUs) * 100 : 0,
    }));
}

async function profileSection(path: string, title: string): Promise<string[]> {
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) return [];
  return table(title, ["frame", "selfMs", "busyPct"], profileSelfTime(JSON.parse(text)));
}

async function main(): Promise<void> {
  const parsed = readScriptArguments({ usage: USAGE, options: OPTIONS });
  if (parsed === null) return;
  const label = parsed.values.label;
  if (!label || !/^[\w.-]+$/u.test(label)) throw new Error(`--label is required.\n${USAGE}`);
  const probeDirectory = join(BENCH_ROOT, "probes");
  const snapshotDirectory = join(BENCH_ROOT, "snapshots");
  const probeFiles = (await readdir(probeDirectory).catch(() => []))
    .filter((name) => name.startsWith(`${label}-`) && name.endsWith("-1-probes.json"))
    .sort();
  const lines = [`# Hot spots: ${label}`, ""];
  for (const name of probeFiles) {
    const scenario = name.slice(label.length + 1, -"-1-probes.json".length);
    const report = JSON.parse(await readFile(join(probeDirectory, name), "utf8"));
    if (!isDynamicRecord(report)) continue;
    lines.push(`## ${scenario}`, "", "### Main process", "", ...mainSection(report.main, report.explain));
    for (const renderer of records(report.renderers)) {
      lines.push(...rendererSection(field(renderer, "url"), renderer.report));
    }
    const base = join(snapshotDirectory, `${label}-${scenario}`);
    lines.push(
      ...(await profileSection(`${base}-main.cpuprofile`, "Main CPU self time")),
      ...(await profileSection(`${base}-renderer.cpuprofile`, "Renderer CPU self time")),
    );
  }
  if (probeFiles.length === 0) lines.push("No probe reports. Run `bun run dev:bench --probes` on a bench build.");
  const outPath = join(BENCH_ROOT, `${label}.hotspots.md`);
  await writeFile(outPath, `${lines.join("\n")}\n`);
  process.stdout.write(`${outPath}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
