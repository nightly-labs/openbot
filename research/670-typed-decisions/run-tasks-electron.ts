// Runs inside Electron (started by run-tasks.ts). It serves the multi-step task pages, lets one driver operate the
// real BrowserHost tools step by step, and judges each task only from the events the pages report to the server.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { type DynamicRecord, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { app, BrowserWindow } from "electron";
import { BrowserHost } from "../../src/backend/browser-host";
import type { DynamicToolResult } from "../../src/backend/protocol";
import {
  type CallRecord,
  type Decision,
  type Driver,
  type HistoryEntry,
  JevDriver,
  MuseDriver,
  type Observation,
  type ObservedElement,
} from "./task-drivers";

interface EventRule {
  name: string;
  data: Record<string, string>;
  contains: boolean;
}

interface Task {
  id: string;
  start: string;
  goal: string;
  outcome: "done" | "blocked";
  require: EventRule[];
  forbid: EventRule[];
}

interface PageEvent {
  name: string;
  data: DynamicRecord;
  step: number;
}

const DRIVERS = ["jev", "muse-minimal", "muse-low"] as const;
const OUTCOMES = ["done", "blocked"] as const;
const MAX_STEPS = 25;
const STUCK_ACTIONS = 3;
const SCROLL_PIXELS = 560;
const VIEWPORT = { width: 1280, height: 4000 };
const CONTENT_TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript" };
const TEXT_INPUT_ROLES = new Set(["textbox", "searchbox", "spinbutton", "combobox"]);

// Native <select> options are not in the snapshot, so the harness reads them, and the scroll position, from the page.
const PAGE_EXTRAS = `(() => {
  const visible = (element) => element.getClientRects().length > 0;
  const label = (element) =>
    ((element.labels && element.labels[0] && element.labels[0].innerText) || element.getAttribute("aria-label") || element.name || "").trim();
  return {
    selects: [...document.querySelectorAll("select")].filter(visible).map((element) => ({
      label: label(element),
      options: [...element.options].map((option) => option.label.trim()),
    })),
    hasBody: Boolean(document.body),
    scrollY: window.scrollY,
    innerHeight: window.innerHeight,
    scrollHeight: document.documentElement ? document.documentElement.scrollHeight : 0,
  };
})()`;

const root = argumentValue("--root=");
const driverName = argumentValue("--driver=");
const onlyTasks = process.argv.find((argument) => argument.startsWith("--tasks="))?.slice("--tasks=".length);
const tasksRoot = join(root, "fixtures", "tasks");
let toolCall = 0;
let currentStep = 0;
let events: PageEvent[] = [];
let blankReloads = 0;

const server = createServer((request, response) => {
  const path = normalize(new URL(request.url ?? "/", "http://127.0.0.1").pathname).replace(/^\/+/, "");
  if (request.method === "POST" && path === "__event") {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      const parsed = jsonRecord(body);
      if (parsed && isString(parsed.name)) {
        events.push({ name: parsed.name, data: isDynamicRecord(parsed.data) ? parsed.data : {}, step: currentStep });
      }
      response.statusCode = 204;
      response.end();
    });
    return;
  }
  if (path.includes("..") || !CONTENT_TYPES[extname(path)]) {
    response.statusCode = 404;
    response.end();
    return;
  }
  readFile(join(tasksRoot, path)).then(
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
  if (!isOneOf(DRIVERS, driverName)) throw new Error(`--driver must be one of ${DRIVERS.join(", ")}.`);
  const driver: Driver = driverName === "jev" ? new JevDriver() : new MuseDriver(driverName.slice("muse-".length));
  const allTasks = readTasks(JSON.parse(await readFile(join(tasksRoot, "tasks.json"), "utf8")));
  const selected = onlyTasks ? new Set(onlyTasks.split(",")) : null;
  const tasks = allTasks.filter((task) => !selected || selected.has(task.id));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "openbot-research-670-tasks-"));
  app.setName("OpenBot");
  app.setPath("userData", join(temporaryRoot, "user-data"));
  app.setPath("sessionData", join(temporaryRoot, "user-data"));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || isString(address)) throw new Error("Task server did not start.");
  const origin = `http://127.0.0.1:${address.port}`;

  app.on("window-all-closed", () => undefined);
  await app.whenReady();
  const window = new BrowserWindow({ show: false, width: 1280, height: 800 });
  const browser = new BrowserHost(window, join(temporaryRoot, "downloads"), join(temporaryRoot, "browser-tabs.json"));
  await browser.setVisible({ visible: true, bounds: { x: 0, y: 0, width: 1280, height: 800 } });
  const results: DynamicRecord[] = [];
  try {
    for (const task of tasks) {
      const result = await runTask(browser, driver, task, origin);
      results.push(result);
      const status = result.success ? "pass" : "FAIL";
      process.stdout.write(`${driver.name} ${task.id}: ${status} (${result.final}, ${result.steps} steps)\n`);
    }
  } finally {
    await browser.destroy();
    window.destroy();
    server.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  const outRoot = join(root, "results", "tasks");
  await mkdir(outRoot, { recursive: true });
  const name = onlyTasks ? `${driver.name}-partial` : driver.name;
  await writeFile(
    join(outRoot, `${name}.json`),
    `${JSON.stringify({ driver: driver.name, tasks: results }, null, 1)}\n`,
  );
}

