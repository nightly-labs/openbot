import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { z } from "zod";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readRequestBytes } from "../../../../server/json-body";
import { REMOTE_RESUME_BATCH_LIMIT } from "../../../../server/remote-control-plane";
import { remoteResumeClaimsSchema } from "../../../../server/remote-resume-claims";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  verifyRemoteServiceRequest,
} from "../../../../server/request-auth";

const RESUME_BATCH_BODY_LIMIT = 128 * 1024;

const resumeBatchSchema = z.object({
  claims: z.array(remoteResumeClaimsSchema).min(1).max(REMOTE_RESUME_BATCH_LIMIT),
});

export const Route = createFileRoute("/v2/remote/resume/validate-batch")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = new TextDecoder().decode(yield* readRequestBytes(request, RESUME_BATCH_BODY_LIMIT));
            if (!(yield* verifyRemoteServiceRequest(request, body))) {
              return apiError(401, "invalid_signature", "The Remote service signature is invalid.");
            }
            let parsed: ReturnType<typeof resumeBatchSchema.safeParse>;
            try {
              parsed = resumeBatchSchema.safeParse(JSON.parse(body));
            } catch {
              return apiError(400, "invalid_resume_claims", "The resume claims are invalid.");
            }
            if (!parsed.success) return apiError(400, "invalid_resume_claims", "The resume claims are invalid.");
            return json({ valid: yield* requestRemoteControlPlane().validateResumeClaimsBatch(parsed.data.claims) });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
