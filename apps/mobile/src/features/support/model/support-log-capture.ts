import * as Application from "expo-application";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import * as Updates from "expo-updates";
import { AppState } from "react-native";
import {
  formatSupportLogEntry,
  parseSupportLog,
  parseSupportLogCache,
  SUPPORT_LOG_CACHE_LINES,
  type SupportLogLevel,
  supportLog,
  supportLogCacheLines,
  supportLogCacheText,
  supportLogValue,
  withRequestLog,
} from "./support-log";

const CACHE_FILE = "support-log-v2.jsonl";
/** The cache file of earlier versions: the whole log as one JSON array. It is read once, then deleted. */
const LEGACY_CACHE_FILE = "support-log-v1.json";
// A write blocks the JavaScript thread. A move to the background and a fatal error write at once, so
// a longer wait loses only the entries of a native crash.
const PERSIST_DELAY_MS = 10_000;
let installed = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
// The file holds the earlier launch until its entries are in the log, so no write may replace it first.
let restored = false;
/** The next write replaces the file: there is none, its key is old, or its last line can be damaged. */
let rewrite = true;
/** The entry lines in the cache file. */
let cacheLines = 0;

/**
 * The key of the redaction that this JavaScript bundle runs. An app build and an over-the-air update
 * can both change the rules, so the key names both. A development bundle changes without either, so
 * it has no key and always redacts restored entries again.
 */
function redactionKey(): string | null {
  if (__DEV__) return null;
  return `${appVersion()} ${Updates.updateId ?? "embedded"}`;
}

function cacheFile(): File {
  return new File(Paths.cache, CACHE_FILE);
}

function legacyCacheFile(): File {
  return new File(Paths.cache, LEGACY_CACHE_FILE);
}

/** Puts the earlier launch in the log. With no version 2 file, the version 1 file is read once. */
function restoreText(cache: string | null, legacy: string | null): void {
  if (cache !== null) {
    const parsed = parseSupportLogCache(cache, redactionKey());
    cacheLines = parsed.lines;
    rewrite = parsed.rewrite;
    supportLog.restore(parsed.entries);
  } else if (legacy !== null) {
    // The next write makes the version 2 file and deletes this one.
    supportLog.restore(parseSupportLog(legacy));
  }
}

/** Reads the earlier launch at once. A move to the background or an error can come before the idle read. */
function restoreNow(): void {
  if (restored) return;
  restored = true;
  try {
    const file = cacheFile();
    if (file.exists) restoreText(file.textSync(), null);
    else {
      const legacy = legacyCacheFile();
      if (legacy.exists) restoreText(null, legacy.textSync());
    }
  } catch {
    // A cache file that cannot be read starts a new log.
  }
}

/** Reads the earlier launch after the first screen, so the parse and the redaction do not delay it. */
function restoreWhenIdle(): void {
  requestIdleCallback(() => {
    if (restored) return;
    let text: Promise<[string | null, string | null]>;
    try {
      const file = cacheFile();
      const legacy = legacyCacheFile();
      text = file.exists
        ? file.text().then((value): [string, null] => [value, null])
        : legacy.exists
          ? legacy.text().then((value): [null, string] => [null, value])
          : Promise.resolve<[null, null]>([null, null]);
    } catch {
      restored = true;
      return;
    }
    void text.then(
      ([cache, legacy]) => {
        if (restored) return;
        restored = true;
        restoreText(cache, legacy);
      },
      () => {
        restored = true;
      },
    );
  });
}

/**
 * Appends the entries that are not in the file yet. The file is written again with only the kept
 * entries when `rewrite` is set, or when it has more lines than the log keeps by half.
 */
function persist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = null;
  restoreNow();
  try {
    const file = cacheFile();
    const unsaved = supportLog.unsaved();
    if (rewrite || !file.exists || cacheLines + unsaved.length > SUPPORT_LOG_CACHE_LINES) {
      const entries = supportLog.entries();
      file.writeSync(supportLogCacheText(redactionKey(), entries));
      cacheLines = entries.length;
      rewrite = false;
      const legacy = legacyCacheFile();
      if (legacy.exists) legacy.delete();
    } else if (unsaved.length > 0) {
      file.writeSync(supportLogCacheLines(unsaved), { append: true });
      cacheLines += unsaved.length;
    }
    supportLog.markSaved();
  } catch {
    // The log on the screen and the saved file still work without the cache copy. A failed write
    // can leave part of a line, so the next write replaces the file.
    rewrite = true;
  }
}

