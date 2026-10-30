import type { AppInfo, CentralAuthUser } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import {
  ANALYTICS_GENERATIONS,
  analyticsOnByDefault,
  classifyFailure,
  type FailureProperties,
  openPanelTransport,
  ReportQueue,
  safeProperties,
} from "@openbot/telemetry";
import { indexedReportStorage } from "@openbot/telemetry/browser";
import { Effect } from "effect";
import { version } from "../../../package.json";

/** The desktop schema generation. Product events and failure reports send the same value. */
export const ANALYTICS_SCHEMA_VERSION = ANALYTICS_GENERATIONS.desktop;

let queue: ReportQueue | undefined;
let enabled = false;
let configured = false;
const startup: { properties: FailureProperties; timestamp: number }[] = [];
let profileId: string | null = null;
/** The web analytics preference. The key keeps its first name, so stored choices stay. */
export const WEB_PREFERENCE = "openbot:web:error-reports-enabled";
/** A choice of this browser that the account has not saved yet, "true" or "false". */
const WEB_ACCOUNT_PENDING = "openbot:web:analytics-account-pending";
/** "true" or "false". Missing: an app from before the account kept answers saved the choice. */
const WEB_KEEP_OFF = "openbot:web:analytics-keep-off";

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
  configureErrorReports(tracking, user?.id ?? null);
}

export function configureErrorReports(tracking: boolean, accountId: string | null = profileId): void {
  enabled = tracking;
  profileId = accountId;
  if (queue) {
    const initial = !configured;
    configured = true;
    Effect.runFork(
      queue.configure(enabled, profileId).pipe(
        Effect.andThen(() => {
          const pending = startup.splice(0);
          return initial && enabled && profileId === null
            ? Effect.forEach(pending, (entry) =>
                queue ? queue.record("notification_shown", entry.properties, entry.timestamp) : Effect.void,
              )
            : Effect.void;
        }),
      ),
    );
  }
}

/** True while this browser has a signed-in account. `configureWebReports` sets it. */
let webSignedIn = false;
/** The choice of this page, for a browser that cannot save it. */
let webChoice: boolean | null = null;

/**
 * The web choice for failure reports and product analytics. With no saved choice, a signed-in
 * account keeps the earlier default, on: it signed in before the sign-in screen asked. A signed-out
 * browser uses the default of its region until the sign-in screen saves a choice.
 */
export function webReportsEnabled(): boolean {
  try {
    const stored = localStorage.getItem(WEB_PREFERENCE);
    if (stored !== null) return stored === "true";
  } catch {
    return false;
  }
  return webChoice ?? (webSignedIn || webAnalyticsDefault());
}

/** True when this browser saved "on". The sign-in screen then keeps it and does not ask again. */
export function webReportsAgreed(): boolean {
  try {
    return localStorage.getItem(WEB_PREFERENCE) === "true";
  } catch {
    return false;
  }
}

/** On only when the region of the browser language and the time zone are in a default-on country. */
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
  configureErrorReports(webReportsEnabled(), user?.id ?? null);
}

/**
 * True when this browser keeps an "off" that it saved before the account kept answers. An account
 * answer of "on" does not replace it; only a choice in this browser does. Storage that cannot be
 * read keeps "off".
 */
export function webKeepsOff(): boolean {
  try {
    return localStorage.getItem(WEB_PREFERENCE) === "false" && localStorage.getItem(WEB_KEEP_OFF) !== "false";
  } catch {
    return true;
  }
}

export function setWebReportsEnabled(value: boolean): boolean {
  // Disable first. A failed write must never permit a pending send.
  if (!value) configureErrorReports(false);
  webChoice = value;
  try {
    // A kept "off" stays kept until this browser turns analytics on. The value goes first: when the
    // mark write fails, an "off" without its mark reads as kept.
    const keepOff = !value && webKeepsOff();
    localStorage.setItem(WEB_PREFERENCE, String(value));
    localStorage.setItem(WEB_KEEP_OFF, String(keepOff));
    configureErrorReports(value);
  } catch {
    configureErrorReports(false);
  }
  return enabled;
}

/** A choice of the user that the account does not have yet, and its time (ms). */
export interface WebAccountPending {
  enabled: boolean;
  at: number;
}

/** The user's choice that the account must still save, so their other devices follow it. */
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

/** Marks a choice that the account must save, or clears it after the account has it. */
export function setWebAccountPending(value: boolean | null): void {
  try {
    if (value === null) localStorage.removeItem(WEB_ACCOUNT_PENDING);
    else localStorage.setItem(WEB_ACCOUNT_PENDING, JSON.stringify({ enabled: value, at: Date.now() }));
  } catch {
    // Without storage the choice stays on this page only; the account does not get it.
  }
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
