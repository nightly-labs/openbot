import {
  type AcpRegistryInstallInput,
  decodeRegistryEntries,
  decodeRegistryInstallations,
  decodeRegistryInstallResult,
  decodeRegistryOperations,
  parseRegistryId,
  parseRegistryInstall,
  parseRegistryQuery,
} from "@openbot/contracts/ipc";
import { ACP_REGISTRY_CAPABILITY, ACP_REGISTRY_ROUTES } from "@openbot/contracts/team-protocol/acp-registry-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { AcpRegistry } from "../acp-registry";
import { acceptEmpty } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

type RegistryRequestBody = AcpRegistryInstallInput | { query: string } | { registryId: string } | Record<string, never>;

export function acpRegistryIpcHandlers(
  registry: AcpRegistry,
  remoteServers: RemoteServerManager,
): Pick<IpcGroupHandlers, "acpRegistry"> {
  function remote<T>(serverId: string, path: string, decode: (value: unknown) => T, body: RegistryRequestBody) {
    if (!remoteServers.supportsCapability(serverId, ACP_REGISTRY_CAPABILITY))
      throw new Error(sourceText("error.provider.registryUnavailable"));
    return runCauseEffect(remoteServers.request(serverId, path, decode, { method: "POST", body }));
  }
  return {
    acpRegistry: {
      search: scopedHandler(parseRegistryQuery, {
        local: (query) => runCauseEffect(registry.search(query)),
        remote: (query, id) => remote(id, ACP_REGISTRY_ROUTES.search, decodeRegistryEntries, { query }),
      }),
      installed: scopedQueryHandler({
        local: () => runCauseEffect(registry.listInstalled()),
        remote: (id) => remote(id, ACP_REGISTRY_ROUTES.installed, decodeRegistryInstallations, {}),
      }),
      status: scopedQueryHandler({
        local: () => runCauseEffect(registry.status()),
        remote: (id) => remote(id, ACP_REGISTRY_ROUTES.status, decodeRegistryOperations, {}),
      }),
      install: scopedHandler(parseRegistryInstall, {
        local: (input) => runCauseEffect(registry.install(input)),
        remote: (input, id) => remote(id, ACP_REGISTRY_ROUTES.install, decodeRegistryInstallResult, input),
      }),
      cancel: scopedHandler(parseRegistryId, {
        local: (id) => runCauseEffect(registry.cancel(id)),
        remote: (registryId, id) => remote(id, ACP_REGISTRY_ROUTES.cancel, acceptEmpty, { registryId }),
      }),
      remove: scopedHandler(parseRegistryId, {
        local: (id) => runCauseEffect(registry.uninstall(id)),
        remote: (registryId, id) => remote(id, ACP_REGISTRY_ROUTES.remove, acceptEmpty, { registryId }),
      }),
    },
  };
}
