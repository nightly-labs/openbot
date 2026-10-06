import { Effect, Result } from "effect";
/**
 * Everything `OPENBOT_DEV_REMOTE_ROLE` adds to startup: signing a throwaway account in against the
 * local account API, configuring the dev host, and handing the client the connection the host wrote
 * to a file in the dev runtime directory. None of it runs in a packaged build - `developmentRemoteRole`
 * is null unless the app is unpackaged and the variable is set to `host` or `client`.
 *
 * The two entry points below keep the positions they had in the construction sequence:
 * `applyDevelopmentRemoteAccount` must run after `teamStore.initialize()` and before `HostService`
 * is built, and `startDevelopmentRemoteRole` after `remoteServers.initialize()`. The client half
 * polls for thirty seconds and then throws, deliberately: a dev client with no remote server is a
 * failure worth seeing at startup rather than an empty window.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { CentralAuthManager } from "./central-auth-manager";
import { developmentRemoteConnectionPath } from "./development-runtime-directory";
import { DEVELOPMENT_REMOTE_CLIENT_USERNAME, type HostService } from "./host-service";
import type { DevelopmentRemoteServerConnection, RemoteServerManager } from "./remote-server-manager";
import { RemoteWorkflowError, remoteCall, remoteDecode } from "./remote-service-effects";
import { writeSetupState } from "./setup-store";
import type { TeamStore } from "./team-store";

export type DevelopmentRemoteRole = "host" | "client";

const developmentRemoteServerConnectionSchema: z.ZodType<DevelopmentRemoteServerConnection> = z.object({
  serverId: z.string().min(1),
  serverName: z.string().min(1),
  apiUrl: z.string().min(1),
  fingerprint: z.string().min(1),
  publicKey: z.string().min(1),
  username: z.string().min(1),
  sessionToken: z.string().min(1),
});

export interface DevelopmentRemoteAccountOptions {
  role: DevelopmentRemoteRole;
  testClientEnabled: boolean;
  centralAuth: CentralAuthManager;
  teamStore: TeamStore;
  setupFile: string;
  setupCompleted: boolean;
}

export const applyDevelopmentRemoteAccount = Effect.fn("DevelopmentRemote.applyAccount")(function* ({
  role,
  testClientEnabled,
  centralAuth,
  teamStore,
  setupFile,
  setupCompleted,
}: DevelopmentRemoteAccountOptions) {
  const email =
    role === "host" ? (teamStore.getOwnerEmail() ?? "openbot-dev-host@example.com") : "openbot-dev-client@example.com";
  const user = yield* ensureDevelopmentAccount(centralAuth, email);
  yield* teamStore.activateAccount(user);
  if (role === "host" && !teamStore.configured) {
    yield* teamStore.configureWithAccount("OpenBot Local Dev Host", user);
  }
  if (role === "client" && !setupCompleted) {
    yield* writeSetupState(setupFile, { preferredProvider: "codex", preferredModel: null }).pipe(
      Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause })),
    );
  }
  if (role === "host" && !testClientEnabled) {
    const technicalMember = teamStore
      .listMembers()
      .find((member) => member.username === DEVELOPMENT_REMOTE_CLIENT_USERNAME);
    if (technicalMember && technicalMember.role !== "owner") {
      yield* teamStore.removeMember(technicalMember.id);
    }
  }
});

export interface DevelopmentRemoteRoleOptions {
  role: DevelopmentRemoteRole;
  testClientEnabled: boolean;
  host: HostService;
  remoteServers: RemoteServerManager;
}

export const startDevelopmentRemoteRole = Effect.fn("DevelopmentRemote.startRole")(function* ({
  role,
  testClientEnabled,
  host,
  remoteServers,
}: DevelopmentRemoteRoleOptions) {
  if (role === "host") {
    yield* remoteCall(() => rm(developmentRemoteConnectionPath(), { force: true }));
    const status = yield* host.start();
    if (status.phase !== "online") yield* host.startDevelopmentLocal();
    if (testClientEnabled) yield* writeDevelopmentRemoteConnection(yield* host.createDevelopmentConnection());
    return;
  }
  yield* connectDevelopmentRemoteServer(remoteServers);
});

export const ensureDevelopmentAccount = Effect.fn("DevelopmentRemote.ensureAccount")(function* (
  manager: Pick<CentralAuthManager, "initialize" | "logout" | "requestEmailCode" | "verifyEmailCode">,
  email: string,
) {
  const initialized = yield* manager
    .initialize()
    .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause })));
  if (initialized.status === "signed_in" && initialized.user.email === email) return initialized.user;
  if (initialized.status === "signed_in")
    yield* manager.logout().pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause })));
  let challenge = yield* manager
    .requestEmailCode(email)
    .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause })));
  if (
    challenge.status === "error" &&
    challenge.issue.code === "code_recently_sent" &&
    challenge.issue.retryAfterSeconds !== undefined &&
    challenge.issue.retryAfterSeconds > 0 &&
    challenge.issue.retryAfterSeconds <= 60
  ) {
    yield* Effect.sleep(challenge.issue.retryAfterSeconds * 1000);
    challenge = yield* manager
      .requestEmailCode(email)
      .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause })));
  }
  if (challenge.status === "error")
    return yield* new RemoteWorkflowError({ cause: new Error(challenge.issue.message) });
  if (challenge.status !== "code_sent" || !challenge.developmentCode)
    return yield* new RemoteWorkflowError({
      cause: new Error("The local account API did not return a development sign-in code."),
    });
  const verified = yield* manager
    .verifyEmailCode(challenge.challengeId, challenge.developmentCode)
    .pipe(Effect.mapError((error) => new RemoteWorkflowError({ cause: error.cause })));
  if (verified.status === "error") return yield* new RemoteWorkflowError({ cause: new Error(verified.issue.message) });
  if (verified.status !== "signed_in")
    return yield* new RemoteWorkflowError({ cause: new Error("The local development account could not sign in.") });
  return verified.user;
});

const writeDevelopmentRemoteConnection = Effect.fn("DevelopmentRemote.writeConnection")(
  (connection: DevelopmentRemoteServerConnection) =>
    remoteCall(async () => {
      const path = developmentRemoteConnectionPath();
      // `bun run dev` has already made the runtime directory owner-only; this covers a start without it.
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, `${JSON.stringify(connection)}\n`, { encoding: "utf8", mode: 0o600 });
    }),
);

const connectDevelopmentRemoteServer = Effect.fn("DevelopmentRemote.connect")(function* (manager: RemoteServerManager) {
  const deadline = Date.now() + 30_000;
  let lastError: RemoteWorkflowError = new RemoteWorkflowError({
    cause: new Error("The local development host did not start."),
  });
  while (Date.now() < deadline) {
    const attempt = yield* Effect.gen(function* () {
      const text = yield* remoteCall(() => readFile(developmentRemoteConnectionPath(), "utf8"));
      const connection = yield* remoteDecode(() => developmentRemoteServerConnectionSchema.parse(JSON.parse(text)));
      yield* manager.connectDevelopmentServer(connection);
    }).pipe(Effect.result);
    if (Result.isSuccess(attempt)) return;
    lastError = attempt.failure;
    yield* Effect.sleep(250);
  }
  return yield* lastError;
});
