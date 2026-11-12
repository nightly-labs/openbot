import { rm } from "node:fs/promises";
import { parseApplyInstanceTransferInput, parseExportInstanceInput } from "@openbot/contracts/ipc";
import {
  INSTANCE_TRANSFER_CAPABILITY,
  INSTANCE_TRANSFER_REMOTE_BYTES,
  INSTANCE_TRANSFER_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiInstanceTransfer } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readBinary, readJson, requireAdmin, stringField } from "./request-helpers";
import { answer } from "./route-agent-import";
import { sendFile } from "./route-files";

const ROUTES: ReadonlySet<string> = new Set(Object.values(INSTANCE_TRANSFER_ROUTES));

/**
 * The server's agents and server settings to or from an OpenBot transfer file. Only an owner or an
 * admin: an export holds every agent's memories and files, and an import adds server settings. The
 * token is the caller's own. Frozen by `instance-transfer-v1`.
 */
export async function routeInstanceTransfer(
  context: TeamApiRequestContext,
  instanceTransfer: TeamApiInstanceTransfer | undefined,
  newAgentHidden: () => boolean,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, response, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!instanceTransfer || !capabilities.has(INSTANCE_TRANSFER_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.instanceTransferUnsupported"));
  requireAdmin(member);

  switch (url.pathname) {
    case INSTANCE_TRANSFER_ROUTES.summary:
      return json(200, await answer(() => runCauseEffect(instanceTransfer.summary()), 400));
    case INSTANCE_TRANSFER_ROUTES.export: {
      let input: ReturnType<typeof parseExportInstanceInput>;
      try {
        input = parseExportInstanceInput(await readJson(request));
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Invalid export.");
      }
      const path = await answer(() => runCauseEffect(instanceTransfer.exportForMember(input, member.id)), 400);
      try {
        return await sendFile(response, path, null, (size) => ({
          "Content-Type": "application/zip",
          "Content-Length": String(size),
          "Content-Disposition": "attachment; filename*=UTF-8''openbot-transfer.zip",
          "X-Content-Type-Options": "nosniff",
        }));
      } finally {
        await rm(path, { force: true });
      }
    }
    case INSTANCE_TRANSFER_ROUTES.stage: {
      const read = () =>
        readBinary(request, INSTANCE_TRANSFER_REMOTE_BYTES).catch((error: unknown) => {
          if (error instanceof HttpError && error.status === 413)
            throw new HttpError(413, sourceText("error.import.transferRemoteTooLarge"));
          throw error;
        });
      return json(200, await answer(() => runCauseEffect(instanceTransfer.stageUpload(read, member.id)), 400));
    }
    case INSTANCE_TRANSFER_ROUTES.discard:
      await Effect.runPromise(instanceTransfer.discard(stringField(await readJson(request), "token"), member.id));
      return json(200, {});
    default: {
      // `readJson` has already run the body through the instance-transfer wire codec.
      const body = await readJson(request);
      if (newAgentHidden()) throw new HttpError(400, sourceText("error.team.newAgentProviderLocalOnly"));
      let input: ReturnType<typeof parseApplyInstanceTransferInput>;
      try {
        input = parseApplyInstanceTransferInput(body);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Invalid transfer.");
      }
      // The service checks the zone and uses the host's own when it is not valid.
      const timezone = typeof body.timezone === "string" ? body.timezone : undefined;
      const result = await answer(
        () =>
          runCauseEffect(
            instanceTransfer.apply(input, member.id, timezone, {
              id: member.id,
              name: member.name ?? "Team member",
            }),
          ),
        409,
      );
      return json(200, {
        ...result,
        agents: result.agents.map((agent) => ({ agentId: agent.id, name: agent.name })),
      });
    }
  }
}
