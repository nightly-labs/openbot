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