async function runTask(browser: BrowserHost, driver: Driver, task: Task, origin: string): Promise<DynamicRecord> {
  events = [];
  currentStep = 0;
  blankReloads = 0;
  const started = performance.now();
  const history: HistoryEntry[] = [];
  const calls: CallRecord[] = [];
  const trace: DynamicRecord[] = [];
  const opened = await tool(browser, "open", { url: `${origin}/${task.start}` });
  const tab = opened.tab;
  if (!isDynamicRecord(tab) || !isString(tab.id)) throw new Error(`Unable to open ${task.start}.`);
  const tabId = tab.id;
  // BrowserHost cannot click an element after it scrolls the page into view in this harness (the page's own
  // elementFromPoint finds it; the CDP hit test does not), so a viewport that holds every task page avoids the scroll.
  await tool(browser, "set_environment", { tabId, preset: "custom", width: VIEWPORT.width, height: VIEWPORT.height });
  let final = "MAX_STEPS";
  let stuck = false;
  let unchanged = 0;
  let harnessError: string | null = null;
  try {
    await settle(browser, tabId);
    for (let step = 1; step <= MAX_STEPS; step += 1) {
      currentStep = step;
      const { observation, loading, refs, revision, fingerprint } = await observe(browser, tabId, origin);
      const { decision, calls: stepCalls } = await driver.decide(task.goal, observation, history);
      calls.push(...stepCalls);
      const element = decision.target
        ? observation.elements.find((entry) => entry.index === decision.target?.split(":")[0])
        : null;
      const entry: HistoryEntry = {
        step,
        operation: decision.operation,
        element: element ? `[${element.index}] ${element.role} "${element.label}"` : null,
        text: decision.text,
        pageChanged: null,
        error: null,
      };
      trace.push({
        step,
        url: observation.url,
        title: observation.title,
        elements: observation.elements.length,
        loading,
        operation: decision.operation,
        target: entry.element,
        option: decision.operation === "SELECT" ? optionLabel(element, decision) : null,
        text: decision.text,
        note: decision.note,
        modelMs: Math.round(stepCalls.reduce((total, call) => total + call.ms, 0)),
      });
      if (decision.operation === "DONE" || decision.operation === "BLOCKED") {
        final = decision.operation;
        break;
      }
      try {
        await act(browser, tabId, decision, element, refs, revision);
      } catch (error) {
        entry.error = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      }
      const after = await observe(browser, tabId, origin);
      entry.pageChanged = after.fingerprint !== fingerprint;
      trace[trace.length - 1].pageChanged = entry.pageChanged;
      trace[trace.length - 1].error = entry.error;
      history.push(entry);
      // jev-ultrafast's rule: an agent that acts three times without changing the page is blocked.
      unchanged = decision.operation === "WAIT" || entry.pageChanged ? 0 : unchanged + 1;
      if (unchanged >= STUCK_ACTIONS) {
        final = "BLOCKED";
        stuck = true;
        break;
      }
    }
  } catch (error) {
    harnessError = error instanceof Error ? error.message : String(error);
    final = "ERROR";
  }
  // Let keepalive event requests from the last action arrive.
  await new Promise((resolve) => setTimeout(resolve, 400));
  await tool(browser, "close_tab", { tabId }).catch(() => undefined);
  const missing = task.require.filter((rule) => !events.some((event) => matches(rule, event)));
  const violations = events.filter((event) => task.forbid.some((rule) => matches(rule, event)));
  const goalMet = missing.length === 0;
  const expected = task.outcome === "done" ? "DONE" : "BLOCKED";
  const success = final === expected && goalMet && violations.length === 0;
  return {
    id: task.id,
    expected,
    final,
    stuck,
    success,
    goalMet,
    falseDone: final === "DONE" && (!goalMet || task.outcome === "blocked"),
    violations: violations.map((event) => ({ name: event.name, data: event.data, step: event.step })),
    missing: missing.map((rule) => rule.name),
    steps: history.length + (final === "DONE" || final === "BLOCKED" ? 1 : 0),
    actions: history.length,
    wallMs: Math.round(performance.now() - started),
    modelMs: Math.round(calls.reduce((total, call) => total + call.ms, 0)),
    calls,
    events,
    harnessError,
    blankReloads,
    trace,
  };
}

