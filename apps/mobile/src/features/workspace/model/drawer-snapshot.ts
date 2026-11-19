import type { WorkflowSummary } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { decodeRemoteWorkflowSummary } from "@openbot/team-client/workflow-decoding";
import { create } from "zustand";

export interface DrawerSnapshot {
  memberCount?: number;
  usageUsd?: number | null;
  routineRuns?: string[];
  tasks?: { unread: number; working: number } | null;
  workflows?: { needsYou: number; running: number; pinned: WorkflowSummary[] } | null;
}

export const DRAWER_ROUTINE_RUNS = 12;

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

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
    } catch {}
  }
  return snapshot;
}

const NO_SNAPSHOT: DrawerSnapshot = {};

const useDrawerSnapshots = create<{ scope: string | null; byServer: Readonly<Record<string, DrawerSnapshot>> }>(() => ({
  scope: null,
  byServer: {},
}));

export function startDrawerSnapshots(scope: string | null): void {
  if (useDrawerSnapshots.getState().scope !== scope) useDrawerSnapshots.setState({ scope, byServer: {} });
}

export function useDrawerSnapshot(serverId: string): DrawerSnapshot {
  return useDrawerSnapshots((state) => state.byServer[serverId] ?? NO_SNAPSHOT);
}

export function drawerSnapshot(serverId: string): DrawerSnapshot | null {
  return useDrawerSnapshots.getState().byServer[serverId] ?? null;
}

export function rememberDrawerValues(serverId: string, values: DrawerSnapshot): void {
  const { byServer } = useDrawerSnapshots.getState();
  const previous = byServer[serverId] ?? NO_SNAPSHOT;
  const next = { ...previous, ...values };
  if (JSON.stringify(next) === JSON.stringify(previous)) return;
  useDrawerSnapshots.setState({ byServer: { ...byServer, [serverId]: next } });
}

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
