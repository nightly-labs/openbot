import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { readMultipartFormData } from "../../../server/json-body";
import {
  apiError,
  enforceMarketplaceMutationRateLimit,
  json,
  marketplaceErrorResponse,
  requestAgentTemplates,
  requestUser,
} from "../../../server/request-auth";

const TEMPLATE_BODY_LIMIT = 8 * 1024 * 1024;

export const Route = createFileRoute("/v1/agent-templates/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const user = await requestUser(request);
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          await enforceMarketplaceMutationRateLimit("upload", user.id);
          const form = await readMultipartFormData(request, TEMPLATE_BODY_LIMIT);
          const snapshotText = form.get("snapshot");
          const avatar = form.get("avatar");
          if (!isString(snapshotText)) return apiError(400, "invalid_template", "An agent template is required.");
          if (avatar !== null && !(avatar instanceof File))
            return apiError(400, "invalid_avatar", "The avatar is invalid.");
          let snapshot: unknown;
          try {
            snapshot = JSON.parse(snapshotText);
          } catch {
            return apiError(400, "invalid_template", "Invalid agent template.");
          }
          return json(
            await requestAgentTemplates().publish({
              user,
              sourceAgentId: form.get("sourceAgentId"),
              snapshot,
              avatar:
                avatar instanceof File
                  ? { bytes: new Uint8Array(await avatar.arrayBuffer()), mimeType: avatar.type }
                  : null,
            }),
            201,
          );
        } catch (error) {
          return marketplaceErrorResponse(error);
        }
      },
    },
  },
});
