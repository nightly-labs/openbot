import { FEEDBACK_LIMITS, type FeedbackPhone } from "@openbot/contracts/feedback";
import * as Device from "expo-device";
import { File, Paths } from "expo-file-system";
import * as Updates from "expo-updates";
import { AppState, Platform } from "react-native";
import { nativeApplicationVersion, nativeBuildVersion } from "@/shared/lib/native-application";
import { installPhoneNetwork, phoneNetwork } from "./phone-network-capture";
import {
  formatSupportLogEntry,
  parseSupportLog,
  parseSupportLogCache,
  SUPPORT_LOG_CACHE_LINES,
  type SupportLogLevel,
  supportLog,
  supportLogCacheLines,
  supportLogCacheText,
  supportLogExcerpt,
  supportLogValue,
  withRequestLog,
} from "./support-log";
import { installSystemState } from "./system-state-capture";

const CACHE_FILE = "support-log-v2.jsonl";
const LEGACY_CACHE_FILE = "support-log-v1.json";
const PERSIST_DELAY_MS = 10_000;
let installed = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let restored = false;
let rewrite = true;
let cacheLines = 0;

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

function restoreText(cache: string | null, legacy: string | null): void {
  if (cache !== null) {
    const parsed = parseSupportLogCache(cache, redactionKey());
    cacheLines = parsed.lines;
    rewrite = parsed.rewrite;
    supportLog.restore(parsed.entries);
  } else if (legacy !== null) {
    supportLog.restore(parseSupportLog(legacy));
  }
}

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
  } catch {}
}

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
    rewrite = true;
  }
}

function schedulePersist(): void {
  persistTimer ??= setTimeout(persist, PERSIST_DELAY_MS);
}

function appVersion(): string {
  const version = nativeApplicationVersion() ?? "development";
  const build = nativeBuildVersion();
  return build ? `${version} (${build})` : version;
}

function bundleName(): string {
  if (!Updates.isEnabled) return "no update server";
  const bundle = Updates.isEmbeddedLaunch ? "embedded" : (Updates.updateId ?? "unknown");
  return `${bundle}, channel ${Updates.channel ?? "none"}, runtime ${Updates.runtimeVersion ?? "none"}`;
}

function systemName(): string {
  const { modelName, modelId } = Device;
  const model =
    modelName && modelId && modelName !== modelId ? `${modelName} (${modelId})` : (modelName ?? modelId ?? "unknown");
  return `${Device.osName ?? "unknown"} ${Device.osVersion ?? ""}, ${model}`;
}

export function supportLogFileText(): string {
  const entries = supportLog.entries();
  return [
    "OpenBot support log",
    `Saved: ${new Date().toISOString()}`,
    `App: ${appVersion()}`,
    `Bundle: ${bundleName()}`,
    `System: ${systemName()}`,
    `Network: ${phoneNetwork()}`,
    `Entries: ${entries.length}`,
    "",
    ...entries.map(formatSupportLogEntry),
    "",
  ].join("\n");
}

export function phoneFeedback(): FeedbackPhone {
  const update = Updates.isEmbeddedLaunch ? null : Updates.updateId?.slice(0, 8);
  return {
    platform: Platform.OS === "android" ? "Android" : "iOS",
    appVersion: (update ? `${appVersion()} · ${update}` : appVersion()).slice(0, FEEDBACK_LIMITS.fact),
    system: systemName().slice(0, FEEDBACK_LIMITS.fact),
    network: phoneNetwork().slice(0, FEEDBACK_LIMITS.fact),
    log:
      supportLogExcerpt(supportLog.entries(), FEEDBACK_LIMITS.phoneLog) ||
      "The support log has no warning, error or connection event.",
  };
}

const shown = new Map<string, FeedbackPhone>();

function shownKey(approval: { agentId: string; requestId: string | number }): string {
  return `${approval.agentId}\n${String(approval.requestId)}`;
}

export function showPhoneFeedback(approval: { agentId: string; requestId: string | number }): FeedbackPhone {
  const phone = phoneFeedback();
  shown.set(shownKey(approval), phone);
  return phone;
}

export function shownPhoneFeedback(approval: { agentId: string; requestId: string | number }): FeedbackPhone | null {
  const phone = shown.get(shownKey(approval));
  return phone ? { ...phone, network: phoneNetwork().slice(0, FEEDBACK_LIMITS.fact) } : null;
}

export function forgetPhoneFeedback(approval: { agentId: string; requestId: string | number }): void {
  shown.delete(shownKey(approval));
}

export function clearSupportLog(): void {
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
    if (isFatal) persist();
    previous(error, isFatal);
  });
}

function captureFetch(): void {
  const original = globalThis.fetch;
  const fetchWithLog = withRequestLog((input: RequestInfo | URL, init?: RequestInit) => original(input, init));
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: fetchWithLog,
  });
}

export function installSupportLog(): void {
  if (installed) return;
  installed = true;
  restoreWhenIdle();
  supportLog.subscribe(schedulePersist);
  supportLog.add("info", "app", `Started OpenBot ${appVersion()} on ${systemName()}, bundle ${bundleName()}`);
  captureConsole();
  captureErrors();
  captureFetch();
  installPhoneNetwork();
  installSystemState();
  AppState.addEventListener("change", (state) => {
    supportLog.add("info", "app", `App state: ${state}`);
    if (state === "background") persist();
  });
}
