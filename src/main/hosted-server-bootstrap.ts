import { existsSync } from "node:fs";
import { serverStorageGb } from "@openbot/contracts/billing";
import { parseHostedServerList } from "@openbot/contracts/hosted-servers";
import type { CentralAuthState, CentralAuthUser } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { CentralAuthManager } from "./central-auth-manager";
import { RemoteWorkflowError, toRemoteWorkflowError } from "./remote-service-effects";
import type { TeamStore } from "./team-store";

const HOST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface HostedServerEnvironment {
  hostId: string;
  claim: string | null;
}

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

const RESTORE_ACTIVE = "/var/lib/ascii-lazy/active";
const RESTORE_DONE = "/var/lib/ascii-lazy/hydration-done";

export function hostedDiskRestoreProbe(): () => boolean {
  let done = false;
  return () => {
    if (done) return false;
    done = existsSync(RESTORE_DONE);
    return !done && existsSync(RESTORE_ACTIVE);
  };
}

export interface HostedServerAccountOptions {
  environment: HostedServerEnvironment;
  centralAuth: Pick<CentralAuthManager, "canPersistSession" | "redeemHostedServerClaim" | "requestAuthorized">;
  centralAuthInitialization: Effect.Effect<CentralAuthState, RemoteWorkflowError>;
  teamStore: Pick<
    TeamStore,
    "activateAccount" | "configured" | "configureWithAccount" | "getIdentity" | "setEnabledOnLaunch"
  >;
}

export const applyHostedServerAccount = Effect.fn("HostedServer.applyAccount")(function* ({
  environment,
  centralAuth,
  centralAuthInitialization,
  teamStore,
}: HostedServerAccountOptions) {
  const state = yield* centralAuthInitialization;
  let user: CentralAuthUser;
  let serverName: string | null = null;
  if (state.status === "signed_in") {
    user = state.user;
  } else {
    if (state.status === "error")
      return yield* new RemoteWorkflowError({ cause: new Error("The account server did not answer at the start.") });
    if (!environment.claim)
      return yield* new RemoteWorkflowError({ cause: new Error("The hosted server is signed out and has no claim.") });
    if (!centralAuth.canPersistSession())
      return yield* new RemoteWorkflowError({
        cause: new Error("The hosted server has no secret storage for its session."),
      });
    const claim = environment.claim;
    const redeemed = yield* centralAuth.redeemHostedServerClaim(claim).pipe(toRemoteWorkflowError);
    if (redeemed.hostId !== environment.hostId)
      return yield* new RemoteWorkflowError({ cause: new Error("The claim is for a different hosted server.") });
    user = redeemed.user;
    serverName = redeemed.name;
  }
  yield* teamStore.activateAccount(user);
  if (!teamStore.configured) {
    serverName ??= yield* hostedServerName(centralAuth, environment.hostId);
    const name = serverName;
    yield* teamStore.configureWithAccount(name, user, undefined, { serverId: environment.hostId });
  }
  const identity = teamStore.getIdentity();
  if (identity?.serverId !== environment.hostId) {
    return yield* new RemoteWorkflowError({
      cause: new Error("The configured host is not the hosted server that this VM was created for."),
    });
  }
  if (!identity.enabledOnLaunch) yield* teamStore.setEnabledOnLaunch(identity.serverId, true);
});

const hostedServerRecord = Effect.fn("HostedServer.record")(function* (
  centralAuth: Pick<CentralAuthManager, "requestAuthorized">,
  hostId: string,
) {
  const list = yield* centralAuth
    .requestAuthorized("/v2/hosting/servers/", { method: "GET" }, (value) => {
      const parsed = parseHostedServerList(value);
      if (!parsed) throw new Error("Invalid hosted server list.");
      return parsed;
    })
    .pipe(toRemoteWorkflowError);
  return list.servers.find((entry) => entry.serverId === hostId) ?? null;
});

const hostedServerName = Effect.fn("HostedServer.name")(function* (
  centralAuth: Pick<CentralAuthManager, "requestAuthorized">,
  hostId: string,
) {
  const server = yield* hostedServerRecord(centralAuth, hostId);
  if (!server)
    return yield* new RemoteWorkflowError({
      cause: new Error("The account server has no record of this hosted server."),
    });
  return server.name;
});

export const hostedServerStorageGb = Effect.fn("HostedServer.storageGb")(function* (
  centralAuth: Pick<CentralAuthManager, "requestAuthorized">,
  hostId: string,
) {
  const server = yield* hostedServerRecord(centralAuth, hostId);
  return server ? serverStorageGb(server) : null;
});
