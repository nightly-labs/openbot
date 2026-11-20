import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import {
  BACKGROUND_REFRESH_MINUTES,
  type BackgroundRefreshNative,
  type BackgroundRefreshRun,
} from "./background-refresh-native.types";

const TASK_NAME = "openbot-background-refresh";

let current: BackgroundRefreshRun | null = null;
let registrations: Promise<void> = Promise.resolve();

function afterRegistrations(change: () => Promise<void>): Promise<void> {
  registrations = registrations.then(change, change);
  return registrations;
}

function statusText(status: BackgroundTask.BackgroundTaskStatus): "available" | "restricted" {
  return status === BackgroundTask.BackgroundTaskStatus.Available ? "available" : "restricted";
}

async function runTask(): Promise<BackgroundTask.BackgroundTaskResult> {
  const run = current;
  if (!run) {
    await afterRegistrations(() => BackgroundTask.unregisterTaskAsync(TASK_NAME)).catch(() => undefined);
    return BackgroundTask.BackgroundTaskResult.Success;
  }
  const loaded = await run(new AbortController().signal).catch(() => false);
  return loaded ? BackgroundTask.BackgroundTaskResult.Success : BackgroundTask.BackgroundTaskResult.Failed;
}

export const androidBackgroundRefresh: BackgroundRefreshNative = {
  install: () => TaskManager.defineTask(TASK_NAME, runTask),
  enable(run) {
    current = run;
    void afterRegistrations(() =>
      BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: BACKGROUND_REFRESH_MINUTES }),
    )
      .then(() => BackgroundTask.getStatusAsync())
      .then(
        (status) => {
          const text = statusText(status);
          supportLog.add(text === "available" ? "info" : "warn", "app", `Background refresh: ${text}`);
        },
        (error) => supportLog.add("warn", "app", `Background refresh not scheduled: ${supportLogValue(error)}`),
      );
    return () => {
      if (current !== run) return;
      current = null;
      void afterRegistrations(() => BackgroundTask.unregisterTaskAsync(TASK_NAME)).catch(() => undefined);
    };
  },
};
