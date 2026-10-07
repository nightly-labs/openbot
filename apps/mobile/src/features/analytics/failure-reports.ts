import {
  classifyFailure,
  type FailureProperties,
  openPanelTransport,
  ReportQueue,
  type ReportStorage,
  telemetryIO,
} from "@openbot/telemetry";
import { Effect } from "effect";
import * as Application from "expo-application";
import { randomUUID } from "expo-crypto";
import { Alert, Platform } from "react-native";

const storage: ReportStorage = {
  read: () =>
    telemetryIO(async () => {
      const { File, Paths } = await import("expo-file-system");
      const file = new File(Paths.document, "openbot-error-reports-v1.json");
      if (!file.exists) return null;
      try {
        return JSON.parse(await file.text());
      } catch (error) {
        if (error instanceof SyntaxError) return null;
        throw error;
      }
    }),
  write: (value) =>
    telemetryIO(async () => {
      const { File, Paths } = await import("expo-file-system");
      const file = new File(Paths.document, "openbot-error-reports-v1.json");
      const temporary = new File(Paths.document, "openbot-error-reports-v1.tmp");
      await temporary.write(JSON.stringify(value));
      await temporary.move(file, { overwrite: true });
    }),
};

let reports: ReportQueue | undefined;
export function mobileReportQueue(): ReportQueue | undefined {
  if (reports) return reports;
  const clientId = process.env.EXPO_PUBLIC_OPENPANEL_CLIENT_ID;
  const clientSecret = process.env.EXPO_PUBLIC_OPENPANEL_CLIENT_SECRET;
  if (
    __DEV__ ||
    process.env.EXPO_PUBLIC_APP_ENV !== "production" ||
    !clientId ||
    !clientSecret ||
    (Platform.OS !== "ios" && Platform.OS !== "android")
  )
    return undefined;
  reports = new ReportQueue(
    storage,
    openPanelTransport({ clientId, clientSecret }),
    {
      surface: "mobile",
      platform: Platform.OS,
      app_version: Application.nativeApplicationVersion ?? "unknown",
      event_schema_version: 2,
    },
    Date.now,
    Math.random,
    randomUUID,
  );
  return reports;
}

export function reportMobileNotification(
  error: unknown,
  operation: FailureProperties["operation"],
  presentation: "alert" | "banner" = "banner",
  context: Partial<Pick<FailureProperties, "source" | "severity" | "provider" | "model">> = {},
): void {
  const queue = mobileReportQueue();
  if (queue)
    Effect.runFork(
      queue.record("notification_shown", {
        operation,
        source: "action",
        severity: "error",
        presentation,
        cause_code: classifyFailure(error),
        ...context,
      }),
    );
}

/** Classify the original failure before the native alert receives its display text. */
export function showFailureAlert(
  error: unknown,
  operation: FailureProperties["operation"],
  ...args: Parameters<typeof Alert.alert>
): void {
  reportMobileNotification(error, operation, "alert");
  Alert.alert(...args);
}

export function showWarningAlert(
  operation: FailureProperties["operation"],
  ...args: Parameters<typeof Alert.alert>
): void {
  reportMobileNotification(undefined, operation, "alert", { severity: "warning", source: "system" });
  Alert.alert(...args);
}
