import { parseHostedServerActivityReport } from "@openbot/contracts/hosted-servers";
import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../../../server/effect-runtime";
import { JsonBodyError, readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  bearerToken,
  hostedServerErrorResponse,
  requestHostedServerService,
} from "../../../../../server/request-auth";

/** A hosted server reports its use and its next routine run, with the session from its claim. */
export const Route = createFileRoute("/v2/hosting/servers/$serverId/activity")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const token = bearerToken(request);
          if (!token) return apiError(401, "unauthorized", "Sign in is required.");
          // An older server sends no body.
          const body = request.headers.get("Content-Type")?.startsWith("application/json")
            ? await readJsonObject(request)
            : null;
          const report = parseHostedServerActivityReport(body);
          if (!report) return apiError(400, "invalid_request", "The activity report is not valid.");
          await runApiEffect(requestHostedServerService().reportActivity(token, params.serverId, report));
          return new Response(null, { status: 204 });
        } catch (error) {
          if (error instanceof JsonBodyError) return apiError(error.status, error.code, error.message);
          return hostedServerErrorResponse(error);
        }
      },
    },
  },
});
