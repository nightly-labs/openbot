import type { Effect } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
// The server name, logo and app update of one server's host. On a joined server the request goes to
// the host, which answers only an owner or admin and makes the change with the account signed in there.

import {
  decodeHostTailscaleSetup,
  decodeHostUpdateStatus,
  type HostUpdateSettingsChange,
  type HostUpdateStatus,
  LOCAL_SERVER_ID,
  type ServerSummary,
  type TailscaleSetupStatus,
  UPDATE_RESTART_MODES,
  type UpdateHostIdentityInput,
  type UpdateRestartMode,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { HOST_ADMIN_CAPABILITY, HOST_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/host-admin-v1";
import { HOST_TAILSCALE_CAPABILITY, HOST_TAILSCALE_ROUTES } from "@openbot/contracts/team-protocol/host-tailscale-v1";
import { HOST_UPDATE_CAPABILITY, HOST_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-update-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { HostService } from "../host-service";
import { acceptEmpty, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import { type TailscaleLocalState, tailscaleLoginUrl } from "../tailscale-cli";
import { tailscaleSetupStatus } from "../tailscale-setup-status";
import { parseHostUpdateSettings } from "./app-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { parseHostIdentity } from "./server-inputs";
import { withLocalHostSummary } from "./team-handlers";

interface HostAdminRemoteServers {
  list(): ServerSummary[];
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
  refreshIdentity(serverId: string): Effect.Effect<ServerSummary, RemoteWorkflowError>;
}

interface HostAdminIpcDependencies {
  host: Pick<HostService, "updateIdentity">;
  remoteServers: HostAdminRemoteServers;
  /** This computer's Tailscale client, compared with the host's in the owner's Tailscale setup. */
  localTailscale: () => Effect.Effect<TailscaleLocalState>;
  /** Opens the host's Tailscale sign-in page in the browser. */
  openTailscaleSignIn: (url: string) => Promise<void>;
}

/** The body of a `host-update-v1` route: `start` carries the mode, `settings` the switches. */
type HostUpdateBody = Record<string, never> | { restart: UpdateRestartMode } | HostUpdateSettingsChange;

export function hostAdminIpcHandlers({
  host,
  remoteServers,
  localTailscale,
  openTailscaleSignIn,
}: HostAdminIpcDependencies): Pick<IpcGroupHandlers, "hostAdmin"> {
  /** The host answers only its owner. A host without the capability asks the owner to update it. */
  async function remoteTailscale(
    serverId: string,
    route: string,
    body: Record<string, never> | { enabled: boolean },
  ): Promise<TailscaleSetupStatus> {
    if (!remoteServers.supportsCapability(serverId, HOST_TAILSCALE_CAPABILITY))
      throw new Error(sourceText("error.team.hostTailscaleUnsupported"));
    const [hostSetup, local] = await Promise.all([
      runCauseEffect(remoteServers.request(serverId, route, decodeHostTailscaleSetup, { method: "POST", body })),
      runCauseEffect(localTailscale()),
    ]);
    return tailscaleSetupStatus(local, hostSetup);
  }
  // This computer has its own Tailscale section. The renderer shows the setup for a joined server only.
  const localTailscaleSetup = (): never => {
    throw new Error(sourceText("error.team.hostTailscaleUnsupported"));
  };
  function remoteUpdate(serverId: string, route: string, body: HostUpdateBody): Promise<HostUpdateStatus> {
    if (!remoteServers.supportsCapability(serverId, HOST_UPDATE_CAPABILITY))
      throw new Error(sourceText("error.team.hostUpdateUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decodeHostUpdateStatus, { method: "POST", body }));
  }
  // This computer updates from Settings. The renderer shows the tab for a joined server only.
  const localUpdate = (): never => {
    throw new Error(sourceText("error.team.hostUpdateUnsupported"));
  };
  return {
    hostAdmin: {
      updateIdentity: scopedHandler(parseHostIdentity, {
        local: async (input) => {
          const status = await runCauseEffect(host.updateIdentity(input));
          const summary = withLocalHostSummary(remoteServers.list(), status).find(
            (server) => server.id === LOCAL_SERVER_ID,
          );
          if (!summary) throw new Error(sourceText("error.host.noServer"));
          return summary;
        },
        remote: async (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, HOST_ADMIN_CAPABILITY))
            throw new Error(sourceText("error.host.identityLocalOnly"));
          await runCauseEffect(
            remoteServers.request(serverId, HOST_ADMIN_ROUTES.identity, acceptEmpty, {
              method: "POST",
              body: wireIdentity(input),
            }),
          );
          // The host has published the change before it answered, so this reads the new name and logo.
          return runCauseEffect(remoteServers.refreshIdentity(serverId));
        },
      }),
      getUpdateStatus: scopedQueryHandler({
        local: localUpdate,
        remote: (serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.status, {}),
      }),
      checkForUpdate: scopedQueryHandler({
        local: localUpdate,
        remote: (serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.check, {}),
      }),
      startUpdate: scopedHandler(parseRestartMode, {
        local: localUpdate,
        remote: (restart, serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.start, { restart }),
      }),
      cancelUpdate: scopedQueryHandler({
        local: localUpdate,
        remote: (serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.cancel, {}),
      }),
      setUpdateSettings: scopedHandler(parseHostUpdateSettings, {
        local: localUpdate,
        remote: (settings, serverId) => remoteUpdate(serverId, HOST_UPDATE_ROUTES.settings, settings),
      }),
      getTailscaleSetup: scopedQueryHandler({
        local: localTailscaleSetup,
        remote: (serverId) => remoteTailscale(serverId, HOST_TAILSCALE_ROUTES.status, {}),
      }),
      setTailscaleDirect: scopedHandler(parseEnabled, {
        local: localTailscaleSetup,
        remote: (enabled, serverId) => remoteTailscale(serverId, HOST_TAILSCALE_ROUTES.direct, { enabled }),
      }),
      startTailscaleSignIn: scopedQueryHandler({
        local: localTailscaleSetup,
        remote: async (serverId) => {
          const status = await remoteTailscale(serverId, HOST_TAILSCALE_ROUTES.signIn, {});
          // The codec accepts only the Tailscale sign-in page; this checks it again before a browser opens.
          const url = tailscaleLoginUrl(status.host.loginUrl);
          if (url) await openTailscaleSignIn(url);
          return status;
        },
      }),
    },
  };
}

function wireIdentity(input: UpdateHostIdentityInput) {
  return {
    ...(input.serverName === undefined ? {} : { serverName: input.serverName }),
    ...(input.logo === undefined
      ? {}
      : {
          logo: input.logo
            ? { mimeType: input.logo.mimeType, data: Buffer.from(input.logo.bytes).toString("base64") }
            : null,
        }),
  };
}

function parseEnabled(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("enabled must be a boolean.");
  return value;
}

function parseRestartMode(value: unknown): UpdateRestartMode {
  if (!isOneOf(UPDATE_RESTART_MODES, value)) throw new Error("A restart mode is required.");
  return value;
}
