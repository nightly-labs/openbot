import type { WorkflowSummary } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { decodeRemoteWorkflowSummary } from "@openbot/team-client/workflow-decoding";
import { create } from "zustand";

/**
 * The last values of the drawer for one server, so that the drawer shows them after a start until the
 * host answers. A value that the drawer did not read yet is absent. The host stays the source of truth.
 */
export interface DrawerSnapshot {
  memberCount?: number;
  /** The estimated cost of the Usage screen's default period, or null when the host has none. */
  usageUsd?: number | null;
  /** The next routine runs, earliest first. The drawer does not show a run that has passed. */
  routineRuns?: string[];
  /** Null on a host without `agent-tasks-v1`. */
  tasks?: { unread: number; working: number } | null;
  /** Null on a host without `workflows-v1`. */
  workflows?: { needsYou: number; running: number; pinned: WorkflowSummary[] } | null;
}

/** The drawer keeps this many routine runs: after the first runs pass, the next one still shows. */
export const DRAWER_ROUTINE_RUNS = 12;

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** A value that this build cannot read is absent, so the drawer waits for the host as before. */
export function decodeDrawerSnapshot(value: unknown): DrawerSnapshot | null {
  if (!isDynamicRecord(value)) return null;
  const snapshot: DrawerSnapshot = {};
  if (isCount(value.memberCount)) snapshot.memberCount = value.memberCount;
  if (value.usageUsd === null || (typeof value.usageUsd === "number" && Number.isFinite(value.usageUsd)))
    snapshot.usageUsd = value.usageUsd;
  if (Array.isArray(value.routineRuns) && value.routineRuns.every(isString))
    snapshot.routineRuns = value.routineRuns.slice(0, DRAWER_ROUTINE_RUNS);
  const { tasks, workflows } = value;
  if (tasks === null) snapshot.tasks = null;
  else if (isDynamicRecord(tasks) && isCount(tasks.unread) && isCount(tasks.working))
    snapshot.tasks = { unread: tasks.unread, working: tasks.working };
  if (workflows === null) snapshot.workflows = null;
  else if (
    isDynamicRecord(workflows) &&
    isCount(workflows.needsYou) &&
    isCount(workflows.running) &&
    Array.isArray(workflows.pinned)
  ) {
    try {
      snapshot.workflows = {
        needsYou: workflows.needsYou,
        running: workflows.running,
        pinned: workflows.pinned.map(decodeRemoteWorkflowSummary),
      };
    } catch {
      // The workflows wait for the host.
    }
  }
  return snapshot;
}

const NO_SNAPSHOT: DrawerSnapshot = {};

/** The drawer values of each server of the signed-in account, from the last read or the workspace cache. */
const useDrawerSnapshots = create<{ scope: string | null; byServer: Readonly<Record<string, DrawerSnapshot>> }>(() => ({
  scope: null,
  byServer: {},
}));

/** Starts the values of an account. Another account, or a sign-out, starts with none. */
export function startDrawerSnapshots(scope: string | null): void {
  if (useDrawerSnapshots.getState().scope !== scope) useDrawerSnapshots.setState({ scope, byServer: {} });
}

export function useDrawerSnapshot(serverId: string): DrawerSnapshot {
  return useDrawerSnapshots((state) => state.byServer[serverId] ?? NO_SNAPSHOT);
}

export function drawerSnapshot(serverId: string): DrawerSnapshot | null {
  return useDrawerSnapshots.getState().byServer[serverId] ?? null;
}

/** Keeps the values that the host sent. A value that did not change renders nothing. */
export function rememberDrawerValues(serverId: string, values: DrawerSnapshot): void {
  const { byServer } = useDrawerSnapshots.getState();
  const previous = byServer[serverId] ?? NO_SNAPSHOT;
  const next = { ...previous, ...values };
  if (JSON.stringify(next) === JSON.stringify(previous)) return;
  useDrawerSnapshots.setState({ byServer: { ...byServer, [serverId]: next } });
}

/** The values from the workspace cache. A value that the host already sent in this run stays. */
export function restoreDrawerSnapshot(serverId: string, cached: DrawerSnapshot): void {
  const { byServer } = useDrawerSnapshots.getState();
  useDrawerSnapshots.setState({ byServer: { ...byServer, [serverId]: { ...cached, ...byServer[serverId] } } });
}

export function forgetDrawerSnapshots(serverIds: ReadonlySet<string>): void {
  const { byServer } = useDrawerSnapshots.getState();
  if (![...serverIds].some((id) => id in byServer)) return;
  useDrawerSnapshots.setState({
    byServer: Object.fromEntries(Object.entries(byServer).filter(([id]) => !serverIds.has(id))),
  });
}
