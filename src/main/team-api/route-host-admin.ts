import type { UpdateHostIdentityInput } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { HOST_ADMIN_CAPABILITY, HOST_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/host-admin-v1";
import { sourceText } from "@openbot/i18n/source";
import { parseHostIdentity } from "../ipc/server-inputs";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * The server name and logo of this computer, changed from a joined server. The change runs as the
 * local one does, with the account signed in here. Frozen by `host-admin-v1`.
 */
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
    await identity.updateIdentity(input);
    return json(200, {});
  } catch (error) {
    // A signed-out host or a failed upload is a sentence for the admin, not a host fault.
    if (error instanceof Error) throw new HttpError(409, error.message);
    throw error;
  }
}

/** The base64 logo becomes the bytes the local parser checks, so both paths accept the same images. */
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
