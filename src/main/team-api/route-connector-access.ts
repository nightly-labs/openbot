import { parseConnectorAccessChange } from "@openbot/contracts/ipc";
import {
  CONNECTOR_ACCESS_CAPABILITY,
  CONNECTOR_ACCESS_ROUTES,
} from "@openbot/contracts/team-protocol/connector-access-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import type { AgentService } from "../../backend/agent-service";
import { ConnectorAccessRefused, ConnectorAccessStale, type ConnectorAccessStore } from "../connector-access-store";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";
export async function routeConnectorAccess(
  context: TeamApiRequestContext,
  access: ConnectorAccessStore | undefined,
  service: Pick<AgentService, "listMcpServers" | "revokeConnectorSessions"> | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, json, member, request } = context;
  if (
    method !== "POST" ||
    (url.pathname !== CONNECTOR_ACCESS_ROUTES.read && url.pathname !== CONNECTOR_ACCESS_ROUTES.set)
  )
    return "unmatched";
  requireAdmin(member);
  if (!access || !service || !capabilities.has(CONNECTOR_ACCESS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.connectorAccessUnsupported"));
  if (url.pathname === CONNECTOR_ACCESS_ROUTES.set) {
    const change = parseConnectorAccessChange(await readJson(request));
    const saved = await Effect.runPromise(Effect.result(access.set(change, () => service.revokeConnectorSessions())));
    if (Result.isFailure(saved)) {
      if (saved.failure instanceof ConnectorAccessRefused) throw new HttpError(400, saved.failure.reason);
      if (saved.failure instanceof ConnectorAccessStale)
        throw new HttpError(409, sourceText("error.team.connectorAccessStale"));
      throw saved.failure;
    }
  } else await readJson(request);
  return json(200, access.snapshot(service.listMcpServers()));
}
