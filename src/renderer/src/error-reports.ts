import type { AppInfo, CentralAuthUser } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import {
  ANALYTICS_GENERATIONS,
  analyticsOnByDefault,
  classifyFailure,
  currentAnalyticsInstallId,
  type FailureProperties,
  newAnalyticsInstallId,
  openPanelTransport,
  ReportQueue,
  safeProperties,
} from "@openbot/telemetry";
import { indexedReportStorage } from "@openbot/telemetry/browser";
import { Effect } from "effect";
import { version } from "../../../package.json";

export const ANALYTICS_SCHEMA_VERSION = ANALYTICS_GENERATIONS.desktop;

let queue: ReportQueue | undefined;
let enabled = false;
let configured = false;
const startup: { properties: FailureProperties; timestamp: number }[] = [];
let profileId: string | null = null;
let installId: string | null = null;
let webInstallId: string | null | undefined;
export const WEB_PREFERENCE = "openbot:web:error-reports-enabled";
const WEB_ACCOUNT_PENDING = "openbot:web:analytics-account-pending";
const WEB_KEEP_OFF = "openbot:web:analytics-keep-off";
const WEB_INSTALL_ID = "openbot:web:analytics-install-id";

export function configureDesktopReports(
  info: AppInfo,
  tracking: boolean,
  user: Pick<CentralAuthUser, "id" | "email"> | null,
): void {
  const capture = info.analyticsCaptureUrl;
  if (capture === undefined && (!import.meta.env.PROD || info.variant !== "production")) return;
  queue ??= new ReportQueue(
    indexedReportStorage("openbot-desktop-error-reports-v1"),
    openPanelTransport({
      clientId: "6c989975-87ef-4f0c-857e-ab449a65b5c2",
      ...(capture === undefined ? {} : { endpoint: `${capture}/track` }),
    }),
    {
      surface: "desktop",
      platform: info.platform,
      app_version: info.version,
      event_schema_version: ANALYTICS_SCHEMA_VERSION,
    },
  );
  installId = info.analyticsInstallId ?? null;
  configureErrorReports(tracking, user?.id ?? null);
}

export function configureErrorReports(tracking: boolean, accountId: string | null = profileId): void {
  enabled = tracking;
  profileId = accountId;
  if (queue) {
    const initial = !configured;
    configured = true;
    const account = tracking ? accountId : null;
    const subject = tracking ? accountId : installId;
    const sending = tracking || subject !== null;
    Effect.runFork(
      queue.configure(sending, subject).pipe(
        Effect.andThen(() => {
          const pending = startup.splice(0);
          return initial && sending && account === null
            ? Effect.forEach(pending, (entry) =>
                queue ? queue.record("notification_shown", entry.properties, entry.timestamp) : Effect.void,
              )
            : Effect.void;
        }),
      ),
    );
  }
}

let webSignedIn = false;
let webChoice: boolean | null = null;

export function webReportsEnabled(): boolean {
  try {
    const stored = localStorage.getItem(WEB_PREFERENCE);
    if (stored !== null) return stored === "true";
  } catch {
    return false;
  }
  return webChoice ?? (webSignedIn || webAnalyticsDefault());
}

export function webReportsAgreed(): boolean {
  try {
    return localStorage.getItem(WEB_PREFERENCE) === "true";
  } catch {
    return false;
  }
}

function webAnalyticsDefault(): boolean {
  try {
    const region = new Intl.Locale(navigator.language).region;
    return region !== undefined && analyticsOnByDefault(region, Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

export function configureWebReports(user: Pick<CentralAuthUser, "id" | "email"> | null): void {
  webSignedIn = user !== null;
  if (!import.meta.env.PROD || window.location.origin !== "https://openbot.run") return;
  queue ??= new ReportQueue(
    indexedReportStorage("openbot-web-error-reports-v1"),
    openPanelTransport({ clientId: "6c989975-87ef-4f0c-857e-ab449a65b5c2" }),
    { surface: "web", platform: "web", app_version: version, event_schema_version: ANALYTICS_GENERATIONS.web },
  );
  installId = webAnalyticsInstallId();
  configureErrorReports(webReportsEnabled(), user?.id ?? null);
}

export function webAnalyticsInstallId(): string | null {
  if (webInstallId !== undefined) return webInstallId;
  const now = Date.now();
  const stored = (): string | null => {
    try {
      return currentAnalyticsInstallId(JSON.parse(localStorage.getItem(WEB_INSTALL_ID) ?? "null"), now)?.id ?? null;
    } catch {
      return null;
    }
  };
  webInstallId = stored();
  if (webInstallId) return webInstallId;
  try {
    localStorage.setItem(WEB_INSTALL_ID, JSON.stringify(newAnalyticsInstallId(crypto.randomUUID(), now)));
    webInstallId = stored();
  } catch {
    webInstallId = null;
  }
  return webInstallId;
}

export function webKeepsOff(): boolean {
  try {
    return localStorage.getItem(WEB_PREFERENCE) === "false" && localStorage.getItem(WEB_KEEP_OFF) !== "false";
  } catch {
    return true;
  }
}

export function setWebReportsEnabled(value: boolean): boolean {
  if (!value) configureErrorReports(false);
  webChoice = value;
  try {
    const keepOff = !value && webKeepsOff();
    localStorage.setItem(WEB_PREFERENCE, String(value));
    localStorage.setItem(WEB_KEEP_OFF, String(keepOff));
    configureErrorReports(value);
  } catch {
    configureErrorReports(false);
  }
  return enabled;
}

export interface WebAccountPending {
  enabled: boolean;
  at: number;
}

export function webAccountPending(): WebAccountPending | null {
  try {
    const stored = JSON.parse(localStorage.getItem(WEB_ACCOUNT_PENDING) ?? "null");
    return isDynamicRecord(stored) && isBoolean(stored.enabled) && isNumber(stored.at)
      ? { enabled: stored.enabled, at: stored.at }
      : null;
  } catch {
    return null;
  }
}

export function setWebAccountPending(value: boolean | null): void {
  try {
    if (value === null) localStorage.removeItem(WEB_ACCOUNT_PENDING);
    else localStorage.setItem(WEB_ACCOUNT_PENDING, JSON.stringify({ enabled: value, at: Date.now() }));
  } catch {}
}

export function reportNotification(properties: FailureProperties): void {
  if (queue) Effect.runFork(queue.record("notification_shown", properties));
  else if (!configured) {
    const safe = safeProperties(properties);
    if (safe) startup.push({ properties: safe, timestamp: Date.now() });
    if (startup.length > 1_000) startup.shift();
  }
}

export function reportErrorBanner(error: unknown, operation: FailureProperties["operation"] = "other"): void {
  reportNotification({
    operation,
    source: "system",
    severity: "error",
    presentation: "banner",
    cause_code: classifyFailure(error),
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (queue) Effect.runFork(queue.flush());
  });
  window.addEventListener("storage", (event) => {
    if (event.key === WEB_PREFERENCE) configureErrorReports(webReportsEnabled());
  });
}
