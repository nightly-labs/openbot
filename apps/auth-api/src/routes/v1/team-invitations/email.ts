import { createFileRoute } from "@tanstack/solid-router";
import { readJsonObject } from "../../../server/json-body";
import {
  apiError,
  authErrorResponse,
  bearerToken,
  requestAuthService,
  requestSourceIp,
  requestTeamInviteEmailDelivery,
} from "../../../server/request-auth";
import { sendTeamInviteEmail } from "../../../server/team-invite-email";

export const Route = createFileRoute("/v1/team-invitations/email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const token = bearerToken(request);
          if (!token) return apiError(401, "unauthorized", "Sign in is required.");
          const auth = requestAuthService();
          const user = await auth.authenticate(token);
          if (!user) return apiError(401, "unauthorized", "The session is invalid.");
          const body = await readJsonObject(request);
          await sendTeamInviteEmail(
            { auth, delivery: requestTeamInviteEmailDelivery },
            user,
            body,
            requestSourceIp(request),
          );
          return new Response(null, { status: 204 });
        } catch (error) {
          if (error instanceof SyntaxError) {
            return apiError(400, "invalid_json", "The request body is invalid.");
          }
          return authErrorResponse(error);
        }
      },
    },
  },
});
