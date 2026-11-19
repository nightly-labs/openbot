import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import type { Logger } from "@openbot/logging";
import { type Browser, chromium, type Page } from "playwright-core";
import { PROCESS_TABLE_PS_ARGS, parseProcessTable } from "./cpu-sampling";
import { describeTarget, findMainPages } from "./page-url";

export const DEFAULT_DEV_AUTOMATION_PORT = 9_333;
export const MIN_DEV_AUTOMATION_PORT = 1_024;
export const MAX_DEV_AUTOMATION_PORT = 65_535;

export class ForeignBrowserError extends Error {}

export interface ResolvedAutomationPort {
  port: number;
  explicit: boolean;
}

export function resolveAutomationPort(
  flag: string | undefined,
  environment: string | undefined,
): ResolvedAutomationPort {
  const source = flag ?? environment;
  if (source === undefined || source.trim() === "") {
    return { port: DEFAULT_DEV_AUTOMATION_PORT, explicit: false };
  }
  const port = Number(source);
  if (!Number.isInteger(port) || port < MIN_DEV_AUTOMATION_PORT || port > MAX_DEV_AUTOMATION_PORT) {
    throw new Error(
      `OPENBOT_DEV_REMOTE_DEBUGGING_PORT must be an integer from ${MIN_DEV_AUTOMATION_PORT} to ${MAX_DEV_AUTOMATION_PORT}.`,
    );
  }
  return { port, explicit: true };
}

export interface MutationGate {
  command: string;
  allowMutations: boolean;
  instanceNamed: boolean;
  target?: string;
}

export function assertMutationAllowed(gate: MutationGate): void {
  if (!gate.allowMutations) {
    throw new Error(
      `${gate.command} changes the live dev app. Re-run with --allow-mutations. ` +
        "Snapshots and screenshots stay available without it.",
    );
  }
  if (!gate.instanceNamed) {
    throw new Error(
      `${gate.command} changes the live dev app, and the instance was inferred${
        gate.target ? ` (${gate.target})` : ""
      }, not named. Run \`bun run dev:automation instances\` and re-run with ` +
        "--instance=<id> or --port=<OPENBOT_DEV_REMOTE_DEBUGGING_PORT>.",
    );
  }
}

export interface AutomationSession {
  browser: Browser;
  page: Page;
  close: () => Promise<void>;
}

export function findBrowserProcessId(processInfo: unknown): number | null {
  if (!Array.isArray(processInfo)) return null;
  for (const entry of processInfo) {
    if (!isDynamicRecord(entry) || entry.type !== "browser") continue;
    if (isNumber(entry.id) && Number.isInteger(entry.id) && entry.id > 0) return entry.id;
  }
  return null;
}

export function processBelongsToInstance(
  pid: number,
  ownerPid: number,
  parentByPid: ReadonlyMap<number, number>,
): boolean {
  let current: number | undefined = pid;
  const seen = new Set<number>();
  while (current !== undefined && !seen.has(current)) {
    if (current === ownerPid) return true;
    seen.add(current);
    current = parentByPid.get(current);
  }
  return false;
}

const runCommand = promisify(execFile);

async function readParentProcessTable(): Promise<ReadonlyMap<number, number>> {
  if (process.platform === "win32") {
    const { stdout } = await runCommand(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
      ],
      { timeout: 10_000, maxBuffer: 16 * 1_024 * 1_024 },
    );
    const table = new Map<number, number>();
    for (const line of stdout.split("\n")) {
      const match = /^(\d+)\s+(\d+)\s*$/u.exec(line.trim());
      if (match) table.set(Number(match[1]), Number(match[2]));
    }
    return table;
  }
  const { stdout } = await runCommand("ps", [...PROCESS_TABLE_PS_ARGS], {
    timeout: 10_000,
    maxBuffer: 16 * 1_024 * 1_024,
  });
  const table = new Map<number, number>();
  for (const row of parseProcessTable(stdout)) table.set(row.pid, row.ppid);
  return table;
}

interface BrowserOwnershipProbe {
  newBrowserCDPSession(): Promise<{
    send(method: "SystemInfo.getProcessInfo"): Promise<{ processInfo: Array<{ type: string; id: number }> }>;
    detach(): Promise<void>;
  }>;
}

export async function verifyBrowserOwnership(browser: BrowserOwnershipProbe, ownerPid: number): Promise<boolean> {
  let browserPid: number | null = null;
  try {
    const session = await browser.newBrowserCDPSession();
    try {
      const { processInfo } = await session.send("SystemInfo.getProcessInfo");
      browserPid = findBrowserProcessId(processInfo);
    } finally {
      await session.detach().catch(() => undefined);
    }
  } catch {
    return false;
  }
  if (browserPid === null || browserPid === ownerPid) return browserPid !== null;
  try {
    return processBelongsToInstance(browserPid, ownerPid, await readParentProcessTable());
  } catch {
    return false;
  }
}

export interface RendererCandidate {
  url: () => string;
  evaluate: (probe: string) => Promise<unknown>;
}

const BRIDGE_PROBE = "typeof window.openbot";

export async function findRendererPages<T extends RendererCandidate>(
  pages: T[],
  expectedRendererPort: number | null = null,
): Promise<T[]> {
  const confirmed: T[] = [];
  for (const candidate of findMainPages(pages, expectedRendererPort)) {
    try {
      if ((await candidate.evaluate(BRIDGE_PROBE)) === "object") confirmed.push(candidate);
    } catch {}
  }
  return confirmed;
}

