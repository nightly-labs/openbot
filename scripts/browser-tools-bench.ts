// `bun run bench:browser-tools`: compares how many tokens a Claude agent spends on the same browser
// tasks with different browser tools. It is a manual measurement, not a CI check: it uses the
// developer's Claude quota and real public sites.
//
// Variants:
// - A: `openbot_browser` single action tools only.
// - C: `openbot_browser` with `run_script`, named in the prompt.
// - S: `openbot_browser` with its shipped guidance only.
// - D: Browser Harness (`browser-harness` on PATH, through Bash), attached to the app's CDP port.
// - E: Playwright MCP (`npx --offline @playwright/mcp`), attached to the app's CDP port.
// - F: Chrome DevTools MCP (`npx --offline chrome-devtools-mcp`), attached to the app's CDP port.
//
// The bench never downloads a tool: D runs only when `browser-harness` is installed, and E and F use
// the npx cache. Each run makes a new agent, opens the start page in a tab of the built app, sends
// one task, and reads the token use of that turn from the agent's analytics. Tool names come from
// the Claude session file of the turn, so a run that used a tool outside its variant is flagged.
// Ground truth is read from the sites at run time.
//
// Everything runs on the bench's own profile (`OpenBot Dev wt-<hash>#browser-tools-bench`) and the
// process group it started. It never reaches a dev instance or the developer's own profile.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type AgentAnalytics, analyticsRange } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { type Browser, chromium, type Page } from "playwright-core";
import { developmentInstanceIdForWorktree, developmentUserDataName } from "../src/main/development-profile";
import { ensureBenchAuthApi, signInBenchAccount } from "./dev-automation/bench-auth";
import { type BenchApp, launchBenchApp } from "./dev-automation/bench-launch";
import { verifyBrowserOwnership } from "./dev-automation/cdp-client";
import { resolveDevelopmentAppDataRoot } from "./development-state-paths";
import { readScriptArguments } from "./script-arguments";
import { NO_SCALE } from "./seed-dev-scale";
import { seedDevelopmentState } from "./seed-dev-state";

const logger = createOpenBotLogger("browser-tools-bench", (line) => process.stderr.write(`${line}\n`), "info");

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = join(PROJECT_ROOT, ".openbot-build", "browser-tools-bench");
const INSTANCE_ID = developmentInstanceIdForWorktree(`${PROJECT_ROOT}#browser-tools-bench`);
const CENTRAL_AUTH_FILE = "openbot-central-auth-v1.bin";
const MODEL = "claude-haiku-5-5";
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const READY_TIMEOUT_MS = 90 * SECOND;
const TURN_TIMEOUT_MS = 10 * MINUTE;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) OpenBotBench/1.0";
const PLAYWRIGHT_MCP_NAME = "bench_playwright";
const DEVTOOLS_MCP_NAME = "bench_devtools";
// A named Browser Harness daemon opens its own tab with `Target.createTarget`, which Electron does not
// support, so the bench uses the default daemon in its own directory. The daemon outlives the bench, so
// each bench gets a new directory and stops the daemon at the end. The path stays short for the socket.
const HARNESS_DIR = `/tmp/openbot-bench-harness-${process.pid}`;

const wait = (milliseconds: number) => new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));
const json = (value: unknown) => JSON.stringify(value);

// --- tasks -------------------------------------------------------------------------------------

interface BenchTask {
  id: string;
  startUrl: string;
  question: string;
  /** Reads the expected answer from the site now, so changed data does not break the score. */
  truth: () => Promise<string>;
  /** True when the agent's answer matches the truth. */
  score: (answer: string, truth: string) => boolean;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(30 * SECOND),
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return response.text();
}

function decodeEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function normalize(text: string): string {
  return decodeEntities(text)
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[’‘]/gu, "'")
    .replaceAll(/[^\p{L}\p{N}.$' ]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function numbersIn(text: string): number[] {
  return [...text.replaceAll(",", "").matchAll(/\d+(?:\.\d+)?/gu)].map((match) => Number(match[0]));
}

const sameNumber = (answer: string, truth: string) => numbersIn(answer).includes(Number(truth));

/** Follows the "next" links of a paged list and returns every page. */
async function pages(first: string, next: RegExp, limit = 20): Promise<string[]> {
  const found: string[] = [];
  let url: string | null = first;
  while (url !== null && found.length < limit) {
    const html = await fetchText(url);
    found.push(html);
    const link = next.exec(html)?.[1];
    url = link === undefined ? null : new URL(decodeEntities(link), url).toString();
  }
  return found;
}

const TASKS: BenchTask[] = [
  {
    id: "books-travel",
    startUrl: "https://books.toscrape.com/",
    question:
      "In the Travel category, how many books are listed, and what is the full title of the most expensive one? Answer as `<count>; <title>`.",
    truth: async () => {
      const html = await fetchText("https://books.toscrape.com/catalogue/category/books/travel_2/index.html");
      const titles = [...html.matchAll(/<h3><a [^>]*title="([^"]+)"/gu)].map((match) => decodeEntities(match[1] ?? ""));
      const prices = [...html.matchAll(/class="price_color">£([\d.]+)</gu)].map((match) => Number(match[1]));
      const top = prices.indexOf(Math.max(...prices));
      return `${titles.length}; ${titles[top] ?? ""}`;
    },
    score: (answer, truth) => {
      const [count, title = ""] = truth.split("; ");
      return sameNumber(answer, count ?? "") && normalize(answer).includes(normalize(title).slice(0, 24));
    },
  },
  {
    id: "books-mystery-five",
    startUrl: "https://books.toscrape.com/",
    question:
      "How many books in the Mystery category have a five-star rating? The category has more than one page. Answer with the number.",
    truth: async () => {
      const all = await pages(
        "https://books.toscrape.com/catalogue/category/books/mystery_3/index.html",
        /<li class="next"><a href="([^"]+)"/u,
      );
      return String(all.reduce((sum, html) => sum + (html.match(/star-rating Five/gu)?.length ?? 0), 0));
    },
    score: sameNumber,
  },
  {
    id: "quotes-einstein",
    startUrl: "https://quotes.toscrape.com/",
    question:
      "Go through every page of quotes on this site and count the quotes by Albert Einstein. Answer with the number.",
    truth: async () => {
      const all = await pages("https://quotes.toscrape.com/", /<li class="next">\s*<a href="([^"]+)"/u);
      return String(
        all.reduce((sum, html) => sum + (html.match(/itemprop="author">Albert Einstein</gu)?.length ?? 0), 0),
      );
    },
    score: sameNumber,
  },
  {
    id: "quotes-love-tag",
    startUrl: "https://quotes.toscrape.com/",
    question:
      "Open the quotes with the tag 'love' and count every quote with that tag, on every page of the tag. Answer with the number.",
    truth: async () => {
      const all = await pages("https://quotes.toscrape.com/tag/love/", /<li class="next">\s*<a href="([^"]+)"/u);
      return String(all.reduce((sum, html) => sum + (html.match(/class="quote"/gu)?.length ?? 0), 0));
    },
    score: sameNumber,
  },
  {
    id: "herokuapp-dynamic",
    startUrl: "https://the-internet.herokuapp.com/dynamic_loading/2",
    question: "Click Start and wait until the loading ends. What text appears? Answer with that text.",
    truth: async () => {
      const html = await fetchText("https://the-internet.herokuapp.com/dynamic_loading/1");
      return /<div id='finish'[^>]*>\s*<h4>([^<]+)<\/h4>/u.exec(html)?.[1] ?? "";
    },
    score: (answer, truth) => truth !== "" && normalize(answer).includes(normalize(truth)),
  },
  {
    id: "herokuapp-tables",
    startUrl: "https://the-internet.herokuapp.com/tables",
    question: "In Example 1, which person has the largest Due amount? Answer as `<first name> <last name>`.",
    truth: async () => {
      const html = await fetchText("https://the-internet.herokuapp.com/tables");
      const table = /<table id="table1"[\s\S]*?<\/table>/u.exec(html)?.[0] ?? "";
      const rows = [
        ...table.matchAll(/<tr>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>[^<]*<\/td>\s*<td>\$([\d.]+)<\/td>/gu),
      ];
      const top = rows.reduce<RegExpExecArray | RegExpMatchArray | null>(
        (best, row) => (best === null || Number(row[3]) > Number(best[3]) ? row : best),
        null,
      );
      return top ? `${top[2]} ${top[1]}` : "";
    },
    score: (answer, truth) =>
      truth !== "" && truth.split(" ").every((name) => normalize(answer).includes(normalize(name))),
  },
  {
    id: "herokuapp-add-remove",
    startUrl: "https://the-internet.herokuapp.com/add_remove_elements/",
    question:
      "Click 'Add Element' 5 times, then click 2 of the Delete buttons. How many Delete buttons are on the page now? Answer with the number.",
    truth: async () => "3",
    score: sameNumber,
  },
  {
    id: "wikipedia-rust",
    startUrl: "https://en.wikipedia.org/wiki/Main_Page",
    question:
      "Use the site's search box to open the article about the Rust programming language, then report the latest stable release version from its infobox. Answer with the version.",
    truth: async () => {
      const html = await fetchText("https://en.wikipedia.org/wiki/Rust_(programming_language)");
      const near = /Stable release[\s\S]{0,600}/u.exec(html)?.[0].replaceAll(/<[^>]*>/gu, " ") ?? "";
      return /\d+\.\d+(?:\.\d+)?/u.exec(near)?.[0] ?? "";
    },
    score: (answer, truth) => truth !== "" && answer.includes(truth),
  },
  {
    id: "github-bun-release",
    startUrl: "https://github.com/oven-sh/bun",
    question: "What is the tag name of the latest release of this repository? Answer with the tag name.",
    // The API limits calls without a token, so read the tag from the page's redirect.
    truth: async () => {
      const response = await fetch("https://github.com/oven-sh/bun/releases/latest", {
        method: "HEAD",
        redirect: "manual",
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(30 * SECOND),
      });
      return /\/releases\/tag\/([^/?#]+)$/u.exec(response.headers.get("location") ?? "")?.[1] ?? "";
    },
    score: (answer, truth) => truth !== "" && answer.includes(truth.replace(/^bun-v/u, "")),
  },
  {
    id: "webscraper-tablets",
    startUrl: "https://webscraper.io/test-sites/e-commerce/static/computers/tablets",
    question: "Go through every page of tablets. How many tablets cost more than $500? Answer with the number.",
    truth: async () => {
      const all = await pages(
        "https://webscraper.io/test-sites/e-commerce/static/computers/tablets",
        /<a class="page-link next" href="([^"]+)"/u,
      );
      const prices = all.flatMap((html) =>
        [...html.matchAll(/<span itemprop="price">\$([\d,.]+)<\/span>/gu)].map((match) =>
          Number((match[1] ?? "").replaceAll(",", "")),
        ),
      );
      return String(prices.filter((price) => price > 500).length);
    },
    score: sameNumber,
  },
];

