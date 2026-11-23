import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  DEFAULT_EXTERNAL_LINK_PREFERENCE,
  decodeExternalLinkTarget,
  type ExternalLinkBrowser,
  type ExternalLinkBrowsers,
  type ExternalLinkFallback,
  type ExternalLinkPreference,
  externalLinkAppName,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Result, Schema } from "effect";
import { PreferenceStore } from "./preference-file";

const logger = createOpenBotLogger("external-links");

export type ExternalLinkPreferenceStore = PreferenceStore<ExternalLinkPreference>;

export function createExternalLinkPreferenceStore(path: string): ExternalLinkPreferenceStore {
  return new PreferenceStore({
    path,
    defaultValue: DEFAULT_EXTERNAL_LINK_PREFERENCE,
    decode: (parsed) => {
      if (!isDynamicRecord(parsed) || parsed.version !== 1) return null;
      const target = decodeExternalLinkTarget(parsed.target);
      return target ? { target } : null;
    },
  });
}

class ExternalLinkFailure extends Schema.TaggedError<ExternalLinkFailure>()("ExternalLinkFailure", {
  cause: Schema.Defect(),
}) {}

export interface ExternalLinkOpenerDependencies {
  preference: ExternalLinkPreferenceStore;
  platform: NodeJS.Platform;
  openDefault: (url: string) => Promise<void>;
  onFallback: (fallback: ExternalLinkFallback) => void;
}

export class ExternalLinkOpener {
  readonly #dependencies: ExternalLinkOpenerDependencies;

  constructor(dependencies: ExternalLinkOpenerDependencies) {
    this.#dependencies = dependencies;
  }

  readonly open = Effect.fn("ExternalLinkOpener.open")(function* (this: ExternalLinkOpener, url: string) {
    const { preference, platform, onFallback } = this.#dependencies;
    const target = preference.get().target;
    const page = webPage(url);
    const openDefault = () => (platform === "linux" && page ? openWithXdg(page) : this.#dependencies.openDefault(url));
    if (target.kind === "app" && page) {
      const launched = yield* Effect.result(launchApp(platform, target.path, page));
      if (Result.isSuccess(launched)) return;
      logger.warn(
        "The chosen browser did not start, so the default browser opens the page.",
        toLogValue(launched.failure.cause),
      );
      yield* Effect.tryPromise({ try: openDefault, catch: (cause) => new ExternalLinkFailure({ cause }) });
      onFallback({ name: externalLinkAppName(platform === "darwin" ? target.path : programOf(target.path)) });
      return;
    }
    yield* Effect.tryPromise({ try: openDefault, catch: (cause) => new ExternalLinkFailure({ cause }) });
  });

  readonly listBrowsers = Effect.fn("ExternalLinkOpener.listBrowsers")(function* (this: ExternalLinkOpener) {
    if (this.#dependencies.platform !== "darwin") return { defaultBrowser: null, browsers: [] };
    const listed = yield* Effect.result(listMacBrowsers());
    if (Result.isSuccess(listed)) return listed.success;
    logger.warn("The list of browsers did not load.", toLogValue(listed.failure.cause));
    return { defaultBrowser: null, browsers: [] };
  });
}

function webPage(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
}

function commandWords(command: string): string[] {
  if (existsSync(command)) return [command];
  return Array.from(command.matchAll(/"([^"]*)"|[^\s"]+/g), (match) => match[1] ?? match[0]);
}

function programOf(command: string): string {
  return commandWords(command)[0] ?? command;
}

const LINUX_START_FAILURE_WAIT_MS = 3_000;

const XDG_OPEN_ENV = { MM_NOTTTY: "1" };

export function openWithXdg(target: string): Promise<void> {
  return startProgram("xdg-open", [target], true, XDG_OPEN_ENV);
}

function startProgram(
  program: string,
  args: string[],
  watchExit: boolean,
  env: Record<string, string> = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, {
      shell: false,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ...env },
    });
    child.once("error", reject);
    child.once("spawn", () => {
      if (!watchExit) {
        child.unref();
        resolve();
        return;
      }
      const stopped = (code: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(running);
        if (code === 0) resolve();
        else reject(new Error(`${program} stopped with ${signal ?? `exit code ${code}`}.`));
      };
      const running = setTimeout(() => {
        child.removeListener("exit", stopped);
        child.unref();
        resolve();
      }, LINUX_START_FAILURE_WAIT_MS);
      child.once("exit", stopped);
    });
  });
}

function launchApp(platform: NodeJS.Platform, path: string, page: string): Effect.Effect<void, ExternalLinkFailure> {
  return Effect.tryPromise({
    try: () => {
      if (platform === "darwin")
        return new Promise<void>((resolve, reject) => {
          execFile("open", ["-a", path, page], (error) => (error ? reject(error) : resolve()));
        });
      const [program = path, ...options] = commandWords(path);
      return startProgram(program, [...options, page], platform === "linux");
    },
    catch: (cause) => new ExternalLinkFailure({ cause }),
  });
}

const MAC_BROWSERS_SCRIPT = `
ObjC.import("AppKit");
const workspace = $.NSWorkspace.sharedWorkspace;
const page = $.NSURL.URLWithString("https://example.com");
const files = $.NSFileManager.defaultManager;
const browser = (url) => ({ name: files.displayNameAtPath(url.path).js, path: url.path.js });
const found = workspace.URLsForApplicationsToOpenURL(page);
const browsers = [];
for (let index = 0; index < found.count; index += 1) browsers.push(browser(found.objectAtIndex(index)));
const current = workspace.URLForApplicationToOpenURL(page);
JSON.stringify({ defaultBrowser: current.isNil() ? null : browser(current), browsers });
`;

function listMacBrowsers(): Effect.Effect<ExternalLinkBrowsers, ExternalLinkFailure> {
  return Effect.tryPromise({
    try: () =>
      new Promise<ExternalLinkBrowsers>((resolve, reject) => {
        execFile("osascript", ["-l", "JavaScript", "-e", MAC_BROWSERS_SCRIPT], { timeout: 10_000 }, (error, stdout) => {
          if (error) return reject(error);
          try {
            resolve(decodeMacBrowsers(JSON.parse(stdout)));
          } catch (cause) {
            reject(cause);
          }
        });
      }),
    catch: (cause) => new ExternalLinkFailure({ cause }),
  });
}

function decodeMacBrowsers(value: unknown): ExternalLinkBrowsers {
  if (!isDynamicRecord(value) || !Array.isArray(value.browsers)) throw new Error("Invalid browser list.");
  const decode = (item: unknown): ExternalLinkBrowser | null =>
    isDynamicRecord(item) && typeof item.name === "string" && typeof item.path === "string"
      ? { name: item.name.replace(/\.app$/, ""), path: item.path }
      : null;
  const bundleEnd = process.execPath.indexOf(".app/");
  const ownBundle = bundleEnd === -1 ? null : process.execPath.slice(0, bundleEnd + 4);
  const installed = (path: string) => !path.startsWith("/Volumes/") && !path.includes("/.") && path !== ownBundle;
  const byName = new Map<string, ExternalLinkBrowser>();
  for (const item of value.browsers) {
    const browser = decode(item);
    if (browser && installed(browser.path) && !byName.has(browser.name)) byName.set(browser.name, browser);
  }
  const browsers = [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
  return { defaultBrowser: decode(value.defaultBrowser), browsers };
}