interface Observed {
  observation: Observation;
  loading: boolean;
  blank: boolean;
  refs: Map<string, string>;
  revision: number;
  fingerprint: string;
}

// A page that is still navigating cannot be read; wait for it and try again.
// A click whose page navigates after the click returns fails, and BrowserHost then stops the new page while it
// loads (browser-host.ts, the drain after an action), which leaves a blank document. The harness reloads such a
// page once and counts it, so the drivers are compared on the same pages.
async function observe(browser: BrowserHost, tabId: string, origin: string): Promise<Observed> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const observed = await readPage(browser, tabId, origin);
      if (!observed.blank || attempt === 3) return observed;
      blankReloads += 1;
      await tool(browser, "navigate", { tabId, direction: "reload" });
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300));
      await settle(browser, tabId).catch(() => undefined);
    }
  }
}

// Read the page extras first: a ref target needs the revision of the latest snapshot.
async function readPage(browser: BrowserHost, tabId: string, origin: string): Promise<Observed> {
  const extras = await tool(browser, "evaluate", { tabId, expression: PAGE_EXTRAS });
  const snapshot = await tool(browser, "snapshot", { tabId, image: "never" });
  const revision = snapshot.revision;
  if (!isNumber(revision)) throw new Error("Snapshot has no revision.");
  const selects = (Array.isArray(extras.selects) ? extras.selects.filter(isDynamicRecord) : []).map((entry) => ({
    label: clean(entry.label),
    options: Array.isArray(entry.options) ? entry.options.filter(isString) : [],
    used: false,
  }));
  const refs = new Map<string, string>();
  const elements: ObservedElement[] = [];
  const snapshotElements = Array.isArray(snapshot.elements) ? snapshot.elements.filter(isDynamicRecord) : [];
  for (const raw of snapshotElements) {
    if (!isString(raw.ref)) continue;
    const index = String(elements.length + 1);
    const role = isString(raw.role) ? raw.role : "";
    const label = clean(raw.name) || clean(raw.description);
    const states: Record<string, string> = {};
    for (const state of Array.isArray(raw.states) ? raw.states.filter(isString) : []) {
      const [key, value] = state.split(":");
      states[key] = value ?? "true";
    }
    let options: string[] = [];
    const operations: ObservedElement["operations"] = [];
    if (raw.disabled === true) {
      states.disabled = "true";
    } else if (raw.tag === "select") {
      const match =
        selects.find((entry) => !entry.used && entry.label.toLowerCase() === label.toLowerCase()) ??
        selects.find((entry) => !entry.used);
      if (match) {
        match.used = true;
        options = match.options;
        operations.push("SELECT");
      }
    } else {
      operations.push("CLICK");
      if (TEXT_INPUT_ROLES.has(role) || raw.tag === "textarea") operations.push("TYPE_TEXT");
    }
    refs.set(index, raw.ref);
    elements.push({
      index,
      ref: raw.ref,
      role,
      label,
      value: raw.value == null ? "" : String(raw.value),
      states,
      operations,
      options,
    });
  }
  const scrollY = isNumber(extras.scrollY) ? extras.scrollY : 0;
  const innerHeight = isNumber(extras.innerHeight) ? extras.innerHeight : 0;
  const scrollHeight = isNumber(extras.scrollHeight) ? extras.scrollHeight : 0;
  const observation: Observation = {
    url: String(snapshot.url ?? "").replace(origin, "https://tasks.test"),
    title: String(snapshot.title ?? ""),
    text: String(snapshot.text ?? ""),
    elements,
    canScrollUp: scrollY > 0,
    canScrollDown: scrollY + innerHeight < scrollHeight - 4,
  };
  const fingerprint = JSON.stringify([
    observation.url,
    observation.text,
    elements.map((element) => [element.role, element.label, element.value, element.states]),
    scrollY,
  ]);
  const loading = snapshot.loading === true;
  return { observation, loading, blank: extras.hasBody === false && !loading, refs, revision, fingerprint };
}

