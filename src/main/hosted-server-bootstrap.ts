/**
 * The first start of a hosted server: a VM that the account server created for one account. It runs
 * only in a packaged Linux build that the server template starts with `OPENBOT_HOSTED_SERVER=1`.
 *
 * The VM gets a host ID and a single-use claim. The claim becomes the owner's account session, and
 * the host is configured with the ID that the account server reserved for that owner. It then
 * publishes at launch like any other host. Nothing here goes through IPC: the renderer never sees
 * the claim or the session.
 *
 * `applyHostedServerAccount` must run after `teamStore.initialize()` and before `HostService` is
 * built, at the same position as `applyDevelopmentRemoteAccount`.
 */

import { parseHostedServerList } from "@openbot/contracts/hosted-servers";
import type { CentralAuthState, CentralAuthUser } from "@openbot/contracts/ipc";
import type { CentralAuthManager } from "./central-auth-manager";
import type { TeamStore } from "./team-store";

const HOST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface HostedServerEnvironment {
  hostId: string;
  /** Null after the first start: the claim is spent, and the stored session signs the server in. */
  claim: string | null;
}

/**
 * Returns null unless this process is a hosted server. It removes the claim from `environment`,
 * because agents and their tools inherit the environment of this process.
 */
export function takeHostedServerEnvironment(
  environment: NodeJS.ProcessEnv,
  isPackaged: boolean,
  platform: NodeJS.Platform,
): HostedServerEnvironment | null {
  const claim = environment.OPENBOT_HOSTED_CLAIM?.trim() || null;
  delete environment.OPENBOT_HOSTED_CLAIM;
  if (!isPackaged || platform !== "linux" || environment.OPENBOT_HOSTED_SERVER !== "1") return null;
  const hostId = environment.OPENBOT_HOSTED_HOST_ID?.trim().toLowerCase() ?? "";
  if (!HOST_ID_PATTERN.test(hostId)) return null;
  return { hostId, claim };
}

export interface HostedServerAccountOptions {
  environment: HostedServerEnvironment;
  centralAuth: Pick<CentralAuthManager, "canPersistSession" | "redeemHostedServerClaim" | "requestAuthorized">;
  centralAuthInitialization: Promise<CentralAuthState>;
  teamStore: Pick<
    TeamStore,
    "activateAccount" | "configured" | "configureWithAccount" | "getIdentity" | "setEnabledOnLaunch"
  >;
}

export async function applyHostedServerAccount({
  environment,
  centralAuth,
  centralAuthInitialization,
  teamStore,
}: HostedServerAccountOptions): Promise<void> {
  const state = await centralAuthInitialization;
  let user: CentralAuthUser;
  let serverName: string | null = null;
  if (state.status === "signed_in") {
    user = state.user;
  } else {
    // The account server did not answer. A stored session can still exist and the claim can be spent,
    // so the claim waits for an answer. The start retry signs in again.
    if (state.status === "error") throw new Error("The account server did not answer at the start.");
    if (!environment.claim) throw new Error("The hosted server is signed out and has no claim.");
    // The claim works one time. With no secret storage the session would end at the next start, and
    // the server could not sign in again. Keep the claim for a start that has a keyring.
    if (!centralAuth.canPersistSession()) throw new Error("The hosted server has no secret storage for its session.");
    const redeemed = await centralAuth.redeemHostedServerClaim(environment.claim);
    if (redeemed.hostId !== environment.hostId) throw new Error("The claim is for a different hosted server.");
    user = redeemed.user;
    serverName = redeemed.name;
  }
  await teamStore.activateAccount(user);
  if (!teamStore.configured) {
    // A start that stopped after the claim and before this point has a session and no name.
    serverName ??= await hostedServerName(centralAuth, environment.hostId);
    await teamStore.configureWithAccount(serverName, user, undefined, { serverId: environment.hostId });
  }
  const identity = teamStore.getIdentity();
  if (identity?.serverId !== environment.hostId) {
    throw new Error("The configured host is not the hosted server that this VM was created for.");
  }
  if (!identity.enabledOnLaunch) await teamStore.setEnabledOnLaunch(identity.serverId, true);
}

async function hostedServerName(
  centralAuth: Pick<CentralAuthManager, "requestAuthorized">,
  hostId: string,
): Promise<string> {
  const list = await centralAuth.requestAuthorized("/v2/hosting/servers/", { method: "GET" }, (value) => {
    const parsed = parseHostedServerList(value);
    if (!parsed) throw new Error("Invalid hosted server list.");
    return parsed;
  });
  const server = list.servers.find((entry) => entry.serverId === hostId);
  if (!server) throw new Error("The account server has no record of this hosted server.");
  return server.name;
}