// --- variants ----------------------------------------------------------------------------------

type Family = "openbot_browser" | "harness" | "playwright" | "devtools" | "web" | "bash" | "catalog" | "other";

interface Variant {
  id: string;
  description: string;
  families: Family[];
  /** `openbot_browser` tools the variant must not call. */
  forbiddenBrowserTools?: string[];
  mcp?: typeof PLAYWRIGHT_MCP_NAME | typeof DEVTOOLS_MCP_NAME;
  instructions: (tab: { id: string; url: string }, cdpUrl: string) => string;
}

const EXTERNAL_TAB = (tab: { url: string }) =>
  `The page is already open in a tab whose URL is ${tab.url}. Select that tab first. ` +
  "Never use or change a page whose URL starts with openbot-app://: it is the OpenBot app window.";

const VARIANTS: Variant[] = [
  {
    id: "A",
    description: "openbot_browser, single actions",
    families: ["openbot_browser", "catalog"],
    forbiddenBrowserTools: ["run_script"],
    instructions: (tab) =>
      `Use only the openbot_browser tools, one action per call. Do not use openbot_browser.run_script. The page is already open in tab ${tab.id} at ${tab.url}; use that tab.`,
  },
  {
    id: "C",
    description: "openbot_browser + run_script",
    families: ["openbot_browser", "catalog"],
    instructions: (tab) =>
      `Use only the openbot_browser tools. For paging, loops, and data collection, use one openbot_browser.run_script call and return only the data you need. The page is already open in tab ${tab.id} at ${tab.url}; use that tab.`,
  },
  {
    id: "S",
    description: "openbot_browser, shipped guidance",
    families: ["openbot_browser", "catalog"],
    instructions: (tab) =>
      `Use only the openbot_browser tools. The page is already open in tab ${tab.id} at ${tab.url}; use that tab.`,
  },
  {
    id: "D",
    description: "Browser Harness (Bash)",
    families: ["harness", "catalog"],
    instructions: (tab, cdpUrl) =>
      "Do not use the openbot_browser tools. Drive the browser only with Browser Harness from Bash. Run Python with its helpers like this:\n" +
      `BH_TMP_DIR=${HARNESS_DIR} BU_CDP_URL=${cdpUrl} BH_TAB_MARKER=0 BH_TELEMETRY=0 browser-harness <<'PY'\nprint(list_tabs())\nPY\n` +
      "Run `browser-harness --help` if you need its usage. " +
      EXTERNAL_TAB(tab),
  },
  {
    id: "E",
    description: "Playwright MCP",
    families: ["playwright", "catalog"],
    mcp: PLAYWRIGHT_MCP_NAME,
    instructions: (tab) =>
      `Do not use the openbot_browser tools. Use only the ${PLAYWRIGHT_MCP_NAME} MCP tools. ${EXTERNAL_TAB(tab)}`,
  },
  {
    id: "F",
    description: "Chrome DevTools MCP",
    families: ["devtools", "catalog"],
    mcp: DEVTOOLS_MCP_NAME,
    instructions: (tab) =>
      `Do not use the openbot_browser tools. Use only the ${DEVTOOLS_MCP_NAME} MCP tools. ${EXTERNAL_TAB(tab)}`,
  },
];