async function act(
  browser: BrowserHost,
  tabId: string,
  decision: Decision,
  element: ObservedElement | null | undefined,
  refs: Map<string, string>,
  revision: number,
): Promise<void> {
  const ref = element ? refs.get(element.index) : undefined;
  const target = ref ? { kind: "ref", ref, revision } : undefined;
  switch (decision.operation) {
    case "CLICK":
      await tool(browser, "click", { tabId, target });
      break;
    case "TYPE_TEXT":
      await tool(browser, "type", { tabId, target, text: decision.text ?? "", mode: "replace" });
      break;
    case "SELECT":
      await tool(browser, "select_option", { tabId, target, values: [optionLabel(element, decision) ?? ""] });
      break;
    case "SCROLL_UP":
    case "SCROLL_DOWN":
      await tool(browser, "scroll", {
        tabId,
        deltaY: decision.operation === "SCROLL_UP" ? -SCROLL_PIXELS : SCROLL_PIXELS,
      });
      break;
    case "WAIT":
      await new Promise((resolve) => setTimeout(resolve, 800));
      break;
    default:
      return;
  }
  await settle(browser, tabId);
}

async function settle(browser: BrowserHost, tabId: string): Promise<void> {
  await tool(browser, "wait_for", { tabId, state: "dom-quiet" });
}

function optionLabel(element: ObservedElement | null | undefined, decision: Decision): string | null {
  const position = Number(decision.target?.split(":")[1]);
  return element?.options[position - 1] ?? null;
}

function matches(rule: EventRule, event: PageEvent): boolean {
  const name = rule.name.endsWith("*") ? event.name.startsWith(rule.name.slice(0, -1)) : event.name === rule.name;
  if (!name) return false;
  return Object.entries(rule.data).every(([key, expected]) => {
    const actual = String(event.data[key] ?? "").toLowerCase();
    return rule.contains ? actual.includes(expected.toLowerCase()) : actual === expected.toLowerCase();
  });
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
  const payload = jsonRecord(text);
  if (!payload) throw new Error(`${name} returned no JSON object.`);
  return payload;
}

function readTasks(value: unknown): Task[] {
  const list = isDynamicRecord(value) && Array.isArray(value.tasks) ? value.tasks : value;
  if (!Array.isArray(list)) throw new Error("tasks.json: expected a list of tasks.");
  return list.filter(isDynamicRecord).map((entry) => {
    if (!isOneOf(OUTCOMES, entry.outcome)) throw new Error(`tasks.json: bad outcome for ${String(entry.id)}.`);
    return {
      id: requiredString(entry.id),
      start: requiredString(entry.start),
      goal: requiredString(entry.goal),
      outcome: entry.outcome,
      require: rules(entry.require),
      forbid: rules(entry.forbid),
    };
  });
}

function rules(value: unknown): EventRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("tasks.json: expected a list of event rules.");
  return value.map((rule) => {
    if (isString(rule)) return { name: rule, data: {}, contains: false };
    if (!isDynamicRecord(rule)) throw new Error("tasks.json: bad event rule.");
    const data = isDynamicRecord(rule.data) ? rule.data : {};
    return {
      name: requiredString(rule.name),
      data: Object.fromEntries(Object.entries(data).map(([key, expected]) => [key, String(expected)])),
      contains: rule.contains === true,
    };
  });
}

function requiredString(value: unknown): string {
  if (!isString(value)) throw new Error(`tasks.json: expected a string, got ${String(value)}.`);
  return value;
}

function clean(value: unknown): string {
  return isString(value) ? value.replace(/\s+/g, " ").trim() : "";
}

function jsonRecord(text: string): DynamicRecord | null {
  try {
    const parsed = JSON.parse(text);
    return isDynamicRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function argumentValue(prefix: string): string {
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`Missing ${prefix}`);
  return value;
}

main().then(
  () => process.stdout.write("", () => app.exit(0)),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`, () => app.exit(1));
  },
);
