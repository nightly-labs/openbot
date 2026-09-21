import { join } from "node:path";
import { HOST_MANAGER_DIRECTORY, hostStateSchema, readHostConfig, readOwnedJson } from "./host-update-files";

interface RelaunchOperations {
  runningTenants: () => Promise<Array<{ uid: number; pid: number }>>;
  installedVersion: () => Promise<string>;
  open: () => Promise<void>;
}

/** Called only by a per-user Aqua LaunchAgent; never switches UID or starts another user's app. */
export async function relaunchManagedTenant(
  uid: number,
  operations: RelaunchOperations,
  directory = HOST_MANAGER_DIRECTORY,
  hostUid = 0,
): Promise<void> {
  const config = await readHostConfig(directory, hostUid);
  if (!config?.managed || !config.tenants.includes(uid)) return;
  const state = await readOwnedJson(join(directory, "state.json"), hostUid, hostStateSchema);
  if ((state.phase !== "released" && state.phase !== "aborted") || !state.version) return;
  if ((await operations.runningTenants()).some((running) => running.uid === uid)) return;
  if ((await operations.installedVersion()) !== state.version)
    throw new Error("Installed release does not match host state.");
  // Recheck the control state after potentially slow signature verification.
  const latest = await readOwnedJson(join(directory, "state.json"), hostUid, hostStateSchema);
  const latestConfig = await readHostConfig(directory, hostUid);
  if (
    !latestConfig?.managed ||
    !latestConfig.tenants.includes(uid) ||
    latest.phase !== state.phase ||
    latest.cycle !== state.cycle ||
    latest.version !== state.version
  )
    return;
  await operations.open();
}
