import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  isRoutineSchedule,
  ROUTINE_LIMIT_POLICIES,
  ROUTINE_MINIMUM_INTERVAL_MINUTES,
  ROUTINE_MISSED_POLICIES,
  ROUTINE_RUN_PLACES,
  type RoutineLimitPolicy,
  type RoutineMissedPolicy,
  type RoutineRunPlace,
  type RoutineSchedule,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import { isRecord } from "../protocol";
import { routineScheduleZodSchema } from "../routine-tool-schema";

export function routineToolArguments(value: unknown, allowedKeys: readonly string[]): DynamicRecord {
  if (!isRecord(value)) throw new RoutineInputError("Routine tool arguments are required.");
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) throw new RoutineInputError(`Unexpected routine argument: ${unexpected}.`);
  return value;
}

export function routineToolAgentId(args: DynamicRecord, senderAgentId: string): string {
  if (args.agentId === undefined) return senderAgentId;
  return routineToolString(args.agentId, "agentId", INPUT_LIMITS.identifier, "agentId is required.");
}

export function routineToolString(value: unknown, field: string, limit: number, requiredMessage: string): string {
  if (!isString(value) || !value.trim()) throw new RoutineInputError(requiredMessage);
  if (value.length > limit) throw new RoutineInputError(`${field} is too long.`);
  return value;
}

/** The recovery policies a routine tool call sets. A field the call leaves out stays out. */
export function routineToolPolicies(args: DynamicRecord): {
  limitPolicy?: RoutineLimitPolicy;
  missedPolicy?: RoutineMissedPolicy;
} {
  const { limitPolicy, missedPolicy } = args;
  if (limitPolicy !== undefined && !isOneOf(ROUTINE_LIMIT_POLICIES, limitPolicy)) {
    throw new RoutineInputError(`limitPolicy must be one of: ${ROUTINE_LIMIT_POLICIES.join(", ")}.`);
  }
  if (missedPolicy !== undefined && !isOneOf(ROUTINE_MISSED_POLICIES, missedPolicy)) {
    throw new RoutineInputError(`missedPolicy must be one of: ${ROUTINE_MISSED_POLICIES.join(", ")}.`);
  }
  return {
    ...(limitPolicy === undefined ? {} : { limitPolicy }),
    ...(missedPolicy === undefined ? {} : { missedPolicy }),
  };
}

/** Where an agent routine runs, when the tool call sets it. A call that leaves it out keeps the saved place. */
export function routineToolRunPlace(args: DynamicRecord): { runIn?: RoutineRunPlace } {
  const { runIn } = args;
  if (runIn === undefined) return {};
  if (!isOneOf(ROUTINE_RUN_PLACES, runIn)) {
    throw new RoutineInputError(`runIn must be one of: ${ROUTINE_RUN_PLACES.join(", ")}.`);
  }
  return { runIn };
}

export function siteToolString(value: unknown, field: string, limit: number): string {
  if (!isString(value) || !value.trim()) throw new Error(`${field} is required.`);
  if (value.length > limit) throw new Error(`${field} is too long.`);
  return value.trim();
}

export function routineToolSchedule(value: unknown): RoutineSchedule {
  if (!isRoutineSchedule(value)) {
    // A model that guesses the shape, such as { type: "daily" }, needs to know which field to change;
    // with "invalid" only, agents tried a dozen shapes and gave up (#6754). The schema only explains
    // the refusal: `isRoutineSchedule` still decides what is accepted.
    const detail = routineScheduleProblem(value);
    if (detail === null) throw new RoutineInputError(sourceText("error.backend.routineScheduleInvalid"));
    throw new RoutineInputError(sourceText("error.agent.routineScheduleArgumentsInvalid", { detail }));
  }
  // Validate the polling floor before the store runs so the provider gets a clear,
  // actionable error instead of a raw failure after the request. Custom cron schedules
  // still need a timezone and are checked by the routine store.
  if (value.kind === "interval" && intervalMinutes(value.amount, value.unit) < ROUTINE_MINIMUM_INTERVAL_MINUTES) {
    throw new RoutineInputError(
      `Routine intervals must be at least ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutes. Use ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutes or more, or a daily, weekly, or cron schedule.`,
    );
  }
  if (
    value.kind === "advanced" &&
    value.time.kind === "every" &&
    intervalMinutes(value.time.amount, value.time.unit) < ROUTINE_MINIMUM_INTERVAL_MINUTES
  ) {
    throw new RoutineInputError(
      `Routine intervals must be at least ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutes. Use ${ROUTINE_MINIMUM_INTERVAL_MINUTES} minutes or more, or a fixed time.`,
    );
  }
  return structuredClone(value);
}

/** Why `isRoutineSchedule` refused `value`, for the agent, or null when the reason is not known. */
function routineScheduleProblem(value: unknown): string | null {
  const parsed = routineScheduleZodSchema.safeParse(value);
  const problems = parsed.success
    ? // The schema checks the format of these values; `isRoutineSchedule` also checks that they exist.
      parsed.data.kind === "interval"
      ? ["schedule.anchorAt: Invalid date-time"]
      : parsed.data.kind === "once"
        ? ["schedule.date: Not a calendar date"]
        : []
    : parsed.error.issues.map((issue) => `${["schedule", ...issue.path.map(String)].join(".")}: ${issue.message}`);
  if (problems.length === 0) return null;
  const detail = `${problems.join("; ")}.`;
  return detail.length > 600 ? `${detail.slice(0, 597)}...` : detail;
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

/**
 * A refusal the model is meant to read and act on, rather than a throw.
 *
 * `#handleServerRequest` turns a thrown error into an opaque JSON-RPC fault, which a model can only
 * give up on. `claude-client.ts` maps `success: false` onto `isError: true`, so both provider paths
 * show this as a failed tool call with the reason attached. `details` adds counts beside the reason.
 */
export function openBotToolFailure(message: string, details?: Readonly<Record<string, number>>): OpenBotToolResponse {
  return {
    success: false,
    contentItems: [{ type: "inputText", text: JSON.stringify({ ...details, error: message }) }],
  };
}
