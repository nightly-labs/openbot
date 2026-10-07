import type { AppInfo, CentralAuthUser } from "@openbot/contracts/ipc";
import {
  classifyFailure,
  type FailureProperties,
  openPanelTransport,
  ReportQueue,
  safeProperties,
} from "@openbot/telemetry";
import { indexedReportStorage } from "@openbot/telemetry/browser";
import { Effect } from "effect";
import { version } from "../../../package.json";

let queue: ReportQueue | undefined;
let enabled = false;
let configured = false;
const startup: { properties: FailureProperties; timestamp: number }[] = [];
let profileId: string | null = null;
const WEB_PREFERENCE = "openbot:web:error-reports-enabled";

export function configureDesktopReports(
  info: AppInfo,
  tracking: boolean,
  user: Pick<CentralAuthUser, "id" | "email"> | null,
): void {
  if (!import.meta.env.PROD || info.variant !== "production") return;
  queue ??= new ReportQueue(
    indexedReportStorage("openbot-desktop-error-reports-v1"),
    openPanelTransport({ clientId: "6c989975-87ef-4f0c-857e-ab449a65b5c2" }),
    { surface: "desktop", platform: info.platform, app_version: info.version, event_schema_version: 7 },
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

export function webReportsEnabled(): boolean {
  try {
    const stored = localStorage.getItem(WEB_PREFERENCE);
    return stored === null || stored === "true";
  } catch {
    return false;
  }
}

export function configureWebReports(user: Pick<CentralAuthUser, "id" | "email"> | null): void {
  if (!import.meta.env.PROD || window.location.origin !== "https://openbot.run") return;
  queue ??= new ReportQueue(
    indexedReportStorage("openbot-web-error-reports-v1"),
    openPanelTransport({ clientId: "6c989975-87ef-4f0c-857e-ab449a65b5c2" }),
    { surface: "web", platform: "web", app_version: version, event_schema_version: 1 },
  );
  configureErrorReports(webReportsEnabled(), user?.id ?? null);
}

export function setWebReportsEnabled(value: boolean): boolean {
  // Disable first. A failed write must never permit a pending send.
  if (!value) configureErrorReports(false);
  try {
    localStorage.setItem(WEB_PREFERENCE, String(value));
    configureErrorReports(value);
  } catch {
    configureErrorReports(false);
  }
  return enabled;
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
