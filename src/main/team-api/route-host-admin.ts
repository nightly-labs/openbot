import type { UpdateHostIdentityInput } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { HOST_ADMIN_CAPABILITY, HOST_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/host-admin-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseHostIdentity } from "../ipc/server-inputs";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

export async function routeHostAdmin(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== HOST_ADMIN_ROUTES.identity) return "unmatched";
  const identity = admin?.identity;
  if (!identity || !capabilities.has(HOST_ADMIN_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.hostIdentityUnsupported"));
  requireAdmin(member);
  const input = parsedIdentity(await readJson(request));
  try {
    await runCauseEffect(identity.updateIdentity(input));
    return json(200, {});
  } catch (error) {
    if (error instanceof Error) throw new HttpError(409, error.message);
    throw error;
  }
}

function parsedIdentity(body: DynamicRecord): UpdateHostIdentityInput {
  try {
    const logo = body.logo;
    return parseHostIdentity({
      ...(body.serverName === undefined ? {} : { serverName: body.serverName }),
      ...(logo === undefined
        ? {}
        : {
            logo:
              isDynamicRecord(logo) && isString(logo.data)
                ? { mimeType: logo.mimeType, bytes: new Uint8Array(Buffer.from(logo.data, "base64")) }
                : logo,
          }),
    });
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid server identity.");
  }
}