function taskPrompt(
  variant: Variant,
  task: BenchTask,
  tab: { id: string; url: string },
  cdpUrl: string,
  marker: string,
) {
  return [
    `Browser benchmark task (${marker}).`,
    variant.instructions(tab, cdpUrl),
    "Find the answer in the browser, not from memory. Do not use WebFetch, WebSearch, curl, or any other HTTP client.",
    `Task: ${task.question}`,
    "End your reply with one line: `ANSWER: <answer>`.",
  ].join("\n\n");
}

// --- tool use from the Claude session file -----------------------------------------------------

interface ToolUse {
  family: Family;
  name: string;
}

function classifyTool(name: string, input: unknown): ToolUse {
  const record = isDynamicRecord(input) ? input : {};
  if (name === "mcp__openbot__tool_call" && typeof record.name === "string") {
    const called = record.name;
    if (called.startsWith("openbot_browser.")) return { family: "openbot_browser", name: called };
    return { family: "other", name: called };
  }
  if (name.includes("openbot_browser")) {
    return { family: "openbot_browser", name: `openbot_browser.${name.split("__").at(-1) ?? name}` };
  }
  if (name === "mcp__openbot__tool_search" || name === "mcp__openbot__tool_describe" || name === "ToolSearch") {
    return { family: "catalog", name };
  }
  if (name.startsWith(`mcp__${PLAYWRIGHT_MCP_NAME}__`)) return { family: "playwright", name };
  if (name.startsWith(`mcp__${DEVTOOLS_MCP_NAME}__`)) return { family: "devtools", name };
  if (name === "WebFetch" || name === "WebSearch") return { family: "web", name };
  if (name === "Bash") {
    const command = typeof record.command === "string" ? record.command : "";
    if (command.includes("browser-harness")) return { family: "harness", name: "browser-harness" };
    if (/\b(curl|wget)\b|fetch\(|requests\.get|urllib/u.test(command)) return { family: "web", name: "Bash http" };
    return { family: "bash", name: "Bash" };
  }
  return { family: "other", name };
}

async function claudeSessionDirectories(): Promise<string[]> {
  const roots = [process.env.CLAUDE_CONFIG_DIR, join(homedir(), ".claude")].filter(
    (root): root is string => typeof root === "string" && root !== "",
  );
  const directories: string[] = [];
  for (const root of new Set(roots)) {
    const projects = join(root, "projects");
    const entries = await readdir(projects).catch(() => []);
    for (const entry of entries) directories.push(join(projects, entry));
  }
  return directories;
}

/** Reads the tool calls after the marker from the session file that holds it. Null when no file has it. */
async function readToolUses(marker: string, since: number): Promise<ToolUse[] | null> {
  for (const directory of await claudeSessionDirectories()) {
    const files = await readdir(directory).catch(() => []);
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const path = join(directory, file);
      const info = await stat(path).catch(() => null);
      if (!info || info.mtimeMs < since) continue;
      const text = await readFile(path, "utf8").catch(() => "");
      const start = text.indexOf(marker);
      if (start < 0) continue;
      const uses: ToolUse[] = [];
      for (const line of text.slice(start).split("\n")) {
        if (!line.includes('"tool_use"')) continue;
        let entry: unknown;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        // The file also keeps a copy of some calls in `api-request-blob` entries; only assistant entries are calls.
        if (!isDynamicRecord(entry) || entry.type !== "assistant") continue;
        const message = entry.message;
        const content = isDynamicRecord(message) ? message.content : undefined;
        if (!Array.isArray(content)) continue;
        for (const item of content) {
          if (isDynamicRecord(item) && item.type === "tool_use" && typeof item.name === "string") {
            uses.push(classifyTool(item.name, item.input));
          }
        }
      }
      return uses;
    }
  }
  return null;
}

function violations(variant: Variant, uses: ToolUse[]): string[] {
  const found = new Set<string>();
  for (const use of uses) {
    if (use.family === "web") found.add(use.name);
    else if (use.family === "bash" && variant.id === "D") continue;
    else if (use.family === "bash" || use.family === "other") continue;
    else if (!variant.families.includes(use.family)) found.add(use.name);
    else if (
      use.family === "openbot_browser" &&
      variant.forbiddenBrowserTools?.some((tool) => use.name === `openbot_browser.${tool}`)
    )
      found.add(use.name);
  }
  return [...found];
}

// --- app ---------------------------------------------------------------------------------------

function profilePath(): string {
  const appDataRoot = resolveDevelopmentAppDataRoot(process.platform, process.env, homedir());
  const profile = resolve(appDataRoot, developmentUserDataName("app", INSTANCE_ID));
  if (dirname(profile) !== appDataRoot) throw new Error(`Unsafe bench profile path: ${profile}`);
  return profile;
}

/**
 * Starts each bench on a freshly seeded profile, like `dev:bench`: an empty profile never opens the
 * main window. Keeps only the signed-in session.
 */
