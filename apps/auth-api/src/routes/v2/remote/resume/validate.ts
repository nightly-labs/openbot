import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { z } from "zod";
import { runApiResponse } from "../../../../server/effect-runtime";
import { JSON_BODY_LIMIT, readRequestBytes } from "../../../../server/json-body";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  verifyRemoteServiceRequest,
} from "../../../../server/request-auth";

const resumeClaimsSchema = z.object({
  sessionId: z.string().min(1).max(256),
  hostId: z.string().min(1).max(256),
  userId: z.string().min(1).max(256),
  membershipId: z.string().min(1).max(256),
  role: z.enum(["host", "owner", "admin", "member"]),
  authEpoch: z.number().int().nonnegative(),
  sessionExpiresAt: z.number().int().positive(),
});

export const Route = createFileRoute("/v2/remote/resume/validate")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = new TextDecoder().decode(yield* readRequestBytes(request, JSON_BODY_LIMIT));
            if (!(yield* verifyRemoteServiceRequest(request, body))) {
              return apiError(401, "invalid_signature", "The Remote service signature is invalid.");
            }
            let parsed: ReturnType<typeof resumeClaimsSchema.safeParse>;
            try {
              parsed = resumeClaimsSchema.safeParse(JSON.parse(body));
            } catch {
              return apiError(400, "invalid_resume_claims", "The resume claims are invalid.");
            }
            if (!parsed.success) return apiError(400, "invalid_resume_claims", "The resume claims are invalid.");
            return json({ valid: yield* requestRemoteControlPlane().validateResumeClaims(parsed.data) });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
