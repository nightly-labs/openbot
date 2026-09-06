/**
 * Everything `OPENBOT_DEV_REMOTE_ROLE` adds to startup: signing a throwaway account in against the
 * local account API, configuring the dev host, and handing the client the connection the host wrote
 * to a temporary file. None of it runs in a packaged build - `developmentRemoteRole` is null unless
 * the app is unpackaged and the variable is set to `host` or `client`.
 *
 * The two entry points below keep the positions they had in the construction sequence:
 * `applyDevelopmentRemoteAccount` must run after `teamStore.initialize()` and before `HostService`
 * is built, and `startDevelopmentRemoteRole` after `remoteServers.initialize()`. The client half
 * polls for thirty seconds and then throws, deliberately: a dev client with no remote server is a
 * failure worth seeing at startup rather than an empty window.
 */

import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { CentralAuthManager } from "./central-auth-manager";
import { DEVELOPMENT_REMOTE_CLIENT_USERNAME, type HostService } from "./host-service";
import type { DevelopmentRemoteServerConnection, RemoteServerManager } from "./remote-server-manager";
import { writeSetupState } from "./setup-store";
import type { TeamStore } from "./team-store";

export type DevelopmentRemoteRole = "host" | "client";

const DEVELOPMENT_REMOTE_CONNECTION_FILE = "openbot-dev-remote-connection-v1.json";
const developmentRemoteServerConnectionSchema: z.ZodType<DevelopmentRemoteServerConnection> = z.object({
  serverId: z.string().min(1),
  serverName: z.string().min(1),
  apiUrl: z.string().min(1),
  fingerprint: z.string().min(1),
  publicKey: z.string().min(1),
  username: z.string().min(1),
  sessionToken: z.string().min(1),
});

function developmentRemoteConnectionPath(): string {
  return join(tmpdir(), DEVELOPMENT_REMOTE_CONNECTION_FILE);
}

export interface DevelopmentRemoteAccountOptions {
  role: DevelopmentRemoteRole;
  testClientEnabled: boolean;
  centralAuth: CentralAuthManager;
  teamStore: TeamStore;
  setupFile: string;
  setupCompleted: boolean;
}

export async function applyDevelopmentRemoteAccount({
  role,
  testClientEnabled,
  centralAuth,
  teamStore,
  setupFile,
  setupCompleted,
}: DevelopmentRemoteAccountOptions): Promise<void> {
  const email =
    role === "host" ? (teamStore.getOwnerEmail() ?? "openbot-dev-host@example.com") : "openbot-dev-client@example.com";
  const user = await ensureDevelopmentAccount(centralAuth, email);
  await teamStore.activateAccount(user);
  if (role === "host" && !teamStore.configured) {
    await teamStore.configureWithAccount("OpenBot Local Dev Host", user);
  }
  if (role === "client" && !setupCompleted) {
    await writeSetupState(setupFile, "codex");
  }
  if (role === "host" && !testClientEnabled) {
    const technicalMember = teamStore
      .listMembers()
      .find((member) => member.username === DEVELOPMENT_REMOTE_CLIENT_USERNAME);
    if (technicalMember && technicalMember.role !== "owner") {
      await teamStore.removeMember(technicalMember.id);
    }
  }
}

export interface DevelopmentRemoteRoleOptions {
  role: DevelopmentRemoteRole;
  testClientEnabled: boolean;
  host: HostService;
  remoteServers: RemoteServerManager;
}

export async function startDevelopmentRemoteRole({
  role,
  testClientEnabled,
  host,
  remoteServers,
}: DevelopmentRemoteRoleOptions): Promise<void> {
  if (role === "host") {
    await rm(developmentRemoteConnectionPath(), { force: true });
    await host.startDevelopmentLocal();
    if (testClientEnabled) {
      await writeDevelopmentRemoteConnection(await host.createDevelopmentConnection());
    }
    return;
  }
  await connectDevelopmentRemoteServer(remoteServers);
}

async function ensureDevelopmentAccount(manager: CentralAuthManager, email: string) {
  const initialized = await manager.initialize();
  if (initialized.status === "signed_in" && initialized.user.email === email) return initialized.user;
  if (initialized.status === "signed_in") await manager.logout();
  const challenge = await manager.requestEmailCode(email);
  if (challenge.status !== "code_sent" || !challenge.developmentCode) {
    throw new Error("The local account API did not return a development sign-in code.");
  }
  const verified = await manager.verifyEmailCode(challenge.challengeId, challenge.developmentCode);
  if (verified.status !== "signed_in") throw new Error("The local development account could not sign in.");
  return verified.user;
}

async function writeDevelopmentRemoteConnection(connection: DevelopmentRemoteServerConnection): Promise<void> {
  await writeFile(developmentRemoteConnectionPath(), `${JSON.stringify(connection)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function connectDevelopmentRemoteServer(manager: RemoteServerManager): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown = new Error("The local development host did not start.");
  while (Date.now() < deadline) {
    try {
      const connection = developmentRemoteServerConnectionSchema.parse(
        JSON.parse(await readFile(developmentRemoteConnectionPath(), "utf8")),
      );
      await manager.connectDevelopmentServer(connection);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  throw lastError;
}
