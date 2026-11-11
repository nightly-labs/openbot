// Ranks the free OpenCode models on real agent tasks, to choose the models that a new OpenCode agent
// starts on (`OPENCODE_RECOMMENDED_FREE_MODELS` in `packages/contracts/src/agent-providers.ts`).
//
// Each run is `opencode run --standalone --auto --format json` in a new temporary HOME and XDG
// folders, so OpenCode never reads the developer's config, keys or sessions, and a new workspace
// with the files of one task. No key is set: the runs use the keyless free tier, as a new user does.
// After the run, the script checks the workspace and the reply. A task passes only when the check
// passes. All free models share one usage limit, so a run that the limit stops is an error, not a
// failure of the model.
//
// The limit stops the bench: each finished run is saved in runs.jsonl, and the next invocation runs
// only the jobs that are missing (`--fresh` starts again). A model that answers "not available in
// your country" is reported as not available, and its other jobs do not run.
//
// The model list is what keyless `opencode models` lists, filtered with `isFreeOpencodeModel`.
// `OPENCODE_CLI=<opencode> bun run bench:opencode-free-models [--repeats=2] [--concurrency=4]
// [--model=<id>]... [--task=<id>]... [--fresh]`
// Writes .openbot-build/opencode-free-models-bench/runs.jsonl and report.json.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { Schema } from "effect";
import { isFreeOpencodeModel } from "../packages/contracts/src/agent-providers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-free-models-bench");
const NL = "\n";
const print = (line: string) => process.stdout.write(`${line}${NL}`);
const RUN_TIMEOUT_MS = 300_000;

function flag(name: string): string[] {
  return process.argv.filter((arg) => arg.startsWith(`--${name}=`)).map((arg) => arg.slice(name.length + 3));
}
const REPEATS = Number(flag("repeats")[0] ?? 2);
const CONCURRENCY = Number(flag("concurrency")[0] ?? 4);

/** The managed OpenCode binary of the installed app, the newest version first. */
async function opencodeCli(): Promise<string> {
  if (process.env.OPENCODE_CLI) return process.env.OPENCODE_CLI;
  const platform = `${process.platform}-${process.arch}`;
  for (const app of ["OpenBot", "OpenBot Dev"]) {
    const root = join(homedir(), "Library/Application Support", app, "provider-runtimes/opencode", platform);
    if (!existsSync(root)) continue;
    const versions = (await readdir(root)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      const bin = join(root, version, "bin/opencode");
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error("No OpenCode binary. Set OPENCODE_CLI.");
}

interface Isolated {
  root: string;
  env: NodeJS.ProcessEnv;
}

async function isolated(): Promise<Isolated> {
  const root = await mkdtemp(join(tmpdir(), "oc-free-bench-"));
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, TERM: "dumb", NO_COLOR: "1" };
  for (const [key, dir] of [
    ["HOME", "home"],
    ["XDG_CONFIG_HOME", "config"],
    ["XDG_DATA_HOME", "data"],
    ["XDG_STATE_HOME", "state"],
    ["XDG_CACHE_HOME", "cache"],
  ] as const) {
    env[key] = join(root, dir);
    await mkdir(join(root, dir), { recursive: true });
  }
  return { root, env };
}

interface Exec {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function exec(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<Exec> {
  return new Promise((done) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, RUN_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr, timedOut });
    });
  });
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

async function readText(path: string): Promise<string | null> {
  return readFile(path, "utf8").catch(() => null);
}

async function listFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
      return entry.isDirectory() ? listFiles(root, path) : [relative(root, path)];
    }),
  );
  return files.flat();
}

interface Check {
  pass: boolean;
  detail: string;
}

interface Task {
  id: string;
  /** What the task measures. */
  skill: string;
  files: Record<string, string>;
  prompt: string;
  check(workspace: string, reply: string): Promise<Check>;
}

const node = (workspace: string, ...args: string[]) =>
  exec(process.execPath.includes("bun") ? "node" : process.execPath, args, {
    cwd: workspace,
    env: { PATH: process.env.PATH },
  });

const MATH_TEST = `import assert from "node:assert/strict";
import { average, sumRange } from "./src/math.js";
assert.equal(sumRange(1, 4), 10);
assert.equal(sumRange(5, 5), 5);
assert.equal(sumRange(-2, 2), 0);
assert.equal(average([2, 4]), 3);
assert.equal(average([]), 0);
console.log("ok");
`;