async function resetProfile(): Promise<void> {
  const appDataRoot = resolveDevelopmentAppDataRoot(process.platform, process.env, homedir());
  const profile = profilePath();
  const authPath = join(profile, CENTRAL_AUTH_FILE);
  const session = await readFile(authPath).catch(() => null);
  await seedDevelopmentState({
    appDataRoot,
    instanceId: INSTANCE_ID,
    agentModel: { provider: "claude", model: MODEL, reasoningEffort: "medium" },
    scale: NO_SCALE,
  });
  if (!session) return;
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await writeFile(authPath, session, { mode: 0o600 });
}

async function waitFor<T>(what: string, timeoutMs: number, probe: () => Promise<T | null>, everyMs = 250): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await probe();
      if (value !== null) return value;
    } catch {
      // Not ready yet.
    }
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}.`);
    await wait(everyMs);
  }
}

function isAppWindowUrl(url: string): boolean {
  return url.startsWith("openbot-app://app/index.html") && !url.includes("surface=");
}

async function connect(app: BenchApp): Promise<{ browser: Browser; page: Page }> {
  await waitFor("the CDP port", READY_TIMEOUT_MS, async () => {
    const response = await fetch(`http://127.0.0.1:${app.remoteDebuggingPort}/json/version`);
    return response.ok ? true : null;
  });
  // Playwright does not see a window that opens after it connects, so connect when the window is there.
  await waitFor("the app window target", READY_TIMEOUT_MS, async () => {
    const response = await fetch(`http://127.0.0.1:${app.remoteDebuggingPort}/json/list`);
    const targets: { type?: string; url?: string }[] = await response.json();
    return targets.some((target) => target.type === "page" && isAppWindowUrl(target.url ?? "")) ? true : null;
  });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${app.remoteDebuggingPort}`);
  if (!(await verifyBrowserOwnership(browser, app.pid))) {
    await browser.close();
    throw new Error(`The browser on :${app.remoteDebuggingPort} is not the bench app this run started.`);
  }
  const page = await waitFor("the app window", READY_TIMEOUT_MS, async () => {
    for (const candidate of browser.contexts().flatMap((context) => context.pages())) {
      if (!isAppWindowUrl(candidate.url())) continue;
      if ((await candidate.evaluate("typeof window.openbot").catch(() => "")) === "object") return candidate;
    }
    return null;
  });
  await waitFor("the agent list", READY_TIMEOUT_MS, () =>
    page.evaluate<number>("window.openbot.agent.listAgents().then((agents) => agents.length)"),
  );
  await signInBenchAccount(page, logger);
  return { browser, page };
}

interface Usage {
  turns: number;
  uncachedInput: number;
  cachedInput: number;
  cacheCreation: number;
  output: number;
  costUsd: number;
}

async function readUsage(page: Page, agentId: string): Promise<Usage> {
  const analytics = await page.evaluate<AgentAnalytics | null>(
    `window.openbot.agent.getAnalytics(${json(analyticsRange(agentId, 2))}, "local")`,
  );
  const totals = analytics?.totals;
  return {
    turns: totals?.turns ?? 0,
    uncachedInput: totals?.uncachedInput ?? 0,
    cachedInput: totals?.cachedInput ?? 0,
    cacheCreation: totals?.cacheCreation ?? 0,
    output: totals?.output ?? 0,
    costUsd: totals?.estimatedCostUsd ?? 0,
  };
}

/** True when the agent has no queued or running work and its last message is a finished reply. */
async function agentIdle(page: Page, agentId: string): Promise<boolean> {
  return page.evaluate<boolean>(`(async (agentId) => {
    const queue = await window.openbot.agent.listQueue(agentId);
    if (queue.deliveries.length === 0) return false;
    if (queue.deliveries.some((one) => ["queued", "starting", "running"].includes(one.status))) return false;
    const page = await window.openbot.agent.readConversationPage({ agentId, limit: 1 });
    const last = page.messages[page.messages.length - 1];
    return Boolean(last && last.source !== "user" && last.status !== "streaming");
  })(${json(agentId)})`);
}

interface Reply {
  text: string;
  toolSteps: number;
}

async function readReply(page: Page, agentId: string): Promise<Reply> {
  return page.evaluate<Reply>(`window.openbot.agent
    .readConversationPage({ agentId: ${json(agentId)}, limit: 20 })
    .then((page) => {
      const messages = page.messages;
      let lastUser = -1;
      messages.forEach((message, index) => { if (message.source === "user") lastUser = index; });
      const replies = messages.slice(lastUser + 1).filter((message) => message.source !== "user");
      const toolSteps = replies.reduce(
        (sum, message) => sum + (message.trace?.steps ?? []).filter((step) => step.kind === "tool").length,
        0,
      );
      return { text: replies.map((message) => message.text ?? "").join("\\n"), toolSteps };
    })`);
}

function extractAnswer(text: string): string {
  const lines = [...text.matchAll(/ANSWER:\s*(.+)/gu)];
  return (lines.at(-1)?.[1] ?? "").replaceAll("`", "").trim();
}

