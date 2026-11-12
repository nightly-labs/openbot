import { createFileRoute } from "@tanstack/solid-router";
import { readScimUser, scimErrorResponse, updateScimUser } from "../../../../server/company-sign-in-scim";
import { runApiResponse } from "../../../../server/effect-runtime";

// One SCIM user of company sign-in. Turning a user off ends the account's sessions.
export const Route = createFileRoute("/scim/v2/Users/$userId")({
  server: {
    handlers: {
      GET: ({ request, params }) => runApiResponse(readScimUser(request, params.userId), scimErrorResponse),
      PATCH: ({ request, params }) =>
        runApiResponse(updateScimUser(request, params.userId, "patch"), scimErrorResponse),
      PUT: ({ request, params }) => runApiResponse(updateScimUser(request, params.userId, "put"), scimErrorResponse),
      DELETE: ({ request, params }) =>
        runApiResponse(updateScimUser(request, params.userId, "delete"), scimErrorResponse),
    },
  },
});