const SALES: [string, string, number, number][] = [
  ["north", "lamp", 12, 19.99],
  ["south", "desk", 3, 149.5],
  ["east", "chair", 7, 89],
  ["north", "desk", 2, 149.5],
  ["west", "lamp", 20, 19.99],
  ["south", "lamp", 5, 19.99],
  ["east", "shelf", 4, 64.25],
  ["west", "chair", 9, 89],
  ["north", "shelf", 6, 64.25],
  ["south", "chair", 11, 89],
  ["east", "lamp", 8, 19.99],
  ["west", "desk", 1, 149.5],
  ["north", "chair", 4, 89],
  ["south", "shelf", 2, 64.25],
  ["east", "desk", 5, 149.5],
  ["west", "shelf", 3, 64.25],
  ["north", "lamp", 9, 18.5],
  ["south", "desk", 2, 139],
];

const SECURITY_TREE: Record<string, string> = {
  "src/auth/login.ts": "export function login() {\n  // TODO(security): rate limit failed attempts\n}\n",
  "src/auth/session.ts": "export const ttl = 3600;\n// TODO(perf): cache sessions\n",
  "src/api/upload.ts": "// TODO(security): check the file type\nexport const upload = () => {};\n",
  "src/api/users.ts": "export const users = [];\n// todo(security) lower case is not the marker\n",
  "src/util/log.ts": "export const log = console.log;\n",
  "scripts/deploy.sh": "#!/bin/sh\n# TODO(security): do not echo the token\necho deploy\n",
  "docs/notes.md": "Nothing to see. TODO(docs): write more.\n",
  "web/index.html": "<!-- TODO(security): add a CSP header -->\n<html></html>\n",
  "web/app.js": "console.log('app');\n",
};

