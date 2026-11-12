import { canAdministerServer, parseApplyAgentImportInput } from "@openbot/contracts/ipc";
import {
  AGENT_IMPORT_CAPABILITY,
  AGENT_IMPORT_ROUTES,
  AGENT_IMPORT_UPLOAD_BYTES,
} from "@openbot/contracts/team-protocol/agent-import-v1";
import {
  AGENT_IMPORT_V2_CAPABILITY,
  AGENT_IMPORT_V2_CHUNK_BYTES,
  AGENT_IMPORT_V2_ROUTES,
} from "@openbot/contracts/team-protocol/agent-import-v2";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgentImport } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { pathIdentifier, readBinary, readJson, stringField } from "./request-helpers";

/**
 * Agents imported from a Grok Bot export sent from a joined server. Any member can import, as any
 * member can create an agent; the token is the member's own. The response codec of `agent-import-v1`
 * leaves out the avatars of the preview. Frozen by `agent-import-v1`, and `agent-import-v2` for an
 * export sent in parts. `newAgentHidden` says that a new agent would start on a provider that the
 * caller does not see.
 */
export async function routeAgentImport(
  context: TeamApiRequestContext,
  agentImport: TeamApiAgentImport | undefined,
  newAgentHidden: () => boolean,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const route = method === "POST" ? url.pathname : null;
  if (
    route === AGENT_IMPORT_V2_ROUTES.open ||
    route === AGENT_IMPORT_V2_ROUTES.chunk ||
    route === AGENT_IMPORT_V2_ROUTES.stage
  ) {
    if (!agentImport || !capabilities.has(AGENT_IMPORT_V2_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.agentImportUnsupported"));
    if (route === AGENT_IMPORT_V2_ROUTES.chunk) {
      const offsetText = url.searchParams.get("offset") ?? "";
      const offset = Number(offsetText);
      if (!/^\d+$/u.test(offsetText) || !Number.isSafeInteger(offset)) throw new HttpError(400, "offset is invalid.");
      const uploadId = pathIdentifier(url.searchParams.get("upload") ?? undefined, "upload");
      const read = () => readBinary(request, AGENT_IMPORT_V2_CHUNK_BYTES);
      const received = await answer(
        () => runCauseEffect(agentImport.writeUpload(uploadId, offset, read, member.id)),
        409,
      );
      return json(200, { received });
    }
    const body = await readJson(request);
    if (route === AGENT_IMPORT_V2_ROUTES.open) {
      const size = body.size;
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)
        throw new HttpError(400, "size is invalid.");
      return json(200, { uploadId: await answer(() => runCauseEffect(agentImport.openUpload(size, member.id)), 400) });
    }
    const uploadId = stringField(body, "uploadId");
    return json(200, await answer(() => runCauseEffect(agentImport.stageParts(uploadId, member.id)), 400));
  }
  if (
    route !== AGENT_IMPORT_ROUTES.stage &&
    route !== AGENT_IMPORT_ROUTES.apply &&
    route !== AGENT_IMPORT_ROUTES.discard
  )
    return "unmatched";
  if (!agentImport || !capabilities.has(AGENT_IMPORT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentImportUnsupported"));

  if (route === AGENT_IMPORT_ROUTES.discard) {
    await Effect.runPromise(agentImport.discard(stringField(await readJson(request), "token"), member.id));
    return json(200, {});
  }
  if (route === AGENT_IMPORT_ROUTES.stage) {
    const read = () =>
      readBinary(request, AGENT_IMPORT_UPLOAD_BYTES).catch((error: unknown) => {
        if (error instanceof HttpError && error.status === 413)
          throw new HttpError(413, sourceText("error.import.remoteZipTooLarge"));
        throw error;
      });
    return json(200, await answer(() => runCauseEffect(agentImport.stageUpload(read, member.id)), 400));
  }
  // `readJson` has already run the body through the agent-import wire codec.
  const body = await readJson(request);
  if (newAgentHidden()) throw new HttpError(400, sourceText("error.team.newAgentProviderLocalOnly"));
  let input: ReturnType<typeof parseApplyAgentImportInput>;
  try {
    input = parseApplyAgentImportInput(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid agent import.");
  }
  const result = await answer(
    () =>
      runCauseEffect(
        agentImport.apply(input, {
          owner: member.id,
          actor: { id: member.id, name: member.name ?? "Team member" },
          // The service checks the zone and uses the host's own when it is not valid.
          ...(typeof body.timezone === "string" ? { timezone: body.timezone } : {}),
          reviseSkills: canAdministerServer(member.role),
        }),
      ),
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
export async function answer<T>(run: () => Promise<T>, status: number): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && !("code" in error)) throw new HttpError(status, error.message);
    throw error;
  }
}
