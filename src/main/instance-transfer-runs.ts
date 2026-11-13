// The run history of the routines in an instance transfer file, when the user includes the chat
// history (agent routines) or the channel messages (channel routines). Each routine keeps the newest
// runs that its history page shows, with the times of the other computer.
//
// The import writes them as finished runs of the routine's copy. A run that was still open on the
// other computer is written as interrupted (an agent's) or cancelled (a channel's): nothing here
// starts it again. A run has no trigger and no handle here, because both belonged to the other server.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { ROUTINE_RUN_SOURCES, type RoutineRunFields } from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import type { ImportedRoutineRun } from "../backend/routine-store";

/** A run as the file keeps it. */
export interface TransferRun extends ImportedRoutineRun {
  /** The run id on the computer that made the file. Chat messages name runs by it. */
  id: string;
}

const AGENT_FINISHED = ["succeeded", "failed", "interrupted", "cancelled"] as const;
const CHANNEL_FINISHED = ["succeeded", "failed", "cancelled"] as const;
const ALL_STATUSES = ["queued", "running", "needs-attention", ...AGENT_FINISHED] as const;
const ERROR_LIMIT = 4000;

/** The runs of one routine for the file. */
export function transferRuns(runs: readonly RoutineRunFields[]): TransferRun[] {
  return runs.map((run) => ({
    id: run.id,
    kind: run.kind,
    ...(run.source ? { source: run.source } : {}),
    scheduledFor: run.scheduledFor,
    routineName: run.routineName,
    instruction: run.instruction,
    status: run.status,
    error: run.error,
    ...(run.missed ? { missed: run.missed } : {}),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  }));
}

/**
 * The valid runs of a routine in the file, as finished runs of this computer. An invalid run is left
 * out, so one bad entry cannot refuse the routine.
 */
export function decodeRuns(values: readonly unknown[] | undefined, channel: boolean): TransferRun[] {
  return (values ?? []).slice(0, INPUT_LIMITS.routineRunsPage).flatMap((value): TransferRun[] => {
    if (!isDynamicRecord(value)) return [];
    const { id, kind, source, scheduledFor, routineName, instruction, status, error, missed } = value;
    const createdAt = isoTime(value.createdAt);
    const updatedAt = isoTime(value.updatedAt);
    const scheduled = isoTime(scheduledFor);
    if (
      !bounded(id, INPUT_LIMITS.identifier) ||
      (kind !== "scheduled" && kind !== "manual") ||
      !(source === undefined || isOneOf(ROUTINE_RUN_SOURCES, source)) ||
      !scheduled ||
      !createdAt ||
      !updatedAt ||
      !bounded(routineName, INPUT_LIMITS.routineName) ||
      !bounded(instruction, INPUT_LIMITS.routineInstruction) ||
      !isOneOf(ALL_STATUSES, status) ||
      !(error === null || isString(error))
    )
      return [];
    const decodedMissed = decodeMissed(missed);
    if (decodedMissed === false) return [];
    return [
      {
        id,
        kind,
        ...(source === undefined ? {} : { source }),
        scheduledFor: scheduled,
        routineName,
        instruction,
        status: finished(status, channel),
        // A long error, such as a provider's dump, is cut; the run stays.
        error: error ? error.slice(0, ERROR_LIMIT) : null,
        ...(decodedMissed ? { missed: decodedMissed } : {}),
        createdAt,
        updatedAt,
      },
    ];
  });
}

/** A finished status that the run's table takes. */
function finished(status: (typeof ALL_STATUSES)[number], channel: boolean): ImportedRoutineRun["status"] {
  if (channel) return isOneOf(CHANNEL_FINISHED, status) ? status : "cancelled";
  return isOneOf(AGENT_FINISHED, status) ? status : "interrupted";
}

/** The missed-run record, null for none, or false when it is invalid. */
function decodeMissed(value: unknown): { count: number; until: string | null } | null | false {
  if (value === undefined) return null;
  if (!isDynamicRecord(value)) return false;
  const { count, until } = value;
  // A count above the limit means "more than the limit", as the history shows it.
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) return false;
  if (until === null) return { count, until: null };
  const time = isoTime(until);
  return time ? { count, until: time } : false;
}

function bounded(value: unknown, limit: number): value is string {
  return isString(value) && value.length > 0 && value.length <= limit;
}

function isoTime(value: unknown): string | null {
  if (!isString(value) || value.length > 64) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
