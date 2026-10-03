// Runs inside Electron (started by capture-snapshots.ts). It serves the fixture pages, drives them with
// the real BrowserHost tool boundary, and writes the snapshots an agent would receive.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { type DynamicRecord, isBoolean, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { app, BrowserWindow } from "electron";
import { BrowserHost } from "../../src/backend/browser-host";
import type { DynamicToolResult } from "../../src/backend/protocol";

interface ElementCase {
  page: string;
  role?: string;
  name?: string;
}

interface ActionStep {
  tool: (typeof ACTION_TOOLS)[number];
  role: string;
  name: string;
  text?: string;
  submit?: boolean;
  checked?: boolean;
}

interface ActionCase {
  id: string;
  page: string;
  query?: string;
  steps: ActionStep[];
}

interface Cases {
  pageState: ElementCase[];
  riskyAction: ElementCase[];
  shortlist: ElementCase[];
  actionSuccess: ActionCase[];
}

const ACTION_TOOLS = ["type", "click", "set_checked"] as const;
const FIXTURE_ORIGIN = "https://fixtures.test";
const CONTENT_TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript" };

const root = argumentValue("--root=");
const pagesRoot = join(root, "fixtures", "pages");
const outRoot = join(root, "snapshots");
let toolCall = 0;

const server = createServer((request, response) => {
  const path = normalize(new URL(request.url ?? "/", "http://127.0.0.1").pathname).replace(/^\/+/, "");
  if (path.includes("..") || !CONTENT_TYPES[extname(path)]) {
    response.statusCode = 404;
    response.end();
    return;
  }
  readFile(join(pagesRoot, path)).then(
    (body) => {
      response.setHeader("content-type", CONTENT_TYPES[extname(path)]);
      response.end(body);
    },
    () => {
      response.statusCode = 404;
      response.end();
    },
  );
});

async function main(): Promise<void> {
  const cases = readCases(JSON.parse(await readFile(join(root, "fixtures", "cases.json"), "utf8")));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "openbot-research-670-"));
  app.setName("OpenBot");
  app.setPath("userData", join(temporaryRoot, "user-data"));
  app.setPath("sessionData", join(temporaryRoot, "user-data"));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || isString(address)) throw new Error("Fixture server did not start.");
  const origin = `http://127.0.0.1:${address.port}`;

  // Closing the last window would otherwise quit before the fixture check below runs.
  app.on("window-all-closed", () => undefined);
  await app.whenReady();
  const window = new BrowserWindow({ show: false, width: 1280, height: 800 });
  const browser = new BrowserHost(window, join(temporaryRoot, "downloads"), join(temporaryRoot, "browser-tabs.json"));
  await browser.setVisible({ visible: true, bounds: { x: 0, y: 0, width: 1280, height: 800 } });
  const failures: string[] = [];
  try {
    await mkdir(join(outRoot, "pages"), { recursive: true });
    await mkdir(join(outRoot, "actions"), { recursive: true });
    const elementCases = [...cases.pageState, ...cases.riskyAction, ...cases.shortlist];
    for (const page of new Set(elementCases.map((entry) => entry.page))) {
      const tabId = await openTab(browser, `${origin}/${page}.html`);
      const snapshot = clean(await tool(browser, "snapshot", { tabId, image: "never" }), origin);
      await tool(browser, "close_tab", { tabId });
      for (const entry of elementCases.filter((candidate) => candidate.page === page && candidate.role)) {
        if (!hasElement(snapshot, entry.role ?? "", entry.name ?? "")) {
          failures.push(`${page}: no ${entry.role} named ${JSON.stringify(entry.name)}`);
        }
      }
      await writeJson(join(outRoot, "pages", `${page}.json`), snapshot);
    }
    for (const entry of cases.actionSuccess) {
      const query = entry.query ? `?${entry.query}` : "";
      const tabId = await openTab(browser, `${origin}/${entry.page}.html${query}`);
      const before = clean(await tool(browser, "snapshot", { tabId, image: "never" }), origin);
      let after = before;
      for (const step of entry.steps) {
        const target = { kind: "role", role: step.role, name: step.name, exact: true };
        const args: DynamicRecord = { tabId, target };
        if (step.tool === "type") Object.assign(args, { text: step.text ?? "", submit: step.submit ?? false });
        if (step.tool === "set_checked") args.checked = step.checked ?? true;
        after = clean(await tool(browser, step.tool, args), origin);
      }
      await tool(browser, "close_tab", { tabId });
      await writeJson(join(outRoot, "actions", `${entry.id}.json`), { before, after, steps: entry.steps });
    }
  } finally {
    await browser.destroy();
    window.destroy();
    server.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  if (failures.length > 0) throw new Error(`Fixture targets are missing:\n${failures.join("\n")}`);
  process.stdout.write("Captured every fixture snapshot.\n");
}

