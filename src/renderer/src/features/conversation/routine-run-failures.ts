import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { ListRoutineRunsInput, RoutineRun } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { createEffect, createMemo, createSignal } from "solid-js";

export interface RoutineRunFailureSource {
  agentId: string;
  serverId: string | undefined;
  listRuns: (input: ListRoutineRunsInput) => Promise<RoutineRun[]>;
}

interface FailedRun {
  routineId: string;
  runId: string;
}

export function createRoutineRunFailures(
  source: () => RoutineRunFailureSource | undefined,
  messages: () => readonly AgentMessage[],
): (runId: string) => string | undefined {
  const failedRuns = createMemo(
    () =>
      messages().flatMap((message): FailedRun[] => {
        const marker = message.actionMarker;
        return marker?.kind === "routine-run" && marker.status === "failed"
          ? [{ routineId: marker.routineId, runId: marker.runId }]
          : [];
      }),
    { equals: (left, right) => runKeys(left) === runKeys(right) },
  );
  const [reasons, setReasons] = createSignal<ReadonlyMap<string, string>>(new Map());
  let lookedFor = new Set<string>();
  let readFrom: RoutineRunFailureSource | undefined;
  let request = 0;
  createEffect(
    () => ({ current: source(), runs: failedRuns() }),
    ({ current, runs }) => {
      if (current !== readFrom) {
        readFrom = current;
        request += 1;
        lookedFor = new Set();
        setReasons(new Map());
      }
      if (!current) return;
      const runIds = new Map<string, string[]>();
      for (const run of runs) {
        if (lookedFor.has(run.runId)) continue;
        lookedFor.add(run.runId);
        runIds.set(run.routineId, [...(runIds.get(run.routineId) ?? []), run.runId]);
      }
      const loading = request;
      for (const [routineId, ids] of runIds) {
        void current
          .listRuns({ agentId: current.agentId, routineId, limit: INPUT_LIMITS.routineRunsPage })
          .then((history) => {
            if (loading !== request) return;
            const failed = history.flatMap((run) =>
              run.status === "failed" && run.error ? [[run.id, run.error] as const] : [],
            );
            if (failed.length > 0) setReasons((known) => new Map([...known, ...failed]));
          })
          .catch(() => {
            if (loading === request) for (const id of ids) lookedFor.delete(id);
          });
      }
    },
  );
  return (runId) => reasons().get(runId);
}

function runKeys(runs: readonly FailedRun[]): string {
  return runs.map((run) => run.runId).join("\n");
}