async function saveMcpServers(page: Page, cdpUrl: string): Promise<Map<string, string>> {
  const base = {
    transport: "stdio",
    enabled: false,
    env: [{ key: "PATH", value: process.env.PATH ?? "" }],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  };
  const configs = [
    {
      ...base,
      id: "",
      name: PLAYWRIGHT_MCP_NAME,
      command: "npx",
      args: ["--offline", "-y", "@playwright/mcp", `--cdp-endpoint=${cdpUrl}`],
    },
    {
      ...base,
      id: "",
      name: DEVTOOLS_MCP_NAME,
      command: "npx",
      args: ["--offline", "-y", "chrome-devtools-mcp", `--browser-url=${cdpUrl}`],
    },
  ];
  const ids = new Map<string, string>();
  for (const config of configs) {
    const saved = await page.evaluate<{ id: string; name: string }[]>(
      `window.openbot.agent.saveMcpServer(${json({ config })}, "local")`,
    );
    const id = saved.find((server) => server.name === config.name)?.id;
    if (!id) throw new Error(`The ${config.name} MCP server was not saved.`);
    ids.set(config.name, id);
  }
  return ids;
}

async function enableOnly(page: Page, servers: Map<string, string>, name: string | undefined): Promise<void> {
  for (const [serverName, mcpServerId] of servers) {
    await page.evaluate(
      `window.openbot.agent.setMcpServerEnabled(${json({ mcpServerId, enabled: serverName === name })}, "local").then(() => null)`,
    );
  }
}

// --- runs --------------------------------------------------------------------------------------

interface RunRow {
  variant: string;
  task: string;
  repeat: number;
  correct: boolean;
  compliant: boolean;
  answer: string;
  truth: string;
  violations: string[];
  toolCalls: number;
  toolsByFamily: Record<string, number>;
  toolNames: Record<string, number>;
  toolNamesKnown: boolean;
  uncachedInput: number;
  cachedInput: number;
  cacheCreation: number;
  inputTotal: number;
  output: number;
  costUsd: number;
  durationMs: number;
  error?: string;
}

async function runOnce(
  page: Page,
  variant: Variant,
  task: BenchTask,
  repeat: number,
  truth: string,
  cdpUrl: string,
): Promise<RunRow> {
  const marker = `bench-run-${randomUUID()}`;
  const row: RunRow = {
    variant: variant.id,
    task: task.id,
    repeat,
    correct: false,
    compliant: false,
    answer: "",
    truth,
    violations: [],
    toolCalls: 0,
    toolsByFamily: {},
    toolNames: {},
    toolNamesKnown: false,
    uncachedInput: 0,
    cachedInput: 0,
    cacheCreation: 0,
    inputTotal: 0,
    output: 0,
    costUsd: 0,
    durationMs: 0,
  };
  const agent = await page.evaluate<{ id: string }>(
    `window.openbot.agent.createAgent(${json({
      name: `Bench ${variant.id} ${task.id} ${repeat}`,
      description: "Browser tools benchmark agent.",
      avatarSeed: `bench-${variant.id.toLowerCase()}-${repeat}`,
      avatarHue: null,
      initialMessage: "Reply with the word READY and nothing else. Do not use any tools.",
      provider: "claude",
      model: MODEL,
      reasoningEffort: "medium",
    })}, "local")`,
  );
  let tabId: string | null = null;
  try {
    await waitFor(
      "the warm-up turn",
      TURN_TIMEOUT_MS,
      async () => ((await agentIdle(page, agent.id)) ? true : null),
      SECOND,
    );
    // The agent gets its thread with its first turn, and a tool sees only a tab of the agent's thread.
    const threadId = await page.evaluate<string | null>(
      `window.openbot.agent.listAgents().then((agents) => agents.find((one) => one.id === ${json(agent.id)})?.threadId ?? null)`,
    );
    if (threadId === null) throw new Error("The bench agent has no thread after its warm-up turn.");
    const tab = await page.evaluate<{ id: string }>(
      `window.openbot.browser.open(${json({ url: task.startUrl, ownerThreadId: threadId, ownerAgentId: agent.id, focus: false })})`,
    );
    tabId = tab.id;
    await waitFor(
      "the start page",
      60 * SECOND,
      () =>
        page.evaluate<boolean | null>(
          `window.openbot.browser.listTabs().then((tabs) => tabs.find((one) => one.id === ${json(tab.id)})?.loading === false || null)`,
        ),
      500,
    );
    const before = await readUsage(page, agent.id);
    const started = Date.now();
    await page.evaluate(
      `window.openbot.agent.sendMessage(${json({ agentId: agent.id, text: taskPrompt(variant, task, { id: tab.id, url: task.startUrl }, cdpUrl, marker) })}).then(() => null)`,
    );
    // The message is queued first; wait until its turn has started before idle can mean "done".
    await waitFor(
      "the task turn to finish",
      TURN_TIMEOUT_MS,
      async () => {
        const reply = await readReply(page, agent.id);
        if (reply.text === "" && Date.now() - started < 5 * SECOND) return null;
        return (await agentIdle(page, agent.id)) ? true : null;
      },
      2 * SECOND,
    );
    row.durationMs = Date.now() - started;
    const after = await waitFor(
      "the turn's usage",
      30 * SECOND,
      async () => {
        const usage = await readUsage(page, agent.id);
        return usage.turns > before.turns ? usage : null;
      },
      SECOND,
    ).catch(() => readUsage(page, agent.id));
    row.uncachedInput = after.uncachedInput - before.uncachedInput;
    row.cachedInput = after.cachedInput - before.cachedInput;
    row.cacheCreation = after.cacheCreation - before.cacheCreation;
    row.inputTotal = row.uncachedInput + row.cachedInput + row.cacheCreation;
    row.output = after.output - before.output;
    row.costUsd = Math.round((after.costUsd - before.costUsd) * 1e6) / 1e6;
    const reply = await readReply(page, agent.id);
    row.answer = extractAnswer(reply.text);
    row.correct = row.answer !== "" && task.score(row.answer, truth);
    const uses = await readToolUses(marker, started - MINUTE);
    row.toolNamesKnown = uses !== null;
    row.toolCalls = uses?.length ?? reply.toolSteps;
    for (const use of uses ?? []) {
      row.toolsByFamily[use.family] = (row.toolsByFamily[use.family] ?? 0) + 1;
      row.toolNames[use.name] = (row.toolNames[use.name] ?? 0) + 1;
    }
    row.violations = violations(variant, uses ?? []);
    const usedOwnTools = (uses ?? []).some((use) => use.family !== "catalog" && variant.families.includes(use.family));
    row.compliant = uses !== null && row.violations.length === 0 && usedOwnTools;
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (tabId !== null) await page.evaluate(`window.openbot.browser.close(${json(tabId)})`).catch(() => undefined);
    await page.evaluate(`window.openbot.agent.deleteAgent(${json(agent.id)}, "local")`).catch(() => undefined);
  }
  return row;
}

