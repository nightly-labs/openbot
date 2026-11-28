import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { z } from "zod";
import { runApiResponse } from "../../../server/effect-runtime";
import { JSON_BODY_LIMIT, readRequestBytes } from "../../../server/json-body";
import { REMOTE_AUTH_EVENT_PAGE_LIMIT } from "../../../server/remote-control-plane";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  verifyRemoteServiceRequest,
} from "../../../server/request-auth";

const authEventPageSchema = z.object({
  after: z.object({
    attemptedAt: z.number().int().nonnegative(),
    eventId: z.string().max(64),
  }),
  limit: z.number().int().min(1).max(REMOTE_AUTH_EVENT_PAGE_LIMIT),
});

export const Route = createFileRoute("/v2/remote/auth-events")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = new TextDecoder().decode(yield* readRequestBytes(request, JSON_BODY_LIMIT));
            if (!(yield* verifyRemoteServiceRequest(request, body))) {
              return apiError(401, "invalid_signature", "The Remote service signature is invalid.");
            }
            let parsed: ReturnType<typeof authEventPageSchema.safeParse>;
            try {
              parsed = authEventPageSchema.safeParse(JSON.parse(body));
            } catch {
              return apiError(400, "invalid_auth_event_cursor", "The auth event cursor is invalid.");
            }
            if (!parsed.success) return apiError(400, "invalid_auth_event_cursor", "The auth event cursor is invalid.");
            return json(yield* requestRemoteControlPlane().authEventsAfter(parsed.data.after, parsed.data.limit));
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