async function openTab(browser: BrowserHost, url: string): Promise<string> {
  const opened = await tool(browser, "open", { url });
  const tab = opened.tab;
  if (!isDynamicRecord(tab) || !isString(tab.id)) throw new Error(`Unable to open ${url}.`);
  await tool(browser, "wait_for", { tabId: tab.id, state: "dom-quiet" });
  return tab.id;
}

async function tool(browser: BrowserHost, name: string, args: DynamicRecord): Promise<DynamicRecord> {
  toolCall += 1;
  const result: DynamicToolResult = await browser.handleDynamicTool({
    threadId: "research-670",
    turnId: `turn-${toolCall}`,
    callId: `call-${toolCall}`,
    ownerAgentId: "research-agent",
    namespace: "openbot_browser",
    tool: name,
    arguments: args,
  });
  const item = result.contentItems.find((candidate) => candidate.type === "inputText");
  const text = item?.type === "inputText" ? item.text : "";
  if (!result.success) throw new Error(`${name} failed: ${text}`);
  const payload = JSON.parse(text);
  if (!isDynamicRecord(payload)) throw new Error(`${name} returned no JSON object.`);
  return payload;
}

// Keep what the agent reads; drop values that change on every run (tab ids, refs, ports, timings).
function clean(snapshot: DynamicRecord, origin: string): DynamicRecord {
  const replaceOrigin = (value: unknown): string => String(value ?? "").replaceAll(origin, FIXTURE_ORIGIN);
  const elements = Array.isArray(snapshot.elements) ? snapshot.elements.filter(isDynamicRecord) : [];
  return {
    title: snapshot.title,
    url: replaceOrigin(snapshot.url),
    loading: snapshot.loading,
    text: replaceOrigin(snapshot.text),
    elements: elements.map(({ ref: _ref, ...element }) => element),
    focus: isDynamicRecord(snapshot.focus) ? { role: snapshot.focus.role, name: snapshot.focus.name } : null,
  };
}

function readCases(value: unknown): Cases {
  if (!isDynamicRecord(value)) throw new Error("cases.json is not an object.");
  return {
    pageState: records(value.pageState).map(readElementCase),
    riskyAction: records(value.riskyAction).map(readElementCase),
    shortlist: records(value.shortlist).map(readElementCase),
    actionSuccess: records(value.actionSuccess).map((entry) => ({
      id: requiredString(entry.id),
      page: requiredString(entry.page),
      query: isString(entry.query) ? entry.query : undefined,
      steps: records(entry.steps).map(readStep),
    })),
  };
}

function readElementCase(entry: DynamicRecord): ElementCase {
  return {
    page: requiredString(entry.page),
    role: isString(entry.role) ? entry.role : undefined,
    name: isString(entry.name) ? entry.name : undefined,
  };
}

function readStep(step: DynamicRecord): ActionStep {
  if (!isOneOf(ACTION_TOOLS, step.tool)) throw new Error(`Unknown action tool ${String(step.tool)}.`);
  return {
    tool: step.tool,
    role: requiredString(step.role),
    name: requiredString(step.name),
    text: isString(step.text) ? step.text : undefined,
    submit: isBoolean(step.submit) ? step.submit : undefined,
    checked: isBoolean(step.checked) ? step.checked : undefined,
  };
}

function records(value: unknown): DynamicRecord[] {
  if (!Array.isArray(value)) throw new Error("cases.json: expected a list.");
  return value.filter(isDynamicRecord);
}

function requiredString(value: unknown): string {
  if (!isString(value)) throw new Error(`cases.json: expected a string, got ${String(value)}.`);
  return value;
}

function hasElement(snapshot: DynamicRecord, role: string, name: string): boolean {
  const elements = Array.isArray(snapshot.elements) ? snapshot.elements.filter(isDynamicRecord) : [];
  return elements.some((element) => element.role === role && String(element.name).trim() === name);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function argumentValue(prefix: string): string {
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`Missing ${prefix}`);
  return value;
}

// On macOS a pipe write is asynchronous, so exit only after the last line is flushed.
main().then(
  () => process.stdout.write("", () => app.exit(0)),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`, () => app.exit(1));
  },
);
