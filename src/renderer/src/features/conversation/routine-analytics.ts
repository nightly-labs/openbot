import type { RoutineSchedule } from "@openbot/contracts/ipc";
import type { DesktopAnalyticsScope } from "../../analytics";
import { webhookFailureCode } from "../../webhook-failure-code";

export function trackRoutineAction(
  analytics: DesktopAnalyticsScope,
  action: "create" | "update" | "delete" | "test",
  routine: { triggerKind: "schedule" | "webhook"; schedule: RoutineSchedule },
  startedAt: number,
  result: "succeeded" | "failed",
  error?: unknown,
): void {
  analytics.track("routine_action", {
    action,
    trigger_type: routine.triggerKind === "webhook" ? "webhook" : routine.schedule.kind,
    duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    result,
    ...(result === "failed" ? { failure_code: webhookFailureCode(error, `${action}_failed`) } : {}),
  });
}
