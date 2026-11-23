import type { ServerSummary } from "@openbot/contracts/ipc";
import { CONNECTORS, type ConnectorId } from "@openbot/ui/features/connectors/connectors";
import { remoteAdminServer } from "../servers/server-capabilities";

export type ConnectorAccess = "available" | "local-only" | "hidden";

export function connectorAccess(id: ConnectorId, server: ServerSummary | undefined): ConnectorAccess {
  if (!server) return "hidden";
  if (server.kind === "local") return "available";
  const capability = CONNECTORS[id].server;
  if (capability === null) return "local-only";
  return remoteAdminServer(server, capability) ? "available" : "hidden";
}
