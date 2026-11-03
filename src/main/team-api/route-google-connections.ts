import {
  parseGoogleConnectionAssign,
  parseGoogleConnectionConfigure,
  parseGoogleConnectionFlow,
  parseGoogleConnectionProfile,
} from "@openbot/contracts/ipc";
import {
  GOOGLE_CONNECTIONS_CAPABILITY,
  GOOGLE_CONNECTIONS_ROUTES as R,
} from "@openbot/contracts/team-protocol/google-connections-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { ConnectorAccessRefused } from "../connector-access-store";
import type { GoogleConnectionsService } from "../google-connections-service";
import { GoogleConnectionsFailure, googleEffects } from "../google-connections-store";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";
/** Keeps private I/O causes on the host; expected authorization errors keep their status. */
export async function runGoogleOperation<A, E>(operation: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isSuccess(result)) return result.success;
  const error = result.failure;
  if (error instanceof ConnectorAccessRefused) throw new HttpError(400, error.reason);
  if (typeof error === "object" && error !== null && "cause" in error && error.cause instanceof HttpError)
    throw error.cause;
  if (error instanceof GoogleConnectionsFailure)
    throw new HttpError(400, sourceText("error.team.googleConnectionUnavailable"));
  throw error;
}
export async function routeGoogleConnections(
  context: TeamApiRequestContext,
  service: GoogleConnectionsService | undefined,
  serverId: string | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, member, json } = context;
  if (method !== "POST" || !Object.values(R).some((p) => p === url.pathname)) return "unmatched";
  if (!service || !serverId || !capabilities.has(GOOGLE_CONNECTIONS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.googleConnectionUnavailable"));
  const actor = { member, serverId };
  const body = await readJson(request);
  const decode = <T>(parser: (v: unknown) => T) => runGoogleOperation(googleEffects.sync(() => parser(body)));
  if (url.pathname === R.state) return json(200, service.snapshot(actor));
  if (url.pathname === R.configure)
    return json(
      200,
      await runGoogleOperation(service.configure(actor, (await decode(parseGoogleConnectionConfigure)).mcpServerId)),
    );
  if (url.pathname === R.start)
    return json(
      200,
      await runGoogleOperation(service.start(actor, (await decode(parseGoogleConnectionProfile)).profileId)),
    );
  if (url.pathname === R.assign)
    return json(200, await runGoogleOperation(service.assign(actor, await decode(parseGoogleConnectionAssign))));
  if (url.pathname === R.disconnect) {
    const { profileId } = await decode(parseGoogleConnectionProfile);
    if (!profileId) throw new HttpError(400, "Invalid Google profile.");
    return json(200, await runGoogleOperation(service.disconnect(actor, profileId)));
  }
  const flow = await decode(parseGoogleConnectionFlow);
  if (url.pathname === R.status) return json(200, await runGoogleOperation(service.status(actor, flow.flowId)));
  if (url.pathname === R.complete) {
    if (flow.query === undefined) throw new HttpError(400, "Invalid Google callback.");
    return json(200, await runGoogleOperation(service.complete(actor, flow.flowId, flow.query)));
  }
  if (url.pathname === R.cancel) {
    await runGoogleOperation(service.cancel(actor, flow.flowId));
    return json(200, {});
  }
  return "unmatched";
}