async function describeBrowser(port: number): Promise<{ targets: string; electron: boolean }> {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!version.ok) throw new Error(`CDP answered ${version.status}.`);
  const info = await version.json();
  const userAgent = isDynamicRecord(info) && isString(info["User-Agent"]) ? info["User-Agent"] : "";
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`CDP answered ${response.status}.`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("CDP answered without a target list.");
  const targets = payload
    .filter(isDynamicRecord)
    .filter((target) => target.type === "page")
    .map((target) => `- ${describeTarget(isString(target.url) ? target.url : "")}`)
    .join("\n");
  return { targets, electron: userAgent.includes("Electron/") };
}

export interface ConnectOptions {
  expectedRendererPort?: number | null;
  pageSelector?: string | null;
  ownerPid?: number | null | undefined;
}

export interface PageChoice {
  targetId: string;
  target: string;
}

export type TargetIdReader<T> = (page: T) => Promise<string>;

export async function readTargetId(page: Page): Promise<string> {
  const session = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await session.send("Target.getTargetInfo");
    return targetInfo.targetId;
  } finally {
    await session.detach();
  }
}

export async function describeDevPages<T extends { url: () => string }>(
  pages: T[],
  readId: TargetIdReader<T>,
): Promise<PageChoice[]> {
  const choices: PageChoice[] = [];
  for (const page of pages) {
    choices.push({ targetId: await readId(page), target: describeTarget(page.url()) });
  }
  return choices;
}

export async function matchPages<T extends { url: () => string }>(
  pages: T[],
  selector: string,
  readId: TargetIdReader<T>,
): Promise<T[]> {
  const needle = selector.trim().toLowerCase();
  for (const page of pages) {
    let id = "";
    try {
      id = await readId(page);
    } catch {
      continue;
    }
    if (id !== "" && id.toLowerCase() === needle) return [page];
  }
  return pages.filter((page) => page.url().toLowerCase().includes(needle));
}

export interface OpenDevBrowserOptions {
  ownerPid?: number | null | undefined;
}

export async function openDevBrowser(
  port: number,
  logger: Logger,
  options: OpenDevBrowserOptions = {},
): Promise<Browser> {
  let described: { targets: string; electron: boolean };
  try {
    described = await describeBrowser(port);
  } catch (error) {
    if (error instanceof ForeignBrowserError) throw error;
    throw new Error(
      `No dev app answers on 127.0.0.1:${port}. Reuse the running instance (` +
        "`bun run dev`) instead of starting a second one; " +
        "it owns the API, the seed and the dev profile.",
    );
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  if (!described.electron || (await findRendererPages(devBrowserPages(browser))).length === 0) {
    const ownerPid = options.ownerPid ?? null;
    if (ownerPid === null || !(await verifyBrowserOwnership(browser, ownerPid))) {
      await browser.close();
      throw new ForeignBrowserError(
        `Port ${port} does not belong to OpenBot. Pass --port=<OPENBOT_DEV_REMOTE_DEBUGGING_PORT> of the instance you mean to drive.`,
      );
    }
    logger.info(`Port :${port} belongs to the recorded instance process.`);
  }
  const targets = described.targets;
  logger.info(`CDP targets on :${port}`, targets || "(no pages yet)");
  return browser;
}

export function devBrowserPages(browser: Browser): Page[] {
  return browser.contexts().flatMap((context) => context.pages());
}

export async function connectToDevApp(
  port: number,
  logger: Logger,
  options: ConnectOptions = {},
): Promise<AutomationSession> {
  const browser = await openDevBrowser(port, logger, { ownerPid: options.ownerPid });
  const expectedRendererPort = options.expectedRendererPort ?? null;
  const selector = options.pageSelector ?? null;
  const pages = devBrowserPages(browser);
  const [page, ...ambiguous] =
    selector === null
      ? await findRendererPages(pages, expectedRendererPort)
      : await matchPages(pages, selector, readTargetId);
  if (!page) {
    await browser.close();
    if (selector !== null) {
      throw new Error(
        `No page on :${port} matches --page=${selector}. Run \`bun run dev:automation pages\` ` +
          "for the current targets and their ids.",
      );
    }
    throw new Error(
      `Connected over CDP but found no OpenBot main window on :${port}` +
        (expectedRendererPort === null ? ". " : ` serving renderer :${expectedRendererPort}. `) +
        (expectedRendererPort === null
          ? "Open the app window, or aim at another target with --page=<target-id|url-substring> " +
            "from `bun run dev:automation pages`."
          : "That port now belongs to a different dev instance. Re-run `bun run dev:automation instances` " +
            "and name the instance you mean."),
    );
  }
  if (ambiguous.length > 0) {
    const choices = await describeDevPages(pages, readTargetId);
    await browser.close();
    throw new Error(
      `Found ${ambiguous.length + 1} matching pages on :${port}, so the target is ambiguous. ` +
        "Narrow it with --page=<target-id|url-substring>, or name the instance with its own --port=. " +
        `Targets on :${port}:\n${choices.map((choice) => `- ${choice.targetId}: ${choice.target}`).join("\n")}`,
    );
  }
  logger.info(`driving ${describeTarget(page.url())}`);
  await Promise.all(pages.map((attached) => attached.emulateMedia({ colorScheme: null })));
  page.on("console", (message) => {
    logger.debug(`renderer console [${message.type()}]`, message.text());
  });
  page.on("pageerror", (error) => {
    logger.warn("renderer pageerror", error instanceof Error ? error.message : String(error));
  });
  return {
    browser,
    page,
    close: () => browser.close(),
  };
}
