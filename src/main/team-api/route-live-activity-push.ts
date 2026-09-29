import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  LIVE_ACTIVITY_PUSH_CAPABILITY,
  LIVE_ACTIVITY_PUSH_ROUTES,
  type LiveActivityPushRegistration,
} from "@openbot/contracts/team-protocol/live-activity-push-v1";
import { sourceText } from "@openbot/i18n/source";
import type { LiveActivityPushService } from "../live-activity-push";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { markerExclusionsForCapabilities, readJson } from "./request-helpers";

/**
 * The phone of the calling member gives or removes the push token of its Live Activity. The host
 * keeps it for this session only, and sends updates only for what this member can see. Frozen by
 * `live-activity-push-v1`.
 */
export async function routeLiveActivityPush(
  context: TeamApiRequestContext,
  push: LiveActivityPushService | undefined,
  hiddenAgentIds: () => ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json, member, sessionId } = context;
  if (
    method !== "POST" ||
    (url.pathname !== LIVE_ACTIVITY_PUSH_ROUTES.register && url.pathname !== LIVE_ACTIVITY_PUSH_ROUTES.remove)
  ) {
    return "unmatched";
  }
  if (!push || !capabilities.has(LIVE_ACTIVITY_PUSH_CAPABILITY)) {
    throw new HttpError(400, sourceText("error.team.liveActivityUnsupported"));
  }
  // `readJson` has already run the body through the live-activity-push wire codec.
  const body = await readJson(request);
  if (url.pathname === LIVE_ACTIVITY_PUSH_ROUTES.remove) {
    push.remove(sessionId);
    return json(200, {});
  }
  push.register(
    sessionId,
    { memberId: member.id, hiddenAgentIds, readOptions: markerExclusionsForCapabilities(capabilities) },
    registration(body),
  );
  return json(200, {});
}

function registration(body: DynamicRecord): LiveActivityPushRegistration {
  const text = (field: string) => {
    const value = body[field];
    if (typeof value !== "string") throw new HttpError(400, `${field} is required.`);
    return value;
  };
  const photos: unknown[] = Array.isArray(body.photos) ? body.photos : [];
  return {
    serverId: text("serverId"),
    token: text("token"),
    environment: body.environment === "development" ? "development" : "production",
    secret: text("secret"),
    locale: text("locale"),
    away: body.away === true,
    photos: photos.flatMap((photo) =>
      isDynamicRecord(photo) && isString(photo.agentId) && isString(photo.file)
        ? [{ agentId: photo.agentId, file: photo.file }]
        : [],
    ),
  };
}
