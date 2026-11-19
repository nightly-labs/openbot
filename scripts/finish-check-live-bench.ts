import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AGENT_PROVIDERS,
  type AgentEvent,
  defaultProviderModel,
  PLAN_CONTINUATION_ITEM_TYPE,
} from "@openbot/contracts/ipc";
import { teeLogLines } from "@openbot/logging";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/finish-check-live-bench");
const REQUEST_TIMEOUT_MS = 15 * 60_000;
const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const runCount = Math.max(1, Number(argument("runs") ?? 1) || 1);
const model = argument("model") ?? defaultProviderModel("claude");

interface Task {
  name: string;
  request: string;
  agentDescription?: string;
  setup: (workspace: string) => void;
  validate: (workspace: string) => string | null;
}

const write = (path: string, text: string) => {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, text);
};
const python = (workspace: string, ...args: string[]) =>
  execFileSync("python3", args, { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const NUMBER_WORDS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

const MODULES = ["orders", "invoices", "customers", "stock", "shipping", "refunds", "reports", "taxes", "coupons"];

const CHECK_PY = `import sys
from shop import pricing, dates, text, stock, report

def expect(name, actual, wanted):
    if actual != wanted:
        print(f"FAIL {name}: got {actual!r}, expected {wanted!r}")
        sys.exit(1)

expect("pricing.total", pricing.total([2.5, 3.5], 0.1), 5.4)
expect("dates.days_between", dates.days_between("2026-01-30", "2026-02-02"), 3)
expect("text.slug", text.slug("Hello,  World!"), "hello-world")
expect("stock.low", stock.low({"a": 2, "b": 9, "c": 5}, 5), ["a", "c"])
expect("report.average", report.average([4, 8, 9]), 7)
print("ALL OK")
`;

const TASKS: Task[] = [
  {
    name: "docstrings-9-modules",
    request:
      "Add a one-line docstring to every function in the 9 modules in the shop_api/ folder. Do not change any other code.",
    setup: (workspace) => {
      for (const module of MODULES)
        write(
          join(workspace, "shop_api", `${module}.py`),
          [
            `def list_${module}(db):`,
            `    return db.get("${module}", [])`,
            "",
            "",
            `def get_${module.replace(/s$/, "")}(db, item_id):`,
            `    return next((item for item in list_${module}(db) if item["id"] == item_id), None)`,
            "",
            "",
            `def count_${module}(db):`,
            `    return len(list_${module}(db))`,
            "",
          ].join("\n"),
        );
    },
    validate: (workspace) => {
      const script = `import ast, pathlib, sys
missing = []
for path in sorted(pathlib.Path("shop_api").glob("*.py")):
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and ast.get_docstring(node) is None:
            missing.append(f"{path.name}:{node.name}")
print(len(missing), " ".join(missing))`;
      const [count = "0", ...names] = python(workspace, "-c", script).trim().split(" ");
      return count === "0" ? null : `${count} functions have no docstring: ${names.slice(0, 6).join(" ")}`;
    },
  },
  {
    name: "fix-5-hidden-bugs",
    request: "Run `python3 check.py`. Fix the code in shop/ until it prints ALL OK. Do not change check.py.",
    setup: (workspace) => {
      write(join(workspace, "check.py"), CHECK_PY);
      write(join(workspace, "shop", "__init__.py"), "");
      write(
        join(workspace, "shop", "pricing.py"),
        "def total(prices, discount):\n    return round(sum(prices) * discount, 2)\n",
      );
      write(
        join(workspace, "shop", "dates.py"),
        "from datetime import date\n\ndef days_between(start, end):\n    a = date.fromisoformat(start)\n    b = date.fromisoformat(end)\n    return (a - b).days\n",
      );
      write(
        join(workspace, "shop", "text.py"),
        'import re\n\ndef slug(value):\n    return re.sub(r"[^a-z0-9]", "-", value.lower())\n',
      );
      write(
        join(workspace, "shop", "stock.py"),
        "def low(levels, limit):\n    return [name for name, count in levels.items() if count < limit]\n",
      );
      write(join(workspace, "shop", "report.py"), "def average(values):\n    return sum(values) // len(values) + 1\n");
    },
    validate: (workspace) => {
      if (readFileSync(join(workspace, "check.py"), "utf8") !== CHECK_PY) return "check.py changed";
      try {
        const out = python(workspace, "check.py").trim();
        return out === "ALL OK" ? null : out;
      } catch (error) {
        const output =
          error instanceof Error && "stdout" in error && typeof error.stdout === "string"
            ? error.stdout
            : String(error);
        return output.trim().slice(0, 200);
      }
    },
  },
  {
    name: "translate-5-languages",
    request:
      "Translate README.md into German, Spanish, French, Italian and Polish. Save each one next to it as README.<language code>.md, for example README.de.md.",
    setup: (workspace) => {
      write(
        join(workspace, "README.md"),
        [
          "# Garden Planner",
          "",
          "Garden Planner helps you plan the beds of a small vegetable garden.",
          "",
          "## Start",
          "",
          "1. Draw your beds on the grid.",
          "2. Drag a plant onto a bed. The planner shows the space that the plant needs.",
          "3. Open the calendar to see when to sow, water and harvest.",
          "",
          "## Data",
          "",
          "Your plans stay on this computer. Nothing is sent to a server.",
          "",
        ].join("\n"),
      );
    },
    validate: (workspace) => {
      const english = readFileSync(join(workspace, "README.md"), "utf8");
      const missing = ["de", "es", "fr", "it", "pl"].filter((code) => {
        const path = join(workspace, `README.${code}.md`);
        if (!existsSync(path)) return true;
        const text = readFileSync(path, "utf8");
        return text.length < english.length * 0.6 || text === english;
      });
      return missing.length === 0 ? null : `missing or too short: ${missing.join(", ")}`;
    },
  },
  {
    name: "stops-after-3-of-12",
    agentDescription:
      "Works in short rounds: after 3 tool calls it always ends its turn with a short progress line, and it waits for the user to say continue.",
    request:
      "Make a folder numbers with 12 files n01.txt to n12.txt. Each file holds its number as an English word, for example one. Write one file per tool call.",
    setup: () => {},
    validate: (workspace) => {
      const missing = NUMBER_WORDS.flatMap((word, index) => {
        const path = join(workspace, "numbers", `n${String(index + 1).padStart(2, "0")}.txt`);
        return existsSync(path) && readFileSync(path, "utf8").trim().toLowerCase() === word ? [] : [index + 1];
      });
      return missing.length === 0 ? null : `missing or wrong: ${missing.join(", ")}`;
    },
  },
];

const unused = () => Effect.die(new Error("Not used by this bench."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 250));
  }
}

