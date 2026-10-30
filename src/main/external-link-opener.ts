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

/** The program that opens web pages for the user. Main reads it for each page that it opens. */
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
  /** The operating system's own open, `shell.openExternal`. */
  openDefault: (url: string) => Promise<void>;
  /** Tells the window that the chosen program did not start. */
  onFallback: (fallback: ExternalLinkFallback) => void;
}

/**
 * Opens each web page in the program that the user chose in Settings. An address that is not an
 * http or https page, such as a System Settings pane, always goes to the operating system.
 *
 * The program gets the address as one argument, with no shell, so an address cannot add a command.
 * When the program does not start, the default browser opens the page and the window shows a notice.
 */
export class ExternalLinkOpener {
  readonly #dependencies: ExternalLinkOpenerDependencies;

  constructor(dependencies: ExternalLinkOpenerDependencies) {
    this.#dependencies = dependencies;
  }

  readonly open = Effect.fn("ExternalLinkOpener.open")(function* (this: ExternalLinkOpener, url: string) {
    const { preference, platform, openDefault, onFallback } = this.#dependencies;
    const target = preference.get().target;
    const page = webPage(url);
    if (target.kind === "app" && page) {
      const launched = yield* Effect.result(launchApp(platform, target.path, page));
      if (Result.isSuccess(launched)) return;
      logger.warn(
        "The chosen browser did not start, so the default browser opens the page.",
        toLogValue(launched.failure.cause),
      );
      yield* Effect.tryPromise({ try: () => openDefault(url), catch: (cause) => new ExternalLinkFailure({ cause }) });
      onFallback({ name: externalLinkAppName(platform === "darwin" ? target.path : programOf(target.path)) });
      return;
    }
    yield* Effect.tryPromise({ try: () => openDefault(url), catch: (cause) => new ExternalLinkFailure({ cause }) });
  });

  /** The applications that open web pages. Empty when the system does not tell, as on Linux and Windows. */
  readonly listBrowsers = Effect.fn("ExternalLinkOpener.listBrowsers")(function* (this: ExternalLinkOpener) {
    if (this.#dependencies.platform !== "darwin") return { defaultBrowser: null, browsers: [] };
    const listed = yield* Effect.result(listMacBrowsers());
    if (Result.isSuccess(listed)) return listed.success;
    logger.warn("The list of browsers did not load.", toLogValue(listed.failure.cause));
    return { defaultBrowser: null, browsers: [] };
  });
}

/** The address as an http or https page, or null for any other scheme. */
function webPage(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
}

/**
 * The words of a Linux or Windows command, split at spaces. A value that names a file, such as
 * `C:\Program Files\Mozilla Firefox\firefox.exe`, is one word. Double quotes keep a path with
 * spaces in one word. A backslash is a plain character, as in a Windows path. No shell reads the words.
 */
function commandWords(command: string): string[] {
  if (existsSync(command)) return [command];
  return Array.from(command.matchAll(/"([^"]*)"|[^\s"]+/g), (match) => match[1] ?? match[0]);
}

function programOf(command: string): string {
  return commandWords(command)[0] ?? command;
}

/**
 * The address starts with `http`, so neither `open` nor the program can read it as an option.
 * `open -a` stops with an error when the application is missing. It has no time limit: it waits
 * while macOS asks the user to open a downloaded application. A program on Linux or Windows fails
 * to spawn when it is missing or cannot run.
 */
function launchApp(platform: NodeJS.Platform, path: string, page: string): Effect.Effect<void, ExternalLinkFailure> {
  return Effect.tryPromise({
    try: () =>
      platform === "darwin"
        ? new Promise<void>((resolve, reject) => {
            execFile("open", ["-a", path, page], (error) => (error ? reject(error) : resolve()));
          })
        : new Promise<void>((resolve, reject) => {
            const [program = path, ...options] = commandWords(path);
            const child = spawn(program, [...options, page], { shell: false, detached: true, stdio: "ignore" });
            child.once("error", reject);
            child.once("spawn", () => {
              child.unref();
              resolve();
            });
          }),
    catch: (cause) => new ExternalLinkFailure({ cause }),
  });
}

/**
 * LaunchServices knows each application that opens an https page, and the default one. AppKit
 * gives both lists; `osascript` runs the script with no shell.
 */
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
  // A copy on a mounted disk image or in a hidden tool folder, such as a test Chrome, is not a
  // browser that the user installed. OpenBot itself also opens https pages.
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
