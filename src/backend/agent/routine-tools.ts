import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isRoutineSchedule, ROUTINE_MINIMUM_INTERVAL_MINUTES, type RoutineSchedule } from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { isRecord } from "../protocol";

export function routineToolArguments(value: unknown, allowedKeys: readonly string[]): DynamicRecord {
  if (!isRecord(value)) throw new Error("Routine tool arguments are required.");
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) throw new Error(`Unexpected routine argument: ${unexpected}.`);
  return value;
}

export function routineToolAgentId(args: DynamicRecord, senderAgentId: string): string {
  if (args.agentId === undefined) return senderAgentId;
  return routineToolString(args.agentId, "agentId", INPUT_LIMITS.identifier, "agentId is required.");
}

export function routineToolString(value: unknown, field: string, limit: number, requiredMessage: string): string {
  if (!isString(value) || !value.trim()) throw new Error(requiredMessage);
  if (value.length > limit) throw new Error(`${field} is too long.`);
  return value;
}

export function siteToolString(value: unknown, field: string, limit: number): string {
  if (!isString(value) || !value.trim()) throw new Error(`${field} is required.`);
  if (value.length > limit) throw new Error(`${field} is too long.`);
  return value.trim();
}

export function routineToolSchedule(value: unknown): RoutineSchedule {
  if (!isRoutineSchedule(value)) throw new Error("The routine schedule is invalid.");
  // Validate the polling floor before the store runs so the provider gets a clear,
  // actionable error instead of a raw failure after the request. Custom cron schedules
  // still need a timezone and are checked by the routine store.
  if (value.kind === "interval" && intervalMinutes(value.amount, value.unit) < ROUTINE_MINIMUM_INTERVAL_MINUTES) {
    throw new Error(
      `Routine intervals must be at least ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutes. Use ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutes or more, or a daily, weekly, or cron schedule.`,
    );
  }
  if (
    value.kind === "advanced" &&
    value.time.kind === "every" &&
    intervalMinutes(value.time.amount, value.time.unit) < ROUTINE_MINIMUM_INTERVAL_MINUTES
  ) {
    throw new Error(
      `Routine intervals must be at least ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutes. Use ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutes or more, or a fixed time.`,
    );
  }
  return structuredClone(value);
}

function intervalMinutes(amount: number, unit: "minutes" | "hours" | "days"): number {
  return unit === "minutes" ? amount : unit === "hours" ? amount * 60 : amount * 1440;
}

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The shape every `openbot` namespace dynamic tool answers with. */
export interface OpenBotToolResponse {
  success: boolean;
  contentItems: Array<{ type: "inputText"; text: string }>;
}

export function openBotToolResult(value: unknown): OpenBotToolResponse {
  return {
    success: true,
    contentItems: [{ type: "inputText", text: JSON.stringify(value) }],
  };
}