// --- report ------------------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function summarize(rows: RunRow[]) {
  const variants = [...new Set(rows.map((row) => row.variant))];
  return variants.map((variant) => {
    const own = rows.filter((row) => row.variant === variant);
    const sum = (pick: (row: RunRow) => number) => own.reduce((total, row) => total + pick(row), 0);
    return {
      variant,
      description: VARIANTS.find((one) => one.id === variant)?.description ?? variant,
      runs: own.length,
      correct: own.filter((row) => row.correct).length,
      compliant: own.filter((row) => row.compliant).length,
      success: own.filter((row) => row.correct && row.compliant).length,
      errors: own.filter((row) => row.error !== undefined).length,
      medianInputTotal: median(own.map((row) => row.inputTotal)),
      medianUncachedInput: median(own.map((row) => row.uncachedInput)),
      medianOutput: median(own.map((row) => row.output)),
      medianToolCalls: median(own.map((row) => row.toolCalls)),
      medianDurationMs: median(own.map((row) => row.durationMs)),
      medianCostUsd: median(own.map((row) => row.costUsd)),
      totalInput: sum((row) => row.inputTotal),
      totalCostUsd: Math.round(sum((row) => row.costUsd) * 1e4) / 1e4,
    };
  });
}

function markdown(summary: ReturnType<typeof summarize>): string {
  const lines = [
    "| Variant | Runs | Success | Correct | Compliant | Median input | Median uncached | Median output | Median tool calls | Median time (s) | Median cost ($) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of summary) {
    lines.push(
      `| ${row.variant} ${row.description} | ${row.runs} | ${row.success} | ${row.correct} | ${row.compliant} | ${row.medianInputTotal} | ${row.medianUncachedInput} | ${row.medianOutput} | ${row.medianToolCalls} | ${(row.medianDurationMs / SECOND).toFixed(1)} | ${row.medianCostUsd.toFixed(4)} |`,
    );
  }
  return lines.join("\n");
}

// --- command line ------------------------------------------------------------------------------

const USAGE = [
  "Usage: bun run bench:browser-tools [--variants=A,C,S,D,E,F] [--tasks=<n|id,id>] [--repeats=<n>]",
  "",
  "Needs a built app (`bun run build`) and a signed-in Claude CLI. Uses the Claude quota.",
  "D needs `browser-harness` on PATH; E and F need @playwright/mcp and chrome-devtools-mcp in the npx cache.",
  "",
  "Variants:",
  ...VARIANTS.map((variant) => `- ${variant.id}: ${variant.description}`),
  "",
  "Tasks:",
  ...TASKS.map((task) => `- ${task.id}`),
].join("\n");

