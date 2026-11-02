/**
 * A local server: a second OpenBot server on this computer, which the desktop app starts as a
 * headless child process of itself (`local-servers/local-servers.ts`). It has its own user data
 * directory and its own agent root, so its database, agents, chats and files stay apart from the
 * app's own server. It shows no window and listens only on the loopback Team API.
 *
 * The parent passes the server name and the owner password in the environment. The password is
 * removed from the environment here, before any agent or provider process starts, so that no child
 * of this process can read it.
 */

import { isAbsolute } from "node:path";
import { Effect } from "effect";
import type { HostService } from "./host-service";
import { RemoteWorkflowError } from "./remote-service-effects";
import type { TeamStore } from "./team-store";

/** The username of the one member of a local server. The desktop app logs in as it. */
export const LOCAL_SERVER_OWNER_USERNAME = "owner";
/** The prefix of the one stdout line that tells the parent where the Team API listens. */
export const LOCAL_SERVER_READY_PREFIX = "OPENBOT_LOCAL_SERVER_READY ";

export const LOCAL_SERVER_ENVIRONMENT = {
  child: "OPENBOT_LOCAL_SERVER_CHILD",
  agentRoot: "OPENBOT_LOCAL_SERVER_ROOT",
  name: "OPENBOT_LOCAL_SERVER_NAME",
  secret: "OPENBOT_LOCAL_SERVER_SECRET",
  runtimeRoot: "OPENBOT_LOCAL_SERVER_RUNTIMES",
} as const;

export interface LocalServerChildEnvironment {
  /** The folder that holds the agents of this server, in place of `~/OpenBot`. */
  agentRoot: string;
  /** The name of the server when it is made. A rename later goes through the Team API. */
  serverName: string;
  ownerSecret: string;
  /** The provider CLI store of the desktop app. The servers of one computer share one copy of each CLI. */
  runtimeRoot: string | null;
}

export interface LocalServerReady {
  serverId: string;
  serverName: string;
  apiUrl: string;
  fingerprint: string;
  publicKey: string;
}

/**
 * Returns null unless the desktop app started this process as a local server. An explicit
 * `--user-data-dir` is required, so that a stray variable cannot make the normal app open its own
 * profile without a window.
 */
export function takeLocalServerChildEnvironment(
  environment: NodeJS.ProcessEnv,
  userDataDirectory: string,
): LocalServerChildEnvironment | null {
  const flag = environment[LOCAL_SERVER_ENVIRONMENT.child];
  const agentRoot = environment[LOCAL_SERVER_ENVIRONMENT.agentRoot]?.trim() ?? "";
  const serverName = environment[LOCAL_SERVER_ENVIRONMENT.name]?.trim() ?? "";
  const ownerSecret = environment[LOCAL_SERVER_ENVIRONMENT.secret] ?? "";
  const runtimeRoot = environment[LOCAL_SERVER_ENVIRONMENT.runtimeRoot]?.trim() ?? "";
  for (const name of Object.values(LOCAL_SERVER_ENVIRONMENT)) delete environment[name];
  if (flag !== "1" || !userDataDirectory || !isAbsolute(agentRoot) || !serverName || !ownerSecret) return null;
  return { agentRoot, serverName, ownerSecret, runtimeRoot: isAbsolute(runtimeRoot) ? runtimeRoot : null };
}

/** The ready line holds no secret: the parent knows the password, and the session is made later. */
export function formatLocalServerReady(ready: LocalServerReady): string {
  return `${LOCAL_SERVER_READY_PREFIX}${JSON.stringify(ready)}\n`;
}

export interface StartLocalServerChildOptions {
  environment: LocalServerChildEnvironment;
  teamStore: Pick<TeamStore, "configured" | "configure" | "getIdentity">;
  host: Pick<HostService, "startLoopbackOnly">;
  writeReady: (line: string) => void;
}

/**
 * Makes the owner at the first start, then starts the Team API on loopback only. The store keeps a
 * host with no account owner bound at the next start, so the identity keys stay the same.
 */
export const startLocalServerChild = Effect.fn("LocalServerChild.start")(function* ({
  environment,
  teamStore,
  host,
  writeReady,
}: StartLocalServerChildOptions) {
  if (!teamStore.configured)
    yield* teamStore.configure(environment.serverName, LOCAL_SERVER_OWNER_USERNAME, environment.ownerSecret);
  const status = yield* host.startLoopbackOnly();
  const identity = teamStore.getIdentity();
  // The parent waits for the ready line. An error ends this process now, so the parent does not wait
  // for its time limit.
  if (!identity || !status.apiUrl)
    return yield* new RemoteWorkflowError({ cause: new Error("The local server has no identity or API address.") });
  writeReady(
    formatLocalServerReady({
      serverId: identity.serverId,
      serverName: identity.serverName,
      apiUrl: status.apiUrl,
      fingerprint: identity.fingerprint,
      publicKey: identity.publicKey,
    }),
  );
});
