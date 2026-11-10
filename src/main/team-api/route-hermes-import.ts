import { parseApplyHermesImportInput } from "@openbot/contracts/ipc";
import { HERMES_IMPORT_CAPABILITY, HERMES_IMPORT_ROUTES } from "@openbot/contracts/team-protocol/hermes-import-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiHermesImport } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";
import { answer } from "./route-agent-import";

/**
 * The Hermes Agent profiles of the host's own Hermes folder, imported from a joined server. Only owners
 * and admins: an import adds agents, skills and MCP servers to the whole server. The host reads the
 * folder that Hermes uses on the host; the client cannot name a folder. Frozen by `hermes-import-v1`.
 * `newAgentHidden` says that a new agent would start on a provider that the caller does not see.
 */
export async function routeHermesImport(
  context: TeamApiRequestContext,
  hermesImport: TeamApiHermesImport | undefined,
  newAgentHidden: () => boolean,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const route = method === "POST" ? url.pathname : null;
  if (
    route !== HERMES_IMPORT_ROUTES.read &&
    route !== HERMES_IMPORT_ROUTES.apply &&
    route !== HERMES_IMPORT_ROUTES.discard
  )
    return "unmatched";
  if (!hermesImport || !capabilities.has(HERMES_IMPORT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.hermesImportUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the hermes-import wire codec.
  const body = await readJson(request);
  if (route === HERMES_IMPORT_ROUTES.discard) {
    await Effect.runPromise(hermesImport.discard(stringField(body, "token")));
    return json(200, {});
  }
  if (route === HERMES_IMPORT_ROUTES.read)
    return json(200, await answer(() => runCauseEffect(hermesImport.read()), 400));
  if (newAgentHidden()) throw new HttpError(400, sourceText("error.team.newAgentProviderLocalOnly"));
  let input: ReturnType<typeof parseApplyHermesImportInput>;
  try {
    input = parseApplyHermesImportInput(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid Hermes import.");
  }
  const result = await answer(() => runCauseEffect(hermesImport.apply(input)), 409);
  return json(200, {
    ...result,
    agents: result.agents.map((agent) => ({ agentId: agent.id, name: agent.name })),
  });
}