type Mode = "off" | "on";
interface Run {
  task: string;
  mode: Mode;
  model: string;
  done: boolean;
  missing: string | null;
  status: string;
  turns: number;
  continuations: { plan: number; nextStep: number; finishCheck: number; other: number };
  verdicts: string[];
  ms: number;
  agentTokens: number;
}

const verdictLines: string[] = [];
teeLogLines(["agent-service"], (line) => {
  const match = /A finish check answered\..*"verdict":"(\w+)"/.exec(line);
  if (match?.[1]) verdictLines.push(match[1]);
});

async function runTask(task: Task, mode: Mode): Promise<Run> {
  const root = await mkdtemp(join(tmpdir(), "openbot-finish-live-"));
  const userData = join(root, "user-data");
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const service = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "claude",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
    finishCheck: mode === "on",
  });
  const events: AgentEvent[] = [];
  service.on("event", (event) => events.push(event));
  try {
    await runCauseEffect(service.initialize());
    const agent = await runCauseEffect(
      service.createAgent({
        name: "Bench",
        description: task.agentDescription ?? "Does the task in its workspace.",
        avatarSeed: "bench",
        avatarHue: null,
        initialMessage: "Hello. Answer in one short sentence.",
        provider: "claude",
        model,
      }),
    );
    const idle = () =>
      !service
        .listQueue(agent.id)
        .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
    await waitFor("the first turn", () => events.some((e) => e.type === "turn-completed") && idle(), 180_000);
    task.setup(agent.workspacePath);
    const since = events.length;
    const verdictsSince = verdictLines.length;
    const sinceTime = new Date().toISOString();
    const started = performance.now();
    const receipt = await runCauseEffect(
      service.sendMessage({ agentId: agent.id, text: task.request, attachmentDraftIds: [] }),
    );
    const deliveryId = receipt.deliveries[0]?.id;
    if (!deliveryId) throw new Error("The message has no delivery.");
    const status = await waitFor(
      "the request to end",
      () => {
        const value = mailbox.getDelivery(deliveryId)?.delivery.status;
        return value && !["queued", "starting", "running"].includes(value) && idle() ? value : null;
      },
      REQUEST_TIMEOUT_MS,
    );
    const ms = Math.round(performance.now() - started);
    const turnIds = events
      .slice(since)
      .flatMap((event) => (event.type === "turn-started" && event.agentId === agent.id ? [event.turnId] : []));
    const lines = database
      .readConversation(agent.id, agent.threadId)
      .messages.filter(
        (message) =>
          message.itemType === PLAN_CONTINUATION_ITEM_TYPE &&
          !message.id.endsWith(":plan-stopped") &&
          turnIds.some((turnId) => message.id.startsWith(`${turnId}:`)),
      );
    const kind = (text: string) =>
      text.startsWith("The plan has open steps")
        ? "plan"
        : text.startsWith("The request is not finished yet")
          ? "finishCheck"
          : text.startsWith("The agent stopped before its next step")
            ? "nextStep"
            : "other";
    const continuations = { plan: 0, nextStep: 0, finishCheck: 0, other: 0 };
    for (const line of lines) continuations[kind(line.text)] += 1;
    const missing = task.validate(agent.workspacePath);
    return {
      task: task.name,
      mode,
      model,
      done: missing === null,
      missing,
      status,
      turns: turnIds.length,
      continuations,
      verdicts: verdictLines.slice(verdictsSince),
      ms,
      agentTokens: turnIds.reduce(
        (sum, turnId) => sum + (database.usage.readTurnTotals(agent.id, turnId, sinceTime)?.tokens ?? 0),
        0,
      ),
    };
  } finally {
    await runCauseEffect(service.stop()).catch(() => undefined);
    database.close();
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

const only = argument("task");
const runs: Run[] = [];
const failures: string[] = [];
for (let index = 0; index < runCount; index += 1)
  for (const task of TASKS.filter((candidate) => !only || candidate.name === only))
    for (const mode of ["off", "on"] as const) {
      try {
        const run = await runTask(task, mode);
        runs.push(run);
        process.stderr.write(
          `${run.done ? "done" : "NOT DONE"} ${task.name} [check ${mode}]: ${run.turns} turns, ${Math.round(run.ms / 1000)} s, verdicts ${run.verdicts.join(",") || "-"}${run.missing ? ` (${run.missing})` : ""}\n`,
        );
      } catch (error) {
        failures.push(`${task.name} ${mode}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

const summary = (["off", "on"] as const).map((mode) => {
  const of = runs.filter((run) => run.mode === mode);
  const sum = (read: (run: Run) => number) => of.reduce((total, run) => total + read(run), 0);
  return {
    mode,
    runs: of.length,
    doneWithoutUser: `${of.filter((run) => run.done).length}/${of.length}`,
    turns: sum((run) => run.turns),
    finishCheckContinuations: sum((run) => run.continuations.finishCheck),
    otherContinuations: sum((run) => run.continuations.plan + run.continuations.nextStep + run.continuations.other),
    checks: sum((run) => run.verdicts.length),
    seconds: Math.round(sum((run) => run.ms) / 1000),
    agentTokens: sum((run) => run.agentTokens),
  };
});
mkdirSync(OUT, { recursive: true });
const report = { date: new Date().toISOString(), model, runsPerTask: runCount, summary, runs, failures };
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ summary, failures }, null, 2)}\nReport: ${resolve(OUT, "report.json")}\n`);
if (failures.length) process.exit(1);
