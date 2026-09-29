import { parseApplyAgentImportInput } from "@openbot/contracts/ipc";
import {
  AGENT_IMPORT_CAPABILITY,
  AGENT_IMPORT_ROUTES,
  AGENT_IMPORT_UPLOAD_BYTES,
} from "@openbot/contracts/team-protocol/agent-import-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAgentImport } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readBinary, readJson, stringField } from "./request-helpers";

/**
 * Agents imported from a Grok Bot export sent from a joined server. Any member can import, as any
 * member can create an agent; the token is the member's own. The response codec of `agent-import-v1`
 * leaves out the avatars of the preview. Frozen by `agent-import-v1`.
 */
export async function routeAgentImport(
  context: TeamApiRequestContext,
  agentImport: TeamApiAgentImport | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const route = method === "POST" ? url.pathname : null;
  if (
    route !== AGENT_IMPORT_ROUTES.stage &&
    route !== AGENT_IMPORT_ROUTES.apply &&
    route !== AGENT_IMPORT_ROUTES.discard
  )
    return "unmatched";
  if (!agentImport || !capabilities.has(AGENT_IMPORT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentImportUnsupported"));

  if (route === AGENT_IMPORT_ROUTES.discard) {
    agentImport.discard(stringField(await readJson(request), "token"), member.id);
    return json(200, {});
  }
  if (route === AGENT_IMPORT_ROUTES.stage) {
    const read = () =>
      readBinary(request, AGENT_IMPORT_UPLOAD_BYTES).catch((error: unknown) => {
        if (error instanceof HttpError && error.status === 413)
          throw new HttpError(413, sourceText("error.import.remoteZipTooLarge"));
        throw error;
      });
    return json(200, await answer(() => agentImport.stageUpload(read, member.id), 400));
  }
  // `readJson` has already run the body through the agent-import wire codec.
  const body = await readJson(request);
  let input: ReturnType<typeof parseApplyAgentImportInput>;
  try {
    input = parseApplyAgentImportInput(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid agent import.");
  }
  const result = await answer(
    () =>
      agentImport.apply(input, {
        owner: member.id,
        actor: { id: member.id, name: member.name ?? "Team member" },
        // The service checks the zone and uses the host's own when it is not valid.
        timezone: typeof body.timezone === "string" ? body.timezone : undefined,
        reviseSkills: member.role !== "member",
      }),
    409,
  );
  return json(200, {
    ...result,
    agents: result.agents.map((agent) => ({ agentId: agent.id, name: agent.name })),
  });
}

/**
 * An export the host cannot read, or a closed token, is a sentence for the member, not a host fault.
 * A system error, such as a full disk, names host paths: it goes to the logger and answers 500.
 */
async function answer<T>(run: () => Promise<T>, status: number): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && !("code" in error)) throw new HttpError(status, error.message);
    throw error;
  }
}