const OPTIONS = {
  variants: { type: "string" },
  tasks: { type: "string" },
  repeats: { type: "string" },
} as const;

async function stopHarnessDaemon(): Promise<void> {
  try {
    execFileSync("browser-harness", ["--reload"], {
      env: { ...process.env, BH_TMP_DIR: HARNESS_DIR, BH_TELEMETRY: "0" },
      stdio: "ignore",
    });
  } catch (error) {
    logger.warn(`could not stop the Browser Harness daemon in ${HARNESS_DIR}: ${String(error)}`);
    return;
  }
  await rm(HARNESS_DIR, { recursive: true, force: true });
}

function harnessInstalled(): boolean {
  try {
    execFileSync("which", ["browser-harness"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function selectTasks(raw: string | undefined): BenchTask[] {
  if (raw === undefined) return TASKS;
  if (/^\d+$/u.test(raw)) return TASKS.slice(0, Number(raw));
  const wanted = raw.split(",").map((part) => part.trim());
  const selected = TASKS.filter((task) => wanted.includes(task.id));
  if (selected.length === 0) throw new Error(`No task matches "${raw}".`);
  return selected;
}

async function main(): Promise<void> {
  const parsed = readScriptArguments({ usage: USAGE, options: OPTIONS });
  if (parsed === null) return;
  const wantedVariants = (parsed.values.variants ?? VARIANTS.map((variant) => variant.id).join(","))
    .split(",")
    .map((part) => part.trim().toUpperCase());
  let variants = VARIANTS.filter((variant) => wantedVariants.includes(variant.id));
  if (variants.length === 0) throw new Error(`No variant matches "${parsed.values.variants}".`);
  if (variants.some((variant) => variant.id === "D") && !harnessInstalled()) {
    logger.warn("browser-harness is not on PATH, so variant D is skipped. The bench does not install it.");
    variants = variants.filter((variant) => variant.id !== "D");
  }
  const tasks = selectTasks(parsed.values.tasks);
  const repeats = Number(parsed.values.repeats ?? "3");
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error("--repeats must be from 1 to 10.");

  await mkdir(OUTPUT_ROOT, { recursive: true });
  const reportPath = join(OUTPUT_ROOT, "report.json");
  const truths = new Map<string, string>();
  for (const task of tasks) {
    truths.set(task.id, await task.truth());
    logger.info(`truth ${task.id}: ${truths.get(task.id)}`);
  }

  await resetProfile();
  const authApi = await ensureBenchAuthApi(PROJECT_ROOT, OUTPUT_ROOT, logger);
  const app = await launchBenchApp({
    projectRoot: PROJECT_ROOT,
    instanceId: INSTANCE_ID,
    logger,
    environment: { OPENBOT_AUTH_API_URL: authApi.url },
    logPath: join(OUTPUT_ROOT, "app.log"),
  });
  const rows: RunRow[] = [];
  const startedAt = new Date().toISOString();
  const write = async () => {
    const summary = summarize(rows);
    await writeFile(
      reportPath,
      `${JSON.stringify({ startedAt, model: MODEL, repeats, tasks: tasks.map((task) => task.id), summary, rows }, null, 2)}\n`,
    );
    return summary;
  };
  let browser: Browser | null = null;
  try {
    const connected = await connect(app);
    browser = connected.browser;
    const page = connected.page;
    const cdpUrl = `http://127.0.0.1:${app.remoteDebuggingPort}`;
    const servers = await saveMcpServers(page, cdpUrl);
    // Runs interleave the variants, so a slow site or a provider hiccup does not land on one variant.
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      for (const task of tasks) {
        for (const variant of variants) {
          await enableOnly(page, servers, variant.mcp);
          logger.info(`run ${repeat}/${repeats} ${task.id} ${variant.id}`);
          const row = await runOnce(page, variant, task, repeat, truths.get(task.id) ?? "", cdpUrl);
          rows.push(row);
          logger.info(
            `  ${row.correct ? "correct" : "wrong"}${row.compliant ? "" : " (not compliant)"} input ${row.inputTotal} output ${row.output} tools ${row.toolCalls} ${(row.durationMs / SECOND).toFixed(0)} s${row.error ? ` error: ${row.error}` : ""}${row.violations.length > 0 ? ` used: ${row.violations.join(", ")}` : ""}`,
          );
          await write();
        }
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
    if (variants.some((variant) => variant.id === "D")) await stopHarnessDaemon();
    await app.stop();
    await authApi.stop();
  }
  const summary = await write();
  process.stdout.write(`${markdown(summary)}\n`);
  logger.info(`report written to ${reportPath}`);
}

main().catch((error: unknown) => {
  logger.error(toLogValue(error));
  process.exitCode = 1;
});
