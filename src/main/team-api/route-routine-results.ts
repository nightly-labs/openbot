import { isOneOf } from "@openbot/contracts/runtime-values";
import {
  ROUTINE_RESULTS_CAPABILITY,
  ROUTINE_RESULTS_PLACE_LIMIT,
  ROUTINE_RESULTS_PLATFORMS,
  ROUTINE_RESULTS_ROUTES,
} from "@openbot/contracts/team-protocol/routine-results-v1";
import {
  ROUTINE_RESULTS_WHATSAPP_CAPABILITY,
  ROUTINE_RESULTS_WHATSAPP_PLATFORMS,
} from "@openbot/contracts/team-protocol/routine-results-whatsapp-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import { RoutineResultError } from "../../backend/routine-results/routine-results";
import { parseRoutineResultRoutine, parseSetRoutineResultDestination } from "../ipc/routine-result-inputs";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireVisibleBodyAgent } from "./request-helpers";

const ROUTE_PATHS = new Set<string>(Object.values(ROUTINE_RESULTS_ROUTES));

/**
 * Where an agent routine of this computer sends its answers, read and set from a joined server.
 * Frozen by `routine-results-v1`. The deliveries and a second send stay on this computer.
 */
export async function routeRoutineResults(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const path = url.pathname;
  if (method !== "POST" || !ROUTE_PATHS.has(path)) return "unmatched";
  const results = admin?.routineResults;
  if (!results || !capabilities.has(ROUTINE_RESULTS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.routineResultsUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the routine-results wire codec.
  const body = await readJson(request);
  // WhatsApp goes only to a client that reads it (`routine-results-whatsapp-v1`).
  const platforms = capabilities.has(ROUTINE_RESULTS_WHATSAPP_CAPABILITY)
    ? ROUTINE_RESULTS_WHATSAPP_PLATFORMS
    : ROUTINE_RESULTS_PLATFORMS;
  if (path === ROUTINE_RESULTS_ROUTES.options) {
    const connections = await Effect.runPromise(results.options());
    return json(200, {
      connections: connections
        .filter((connection) => isOneOf(platforms, connection.platform))
        .map((connection) => ({ ...connection, places: connection.places.slice(0, ROUTINE_RESULTS_PLACE_LIMIT) })),
    });
  }
  requireVisibleBodyAgent(body, hiddenAgentIds);
  try {
    const destination =
      path === ROUTINE_RESULTS_ROUTES.destination
        ? await runCauseEffect(results.destination(parseRoutineResultRoutine(body)))
        : await runCauseEffect(results.setDestination(parseSetRoutineResultDestination(body)));
    // A client without the platform of the destination gets none, as its options leave the connection out.
    return json(200, { destination: destination && isOneOf(platforms, destination.platform) ? destination : null });
  } catch (error) {
    // A refusal is a sentence for the reader: the routine is gone or the connection is off.
    if (error instanceof RoutineResultError) throw new HttpError(400, error.message);
    throw error;
  }
}