function schedulePersist(): void {
  persistTimer ??= setTimeout(persist, PERSIST_DELAY_MS);
}

function appVersion(): string {
  const version = Application.nativeApplicationVersion ?? "development";
  return Application.nativeBuildVersion ? `${version} (${Application.nativeBuildVersion})` : version;
}

/**
 * The JavaScript bundle that runs, such as `embedded, channel production, runtime 5d8a2bf4...`. An
 * over-the-air update shows its ID in place of `embedded`. Support needs it: two phones with the same
 * app version and build can run different bundles.
 */
function bundleName(): string {
  if (!Updates.isEnabled) return "no update server";
  const bundle = Updates.isEmbeddedLaunch ? "embedded" : (Updates.updateId ?? "unknown");
  return `${bundle}, channel ${Updates.channel ?? "none"}, runtime ${Updates.runtimeVersion ?? "none"}`;
}

/** Such as `iOS 27.0, iPhone 16 Plus (iPhone17,4)`. The identifier names the exact hardware. */
function systemName(): string {
  const { modelName, modelId } = Device;
  const model =
    modelName && modelId && modelName !== modelId ? `${modelName} (${modelId})` : (modelName ?? modelId ?? "unknown");
  return `${Device.osName ?? "unknown"} ${Device.osVersion ?? ""}, ${model}`;
}

/** The text of the file the user saves: a short header, then one line for each entry. */
export function supportLogFileText(): string {
  const entries = supportLog.entries();
  return [
    "OpenBot support log",
    `Saved: ${new Date().toISOString()}`,
    `App: ${appVersion()}`,
    `Bundle: ${bundleName()}`,
    `System: ${systemName()}`,
    `Entries: ${entries.length}`,
    "",
    ...entries.map(formatSupportLogEntry),
    "",
  ].join("\n");
}

export function clearSupportLog(): void {
  // The cleared entries of the earlier launch must not come back with a later read.
  restored = true;
  supportLog.clear();
  rewrite = true;
  persist();
}

function captureConsole(): void {
  let capturing = false;
  for (const level of ["warn", "error"] as const satisfies readonly SupportLogLevel[]) {
    const original = console[level];
    console[level] = (...values: unknown[]) => {
      if (!capturing) {
        capturing = true;
        try {
          supportLog.add(level, "console", values.map(supportLogValue).join(" "));
        } finally {
          capturing = false;
        }
      }
      original(...values);
    };
  }
}

function captureErrors(): void {
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    supportLog.add("error", "app", `${isFatal ? "Fatal error" : "Uncaught error"}: ${supportLogValue(error)}`);
    // A fatal error ends the app before the delayed write runs.
    if (isFatal) persist();
    previous(error, isFatal);
  });
}

/** Libraries and other code call the global `fetch`. */
function captureFetch(): void {
  const original = globalThis.fetch;
  const fetchWithLog = withRequestLog((input: RequestInfo | URL, init?: RequestInit) => original(input, init));
  // The type declares `fetch` as a function, so it cannot be assigned. React Native defines the
  // global as a configurable property.
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: fetchWithLog,
  });
}

/**
 * Starts the log once, before the app renders, so start-up errors are in it too. The entries of the
 * earlier launch come after the first screen, before the entries of this launch.
 */
export function installSupportLog(): void {
  if (installed) return;
  installed = true;
  restoreWhenIdle();
  supportLog.subscribe(schedulePersist);
  supportLog.add("info", "app", `Started OpenBot ${appVersion()} on ${systemName()}, bundle ${bundleName()}`);
  captureConsole();
  captureErrors();
  captureFetch();
  AppState.addEventListener("change", (state) => {
    supportLog.add("info", "app", `App state: ${state}`);
    if (state === "background") persist();
  });
}