const TASKS: Task[] = [
  {
    id: "fix-bug",
    skill: "Find and fix two bugs from a failing test",
    files: {
      "package.json": '{ "type": "module" }\n',
      "src/math.js": `// The sum of the integers from \`from\` to \`to\`, both included.
export function sumRange(from, to) {
  let total = 0;
  for (let n = from; n < to; n += 1) total += n;
  return total;
}

// The average of a list, or 0 for an empty list.
export function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
`,
      "test.js": MATH_TEST,
    },
    prompt: "`node test.js` fails. Fix the bugs in src/math.js so that it passes. Do not change test.js.",
    async check(workspace) {
      if ((await readText(join(workspace, "test.js"))) !== MATH_TEST) return { pass: false, detail: "test.js changed" };
      const result = await node(workspace, "test.js");
      return { pass: result.code === 0, detail: result.code === 0 ? "tests pass" : result.stderr.slice(0, 300) };
    },
  },
  {
    id: "feature",
    skill: "Add methods to a class from a short specification",
    files: {
      "package.json": '{ "type": "module" }\n',
      "todo.js": `export class TodoList {
  #items = [];
  #nextId = 1;

  add(title) {
    const item = { id: this.#nextId++, title, done: false };
    this.#items.push(item);
    return item.id;
  }

  list() {
    return this.#items.map((item) => ({ ...item }));
  }
}
`,
    },
    prompt: [
      "In todo.js, add three methods to TodoList:",
      "- complete(id): marks the item done and returns true; returns false when no item has that id.",
      "- pending(): returns the titles of the items that are not done, in the order they were added.",
      "- remove(id): deletes the item and returns true; returns false when no item has that id.",
      "Keep add() and list() as they are.",
    ].join(NL),
    async check(workspace) {
      const script = join(workspace, ".check-todo.mjs");
      await writeFile(
        script,
        `import assert from "node:assert/strict";
import { TodoList } from "./todo.js";
const list = new TodoList();
const a = list.add("a"); const b = list.add("b"); const c = list.add("c");
assert.equal(list.complete(b), true);
assert.equal(list.complete(99), false);
assert.deepEqual(list.pending(), ["a", "c"]);
assert.equal(list.remove(a), true);
assert.equal(list.remove(a), false);
assert.deepEqual(list.pending(), ["c"]);
assert.deepEqual(list.list().map((item) => [item.id, item.done]), [[b, true], [c, false]]);
assert.equal(list.add("d"), 4);
console.log("ok");
`,
      );
      const result = await node(workspace, script);
      return { pass: result.code === 0, detail: result.code === 0 ? "spec holds" : result.stderr.slice(0, 300) };
    },
  },
  {
    id: "data",
    skill: "Compute numbers from a CSV file and write exact JSON",
    files: {
      "sales.csv": `region,product,units,unit_price${NL}${SALES.map((row) => row.join(",")).join(NL)}${NL}`,
    },
    prompt: [
      "Read sales.csv. Create summary.json with exactly these keys:",
      '- "rows": the number of data rows,',
      '- "revenueByRegion": an object from each region to the sum of units * unit_price, rounded to 2 decimals,',
      '- "topProductByUnits": the product with the most units in total.',
    ].join(NL),
    async check(workspace) {
      const text = await readText(join(workspace, "summary.json"));
      if (!text) return { pass: false, detail: "no summary.json" };
      let value: Schema.Schema.Type<typeof SummarySchema>;
      try {
        value = Schema.decodeUnknownSync(Schema.fromJsonString(SummarySchema))(text);
      } catch {
        return { pass: false, detail: "summary.json is not the asked JSON object" };
      }
      const revenue: Record<string, number> = {};
      const units: Record<string, number> = {};
      for (const [region, product, count, price] of SALES) {
        revenue[region] = (revenue[region] ?? 0) + count * price;
        units[product] = (units[product] ?? 0) + count;
      }
      const top = Object.entries(units).sort((a, b) => b[1] - a[1])[0]?.[0];
      const wrong: string[] = [];
      if (value.rows !== SALES.length) wrong.push(`rows=${String(value.rows)}`);
      if (value.topProductByUnits !== top) wrong.push(`top=${String(value.topProductByUnits)}`);
      for (const [region, total] of Object.entries(revenue)) {
        const got = Number(value.revenueByRegion?.[region]);
        if (Math.abs(got - Math.round(total * 100) / 100) > 0.005) wrong.push(`${region}=${got}`);
      }
      return { pass: wrong.length === 0, detail: wrong.length ? wrong.join(", ") : "exact" };
    },
  },
  {
    id: "search",
    skill: "Search a tree with the shell and write an exact list",
    files: SECURITY_TREE,
    prompt:
      'Find every file in this folder that contains the exact marker "TODO(security)" (case-sensitive). Write their paths, relative to this folder with forward slashes, one per line and sorted alphabetically, to findings.txt. Nothing else in the file.',
    async check(workspace) {
      const expected = Object.entries(SECURITY_TREE)
        .filter(([, content]) => content.includes("TODO(security)"))
        .map(([path]) => path)
        .sort();
      const text = await readText(join(workspace, "findings.txt"));
      const lines = (text ?? "")
        .split(/\r?\n/u)
        .map((line) => line.trim().replace(/^\.\//u, ""))
        .filter(Boolean);
      const pass = JSON.stringify(lines) === JSON.stringify(expected);
      return { pass, detail: pass ? "exact" : `got ${JSON.stringify(lines)}` };
    },
  },
  {
    id: "refactor",
    skill: "Rename a function across files without changing behavior",
    files: {
      "package.json": '{ "type": "module" }\n',
      "lib/format.js": "export function fmtPrice(cents) {\n  return `$${(cents / 100).toFixed(2)}`;\n}\n",
      "lib/cart.js":
        'import { fmtPrice } from "./format.js";\n\nexport function cartLine(name, cents, qty) {\n  return `${name} x${qty}: ${fmtPrice(cents * qty)}`;\n}\n',
      "main.js":
        'import { cartLine } from "./lib/cart.js";\nimport { fmtPrice } from "./lib/format.js";\n\nconsole.log(cartLine("pen", 150, 3));\nconsole.log("total", fmtPrice(450));\n',
    },
    prompt:
      "Rename the function fmtPrice to formatPrice everywhere in this project. `node main.js` must print the same output as before.",
    async check(workspace) {
      const files = (await listFiles(workspace)).filter((file) => file.endsWith(".js"));
      const contents = await Promise.all(files.map((file) => readText(join(workspace, file))));
      if (contents.some((content) => content?.includes("fmtPrice"))) return { pass: false, detail: "fmtPrice remains" };
      if (!contents.some((content) => /export function formatPrice\b/u.test(content ?? "")))
        return { pass: false, detail: "no formatPrice export" };
      const result = await node(workspace, "main.js");
      const pass = result.stdout === "pen x3: $4.50\ntotal $4.50\n";
      return { pass, detail: pass ? "same output" : `output ${JSON.stringify(result.stdout + result.stderr)}` };
    },
  },
  {
    id: "debug-run",
    skill: "Run a program, read the error, and fix the cause",
    files: {
      "package.json": '{ "type": "module" }\n',
      "app.js": `import { readFileSync } from "node:fs";
const config = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
if (typeof config.server?.port !== "number") throw new Error("config: server.port must be a number");
if (!config.server.host) throw new Error("config: server.host is missing");
console.log(\`ready on \${config.server.host}:\${config.server.port}\`);
`,
      "config.json": '{\n  "server": {\n    "Port": "8080",\n    "hostname": "localhost"\n  }\n}\n',
    },
    prompt:
      "`node app.js` fails. Fix config.json (do not change app.js) so that the app starts on localhost port 8080.",
    async check(workspace) {
      const app = await readText(join(workspace, "app.js"));
      if (!app?.includes("server.port must be a number")) return { pass: false, detail: "app.js changed" };
      const result = await node(workspace, "app.js");
      const pass = result.stdout.trim() === "ready on localhost:8080";
      return { pass, detail: pass ? "starts" : (result.stdout + result.stderr).slice(0, 300) };
    },
  },
  {
    id: "reasoning",
    skill: "Answer a counting question with no tools, in the asked format",
    files: {},
    prompt:
      "How many integers from 1 to 1000 inclusive are divisible by 3 or by 5, but not by 15? Do not use any tool. Reply with only the number.",
    async check(_workspace, reply) {
      const answer = reply.trim().replace(/[*`.]/gu, "").trim();
      return { pass: answer === "401", detail: `reply ${JSON.stringify(reply.trim().slice(0, 80))}` };
    },
  },
  {
    id: "writing",
    skill: "Summarize notes under strict format rules",
    files: {
      "notes.md": `# Launch sync, 2026-11-04

Attendees: Ana, Bo, Chen, Dee.

- The mobile build passed review on Monday. Bo will submit it to the store on Thursday.
- Launch date moved from 2026-11-20 to 2026-12-01 because the payment provider needs two more weeks for the audit.
- Chen reported that 3 of 40 beta testers hit a login loop. The fix is merged; QA checks it on Friday.
- Marketing wants the press kit by 2026-11-24. Dee owns it.
- Next sync is 2026-11-11.
`,
    },
    prompt:
      "Read notes.md and write summary.md. It must have exactly 3 lines, each a bullet that starts with '- ', each at most 20 words. One bullet must give the new launch date as 2026-12-01. No title and no other lines.",
    async check(workspace) {
      const text = await readText(join(workspace, "summary.md"));
      if (!text) return { pass: false, detail: "no summary.md" };
      const lines = text.split(/\r?\n/u).filter((line) => line.trim());
      const wrong: string[] = [];
      if (lines.length !== 3) wrong.push(`${lines.length} lines`);
      if (!lines.every((line) => line.startsWith("- "))) wrong.push("not all bullets");
      const longest = Math.max(...lines.map((line) => line.slice(2).trim().split(/\s+/u).length));
      if (longest > 20) wrong.push(`${longest} words`);
      if (!text.includes("2026-12-01")) wrong.push("no launch date");
      return { pass: wrong.length === 0, detail: wrong.length ? wrong.join(", ") : "format holds" };
    },
  },
  {
    id: "csv-parser",
    skill: "Fix a parser with subtle bugs; hidden cases catch a fix that only fits the tests",
    files: {
      "package.json": '{ "type": "module" }\n',
      "parse.js": `// Splits one CSV line into its fields (RFC 4180): a field in double quotes can hold commas,
// and two double quotes inside it stand for one.
export function parseLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current) fields.push(current.trim());
  return fields;
}
`,
      "test.js": `import assert from "node:assert/strict";
import { parseLine } from "./parse.js";
assert.deepEqual(parseLine("a,b,c"), ["a", "b", "c"]);
assert.deepEqual(parseLine('a,"b,c",d'), ["a", "b,c", "d"]);
assert.deepEqual(parseLine('"say ""hi""",x'), ['say "hi"', "x"]);
assert.deepEqual(parseLine("a,,c,"), ["a", "", "c", ""]);
assert.deepEqual(parseLine('" padded ",y'), [" padded ", "y"]);
console.log("ok");
`,
    },
    prompt:
      "`node test.js` fails. Fix parseLine in parse.js so that it follows its comment and the tests pass. Do not change test.js.",
    async check(workspace) {
      const script = join(workspace, ".check-parse.mjs");
      await writeFile(
        script,
        `import assert from "node:assert/strict";
import { parseLine } from "./parse.js";
assert.deepEqual(parseLine(","), ["", ""]);
assert.deepEqual(parseLine('"",""'), ["", ""]);
assert.deepEqual(parseLine('x,"a ""b"", c",'), ["x", 'a "b", c', ""]);
assert.deepEqual(parseLine('"q"""'), ['q"']);
assert.deepEqual(parseLine("1, 2 ,3"), ["1", "2", "3"]);
console.log("ok");
`,
      );
      const visible = await node(workspace, "test.js");
      if (visible.code !== 0) return { pass: false, detail: `test.js: ${visible.stderr.slice(0, 200)}` };
      const hidden = await node(workspace, script);
      return { pass: hidden.code === 0, detail: hidden.code === 0 ? "hidden cases pass" : hidden.stderr.slice(0, 300) };
    },
  },
  {
    id: "ttl-cache",
    skill: "Write a small data structure from a precise specification",
    files: { "package.json": '{ "type": "module" }\n' },
    prompt: [
      "Create cache.js that exports a class TtlLru:",
      "- constructor(capacity, ttlMs, now = () => Date.now()): `now` is the clock, in milliseconds.",
      "- set(key, value): stores the value, which expires ttlMs after this call, and makes the key the most recently used. When the key is new and the cache already holds `capacity` entries, it first drops every expired entry, and then, if it is still full, the least recently used entry.",
      "- get(key): the value, or undefined when the key is missing or expired. A hit makes the key the most recently used. An expired entry is removed.",
      "- delete(key): removes the key; returns true when the cache had a live entry for it.",
      "- get size: the number of entries that have not expired.",
      "An entry expires when now() >= the time it was set + ttlMs.",
    ].join(NL),
    async check(workspace) {
      const script = join(workspace, ".check-cache.mjs");
      await writeFile(
        script,
        `import assert from "node:assert/strict";
import { TtlLru } from "./cache.js";
let t = 0;
const c = new TtlLru(2, 100, () => t);
c.set("a", 1); c.set("b", 2);
assert.equal(c.get("a"), 1);
c.set("c", 3);
assert.equal(c.get("b"), undefined, "LRU entry b is evicted");
assert.equal(c.get("a"), 1); assert.equal(c.get("c"), 3);
assert.equal(c.size, 2);
t = 99; assert.equal(c.get("a"), 1);
t = 100; assert.equal(c.get("a"), undefined, "expires at set + ttl");
assert.equal(c.size, 0);
t = 200; c.set("x", 1); t = 250; c.set("y", 2);
assert.equal(c.get("x"), 1);
t = 300; c.set("z", 3);
assert.equal(c.get("y"), 2, "expired x goes before LRU y");
assert.equal(c.get("z"), 3);
assert.equal(c.delete("z"), true); assert.equal(c.delete("z"), false);
c.set("y", 5); assert.equal(c.get("y"), 5);
t = 399; assert.equal(c.get("y"), 5, "set again renews the expiry");
const d = new TtlLru(1, 10, () => t); d.set("k", 1); t += 10; assert.equal(d.delete("k"), false);
const real = new TtlLru(1, 60000); real.set("r", 1); assert.equal(real.get("r"), 1);
console.log("ok");
`,
      );
      const result = await node(workspace, script);
      return { pass: result.code === 0, detail: result.code === 0 ? "spec holds" : result.stderr.slice(0, 300) };
    },
  },
  {
    id: "cli-flag",
    skill: "Change a small CLI in several places and extend its test",
    files: {
      "package.json": '{ "type": "module" }\n',
      "inventory.js": `export const ITEMS = [
  { sku: "A-1", name: "Bolt", stock: 120, min: 50 },
  { sku: "B-7", name: "Nut", stock: 30, min: 40 },
  { sku: "C-3", name: "Washer", stock: 0, min: 10 },
];

export function lowStock(items) {
  return items.filter((item) => item.stock < item.min);
}
`,
      "cli.js": `import { ITEMS, lowStock } from "./inventory.js";

const low = lowStock(ITEMS);
console.log(\`\${low.length} of \${ITEMS.length} items are low:\`);
for (const item of low) console.log(\`- \${item.sku} \${item.name}: \${item.stock}/\${item.min}\`);
`,
      "test.js": `import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const text = execFileSync("node", ["cli.js"], { encoding: "utf8" });
assert.equal(text, "2 of 3 items are low:\\n- B-7 Nut: 30/40\\n- C-3 Washer: 0/10\\n");
console.log("ok");
`,
    },
    prompt: [
      "Add a --json flag to cli.js. With it, the CLI prints only one line of JSON:",
      '{"total":<number of items>,"low":[{"sku":...,"missing":<min - stock>},...]}, with the low items in the same order as the text output.',
      "Without the flag the output must not change. Add a check for --json to test.js, and make sure `node test.js` passes.",
    ].join(NL),
    async check(workspace) {
      const text = await node(workspace, "cli.js");
      if (text.stdout !== "2 of 3 items are low:\n- B-7 Nut: 30/40\n- C-3 Washer: 0/10\n")
        return { pass: false, detail: "text output changed" };
      const json = await node(workspace, "cli.js", "--json");
      const lines = json.stdout.trim().split(NL);
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[0] ?? "");
      } catch {
        return { pass: false, detail: `--json output ${JSON.stringify(json.stdout.slice(0, 120))}` };
      }
      const expected = {
        total: 3,
        low: [
          { sku: "B-7", missing: 10 },
          { sku: "C-3", missing: 10 },
        ],
      };
      if (lines.length !== 1 || JSON.stringify(parsed) !== JSON.stringify(expected))
        return { pass: false, detail: `--json ${json.stdout.trim().slice(0, 160)}` };
      const test = await readText(join(workspace, "test.js"));
      if (!test?.includes("--json")) return { pass: false, detail: "test.js has no --json check" };
      const tests = await node(workspace, "test.js");
      return { pass: tests.code === 0, detail: tests.code === 0 ? "all hold" : tests.stderr.slice(0, 200) };
    },
  },
  {
    id: "date-math",
    skill: "Calendar reasoning with no tools, in the asked format",
    files: {},
    prompt:
      "Count 100 business days (Monday to Friday, no holidays) forward from Monday 2026-01-05, not counting that Monday. Which date is the 100th business day? Do not use any tool. Reply with only the date as YYYY-MM-DD.",
    async check(_workspace, reply) {
      const answer = reply.trim().replace(/[*`.]/gu, "").trim();
      return { pass: answer === "2026-05-25", detail: `reply ${JSON.stringify(reply.trim().slice(0, 80))}` };
    },
  },
];

const RunSchema = Schema.Struct({
  model: Schema.String,
  task: Schema.String,
  repeat: Schema.Number,
  pass: Schema.Boolean,
  /** Set when the run did not reach a result: the free limit, a refusal, a timeout or a crash. */
  error: Schema.NullOr(Schema.String),
  detail: Schema.String,
  wallMs: Schema.Number,
  steps: Schema.Number,
  toolCalls: Schema.Number,
  failedToolCalls: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  reasoningTokens: Schema.Number,
});
// Built field by field while the run's events are read.
type Run = { -readonly [Key in keyof Schema.Schema.Type<typeof RunSchema>]: Schema.Schema.Type<typeof RunSchema>[Key] };
const decodeRun = Schema.decodeUnknownSync(Schema.fromJsonString(RunSchema));

const EventSchema = Schema.Struct({
  type: Schema.optional(Schema.String),
  part: Schema.optional(
    Schema.Struct({
      text: Schema.optional(Schema.String),
      tokens: Schema.optional(
        Schema.Struct({
          input: Schema.optional(Schema.Number),
          output: Schema.optional(Schema.Number),
          reasoning: Schema.optional(Schema.Number),
          cache: Schema.optional(Schema.Struct({ read: Schema.optional(Schema.Number) })),
        }),
      ),
      state: Schema.optional(Schema.Struct({ status: Schema.optional(Schema.String) })),
    }),
  ),
  error: Schema.optional(Schema.Unknown),
});
type Event = Schema.Schema.Type<typeof EventSchema>;
const decodeEvent = Schema.decodeUnknownSync(Schema.fromJsonString(EventSchema));

const SummarySchema = Schema.Struct({
  rows: Schema.optional(Schema.Unknown),
  revenueByRegion: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  topProductByUnits: Schema.optional(Schema.Unknown),
});

async function runOnce(cli: string, model: string, task: Task, repeat: number): Promise<Run> {
  const home = await isolated();
  const workspace = join(home.root, "workspace");
  await mkdir(workspace, { recursive: true });
  await writeFiles(workspace, task.files);
  const startedAt = performance.now();
  const result = await exec(cli, ["run", "--standalone", "--auto", "--format", "json", "-m", model, task.prompt], {
    cwd: workspace,
    env: home.env,
  });
  const wallMs = Math.round(performance.now() - startedAt);
  const run: Run = {
    model,
    task: task.id,
    repeat,
    pass: false,
    error: null,
    detail: "",
    wallMs,
    steps: 0,
    toolCalls: 0,
    failedToolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
  const texts: string[] = [];
  const errors: string[] = [];
  for (const line of result.stdout.split(NL)) {
    if (!line.startsWith("{")) continue;
    let event: Event;
    try {
      event = decodeEvent(line);
    } catch {
      continue;
    }
    if (event.type === "text" && event.part?.text) texts.push(event.part.text);
    if (event.type === "tool_use") {
      run.toolCalls += 1;
      if (event.part?.state?.status === "error") run.failedToolCalls += 1;
    }
    if (event.type === "step_finish") {
      run.steps += 1;
      const tokens = event.part?.tokens;
      run.inputTokens += (tokens?.input ?? 0) + (tokens?.cache?.read ?? 0);
      run.outputTokens += tokens?.output ?? 0;
      run.reasoningTokens += tokens?.reasoning ?? 0;
    }
    if (event.type === "error") errors.push(JSON.stringify(event.error ?? event).slice(0, 300));
  }
  const reply = texts.join("");
  if (result.timedOut) run.error = "timeout";
  else if (errors.length) run.error = errors.join(" | ");
  else if (result.code !== 0) run.error = `exit ${result.code}: ${result.stderr.trim().slice(-300)}`;
  else if (run.steps === 0) run.error = `no steps: ${result.stderr.trim().slice(-300)}`;
  const check = await task.check(workspace, reply).catch((error: unknown) => ({ pass: false, detail: String(error) }));
  run.pass = check.pass;
  run.detail = check.detail;
  await rm(home.root, { recursive: true, force: true });
  return run;
}

async function freeModels(cli: string): Promise<string[]> {
  const home = await isolated();
  const result = await exec(cli, ["models", "--standalone"], { cwd: home.root, env: home.env });
  await rm(home.root, { recursive: true, force: true });
  if (result.code !== 0) throw new Error(`opencode models failed: ${result.stderr}`);
  return result.stdout
    .split(NL)
    .map((line) => line.trim())
    .filter((id) => id.startsWith("opencode/") && isFreeOpencodeModel(id, id));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const isFreeLimit = (run: Run) => Boolean(run.error?.includes("provider.free-limit"));
const isRegionRefusal = (run: Run) => Boolean(run.error?.includes("not available in your country"));
const RUNS_FILE = join(OUT, "runs.jsonl");

/** The runs of earlier invocations, so that a bench that the free limit stopped goes on where it stopped. */
async function savedRuns(): Promise<Run[]> {
  if (process.argv.includes("--fresh")) await rm(RUNS_FILE, { force: true });
  const text = (await readText(RUNS_FILE)) ?? "";
  return text
    .split(NL)
    .filter(Boolean)
    .map((line) => decodeRun(line));
}

async function main(): Promise<void> {
  const cli = await opencodeCli();
  const version = (await exec(cli, ["--version"], { cwd: tmpdir(), env: process.env })).stdout.trim();
  const listed = await freeModels(cli);
  const onlyModels = flag("model");
  const models = onlyModels.length ? listed.filter((id) => onlyModels.includes(id)) : listed;
  const onlyTasks = flag("task");
  const tasks = onlyTasks.length ? TASKS.filter((task) => onlyTasks.includes(task.id)) : TASKS;
  await mkdir(OUT, { recursive: true });
  const runs = await savedRuns();
  const done = new Set(runs.map((run) => `${run.model} ${run.task} ${run.repeat}`));
  const refused = new Set(runs.filter(isRegionRefusal).map((run) => run.model));
  // Repeat-major and task-major, so each model meets the same time of day and the same limit state.
  const jobs = Array.from({ length: REPEATS }, (_, repeat) =>
    tasks.flatMap((task) => models.map((model) => ({ model, task, repeat }))),
  )
    .flat()
    .filter((job) => !done.has(`${job.model} ${job.task.id} ${job.repeat}`));
  print(
    `${version}: ${models.length} free models, ${tasks.length} tasks, ${REPEATS} repeats, ${runs.length} saved runs, ${jobs.length} to run`,
  );
  let next = 0;
  let limited = false;
  let finished = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (!limited && next < jobs.length) {
        const job = jobs[next++];
        if (!job) break;
        // A model that the country refuses refuses every task; one refusal is enough to report it.
        if (refused.has(job.model)) continue;
        const run = await runOnce(cli, job.model, job.task, job.repeat);
        finished += 1;
        const state = run.error ? `ERROR ${run.error.slice(0, 120)}` : run.pass ? "pass" : `fail ${run.detail}`;
        print(`[${finished}/${jobs.length}] ${job.model} ${job.task.id}#${job.repeat} ${run.wallMs}ms ${state}`);
        // The limit says nothing about the model, so the run is not kept and runs again next time.
        if (isFreeLimit(run)) {
          limited = true;
          break;
        }
        if (isRegionRefusal(run)) refused.add(run.model);
        runs.push(run);
        await writeFile(RUNS_FILE, `${JSON.stringify(run)}${NL}`, { flag: "a" });
      }
    }),
  );
  const ranking = models
    .map((model) => {
      const own = runs.filter((run) => run.model === model && tasks.some((task) => task.id === run.task));
      const passed = own.filter((run) => run.pass);
      return {
        model,
        available: !refused.has(model),
        passed: passed.length,
        runs: own.length,
        errors: own.filter((run) => run.error).length,
        passRate: own.length ? passed.length / own.length : 0,
        medianWallMs: median(own.map((run) => run.wallMs)),
        totalWallMs: own.reduce((sum, run) => sum + run.wallMs, 0),
        medianOutputTokens: median(own.map((run) => run.outputTokens + run.reasoningTokens)),
        failedToolCalls: own.reduce((sum, run) => sum + run.failedToolCalls, 0),
        failedTasks: own.filter((run) => !run.pass).map((run) => `${run.task}#${run.repeat}`),
      };
    })
    // Available first, then the best pass rate; between equal rates, the faster model.
    .sort(
      (a, b) => Number(b.available) - Number(a.available) || b.passRate - a.passRate || a.medianWallMs - b.medianWallMs,
    );
  const report = {
    date: new Date().toISOString(),
    opencode: version,
    repeats: REPEATS,
    complete: !limited && ranking.every((row) => !row.available || row.runs === tasks.length * REPEATS),
    tasks: tasks.map(({ id, skill, prompt }) => ({ id, skill, prompt })),
    ranking,
    runs,
  };
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}${NL}`);
  if (limited) print(`${NL}The free usage limit stopped the bench. Run it again later to go on.`);
  print(`${NL}model | passed | median s | total s | output tokens | failed`);
  for (const row of ranking) {
    const passed = row.available ? `${row.passed}/${row.runs}` : "not available here";
    print(
      `${row.model} | ${passed} | ${(row.medianWallMs / 1000).toFixed(1)} | ${(row.totalWallMs / 1000).toFixed(0)} | ${row.medianOutputTokens} | ${row.failedTasks.join(" ")}`,
    );
  }
  print(`${NL}Report: ${join(OUT, "report.json")}`);
}

await main();
