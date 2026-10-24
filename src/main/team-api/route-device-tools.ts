import {
  DEVICE_TOOLS_CAPABILITY,
  DEVICE_TOOLS_ROUTES,
  decodeDeviceToolRespondRequest,
} from "@openbot/contracts/team-protocol/device-tools-v1";
import { Effect } from "effect";
import { DeviceToolForbidden } from "../../backend/device-tool-service";
import type { TeamApiDeviceTools } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson } from "./request-helpers";

/**
 * The answer of a phone to a request of an agent. Frozen by `device-tools-v1`.
 *
 * The caller must own the request: another member's request answers 403. A request that is unknown,
 * already answered, timed out or cancelled answers 409 with `device_request_closed`. The body holds
 * the result of the phone, so it is never logged.
 */
export async function routeDeviceTools(
  context: TeamApiRequestContext,
  deviceTools: TeamApiDeviceTools | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, member, sessionId, json } = context;
  if (method !== "POST" || url.pathname !== DEVICE_TOOLS_ROUTES.respond) return "unmatched";
  if (!deviceTools || !capabilities.has(DEVICE_TOOLS_CAPABILITY)) return "unmatched";
  // `readJson` has run the wire codec. The route codec cannot bind the operation, so the service
  // decodes the result again against the request it holds.
  const body = await readJson(request);
  let answer: ReturnType<typeof decodeDeviceToolRespondRequest>;
  try {
    answer = decodeDeviceToolRespondRequest(body);
  } catch {
    throw new HttpError(400, "A valid device answer is required.");
  }
  const outcome = await Effect.runPromise(
    deviceTools.answer(member.id, answer, sessionId).pipe(
      Effect.map(() => "accepted" as const),
      Effect.catch((failure) =>
        Effect.succeed(failure instanceof DeviceToolForbidden ? ("forbidden" as const) : failure.code),
      ),
    ),
  );
  if (outcome === "accepted") return json(200, {});
  if (outcome === "forbidden") throw new HttpError(403, "This request belongs to another member.");
  if (outcome === "device_request_closed")
    return json(409, { error: "device_request_closed", code: "device_request_closed" });
  throw new HttpError(400, "A valid device answer is required.");
}
