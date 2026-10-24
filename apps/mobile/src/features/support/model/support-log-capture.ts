import * as Application from "expo-application";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import { AppState } from "react-native";
import {
  formatSupportLogEntry,
  parseSupportLog,
  type SupportLogLevel,
  supportLog,
  supportLogValue,
  withRequestLog,
} from "./support-log";

const CACHE_FILE = "support-log-v1.json";
// A write converts the whole log to JSON on the JavaScript thread. A move to the background and a
// fatal error write at once, so a longer wait loses only the entries of a native crash.
const PERSIST_DELAY_MS = 10_000;
let installed = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
// The file holds the earlier launch until its entries are in the log, so no write may replace it first.
let restored = false;

/** Reads the earlier launch at once. A move to the background or an error can come before the idle read. */
function restoreNow(): void {
  if (restored) return;
  restored = true;
  try {
    const file = new File(Paths.cache, CACHE_FILE);
    if (file.exists) supportLog.restore(parseSupportLog(file.textSync()));
  } catch {
    // A cache file that cannot be read starts a new log.
  }
}

/** Reads the earlier launch after the first screen, so the parse and the redaction do not delay it. */
function restoreWhenIdle(): void {
  requestIdleCallback(() => {
    if (restored) return;
    const file = new File(Paths.cache, CACHE_FILE);
    let text: Promise<string>;
    try {
      text = file.exists ? file.text() : Promise.resolve("");
    } catch {
      restored = true;
      return;
    }
    void text.then(
      (value) => {
        if (restored) return;
        restored = true;
        if (value) supportLog.restore(parseSupportLog(value));
      },
      () => {
        restored = true;
      },
    );
  });
}

function persist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = null;
  restoreNow();
  try {
    new File(Paths.cache, CACHE_FILE).writeSync(JSON.stringify(supportLog.entries()));
  } catch {
    // The log on the screen and the saved file still work without the cache copy.
  }
}

function schedulePersist(): void {
  persistTimer ??= setTimeout(persist, PERSIST_DELAY_MS);
}

function appVersion(): string {
  const version = Application.nativeApplicationVersion ?? "development";
  return Application.nativeBuildVersion ? `${version} (${Application.nativeBuildVersion})` : version;
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
  supportLog.add("info", "app", `Started OpenBot ${appVersion()} on ${systemName()}`);
  captureConsole();
  captureErrors();
  captureFetch();
  AppState.addEventListener("change", (state) => {
    supportLog.add("info", "app", `App state: ${state}`);
    if (state === "background") persist();
  });
}
