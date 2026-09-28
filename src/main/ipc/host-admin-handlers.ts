// The server name, logo and app update of one server's host. On a joined server the request goes to
// the host, which answers only an owner or admin and makes the change with the account signed in there.

import {
  decodeHostUpdateStatus,
  type HostUpdateSettingsChange,
  type HostUpdateStatus,
  LOCAL_SERVER_ID,
  type ServerSummary,
  type UpdateHostIdentityInput,
  type UpdateRestartMode,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { HOST_ADMIN_CAPABILITY, HOST_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/host-admin-v1";
import { HOST_UPDATE_CAPABILITY, HOST_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-update-v1";
import { sourceText } from "@openbot/i18n/source";
import type { HostService } from "../host-service";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import { parseHostUpdateSettings } from "./app-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { parseHostIdentity } from "./server-inputs";
import { withLocalHostSummary } from "./team-handlers";

interface HostAdminRemoteServers {
  list(): ServerSummary[];
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, init?: RemoteRequestInit): Promise<T>;
  refreshIdentity(serverId: string): Promise<ServerSummary>;
}

interface HostAdminIpcDependencies {
  host: Pick<HostService, "updateIdentity">;
  remoteServers: HostAdminRemoteServers;
}

// The host-admin-v1 codec has already checked the empty reply.
const acceptEmpty = (): undefined => undefined;

/** The body of a `host-update-v1` route: `start` carries the mode, `settings` the switches. */
type HostUpdateBody = Record<string, never> | { restart: UpdateRestartMode } | HostUpdateSettingsChange;

export function hostAdminIpcHandlers({
  host,
  remoteServers,
}: HostAdminIpcDependencies): Pick<IpcGroupHandlers, "hostAdmin"> {
  function remoteUpdate(serverId: string, route: string, body: HostUpdateBody): Promise<HostUpdateStatus> {
    if (!remoteServers.supportsCapability(serverId, HOST_UPDATE_CAPABILITY))
      throw new Error(sourceText("error.team.hostUpdateUnsupported"));
    return remoteServers.request(serverId, route, decodeHostUpdateStatus, { method: "POST", body });
  }
  // This computer updates from Settings. The renderer shows the tab for a joined server only.
  const localUpdate = (): never => {
    throw new Error(sourceText("error.team.hostUpdateUnsupported"));
  };
  return {
    hostAdmin: {
      updateIdentity: scopedHandler(parseHostIdentity, {
        local: async (input) => {
          const status = await host.updateIdentity(input);
          const summary = withLocalHostSummary(remoteServers.list(), status).find(
            (server) => server.id === LOCAL_SERVER_ID,
          );
          if (!summary) throw new Error(sourceText("error.host.noServer"));
          return summary;
        },
        remote: async (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, HOST_ADMIN_CAPABILITY))
            throw new Error(sourceText("error.host.identityLocalOnly"));
          await remoteServers.request(serverId, HOST_ADMIN_ROUTES.identity, acceptEmpty, {
            method: "POST",
            body: wireIdentity(input),
          });
          // The host has published the change before it answered, so this reads the new name and logo.
          return remoteServers.refreshIdentity(serverId);
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

function parseRestartMode(value: unknown): UpdateRestartMode {
  if (!isOneOf(["when-idle", "now"] as const, value)) throw new Error("A restart mode is required.");
  return value;
}
