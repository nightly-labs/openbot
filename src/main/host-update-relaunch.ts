import { join } from "node:path";
import { Effect } from "effect";
import { HOST_MANAGER_DIRECTORY, hostStateSchema, readHostConfig, readOwnedJson } from "./host-update-files";
import { RemoteWorkflowError, remoteCall } from "./remote-service-effects";

interface RelaunchOperations {
  runningTenants: () => Promise<Array<{ uid: number; pid: number }>>;
  installedVersion: () => Promise<string>;
  open: () => Promise<void>;
}
export const relaunchManagedTenant = Effect.fn("HostUpdate.relaunchTenant")(function* (
  uid: number,
  operations: RelaunchOperations,
  directory = HOST_MANAGER_DIRECTORY,
  hostUid = 0,
) {
  const config = yield* readHostConfig(directory, hostUid).pipe(
    Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })),
  );
  if (!config?.managed || !config.tenants.includes(uid)) return;
  const state = yield* readOwnedJson(join(directory, "state.json"), hostUid, hostStateSchema).pipe(
    Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })),
  );
  if ((state.phase !== "released" && state.phase !== "aborted") || !state.version) return;
  if ((yield* remoteCall(operations.runningTenants)).some((running) => running.uid === uid)) return;
  if ((yield* remoteCall(operations.installedVersion)) !== state.version)
    return yield* new RemoteWorkflowError({ cause: new Error("Installed release does not match host state.") });
  // Recheck the control state after potentially slow signature verification.
  const latest = yield* readOwnedJson(join(directory, "state.json"), hostUid, hostStateSchema).pipe(
    Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })),
  );
  const latestConfig = yield* readHostConfig(directory, hostUid).pipe(
    Effect.mapError(({ cause }) => new RemoteWorkflowError({ cause })),
  );
  if (
    !latestConfig?.managed ||
    !latestConfig.tenants.includes(uid) ||
    latest.phase !== state.phase ||
    latest.cycle !== state.cycle ||
    latest.version !== state.version
  )
    return;
  yield* remoteCall(operations.open);
});
