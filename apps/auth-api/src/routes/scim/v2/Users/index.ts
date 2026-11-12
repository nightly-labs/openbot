import { createFileRoute } from "@tanstack/solid-router";
import { createScimUser, listScimUsers, scimErrorResponse } from "../../../../server/company-sign-in-scim";
import { runApiResponse } from "../../../../server/effect-runtime";

// SCIM users of company sign-in. The bearer token is the server's SCIM token.
export const Route = createFileRoute("/scim/v2/Users/")({
  server: {
    handlers: {
      GET: ({ request }) => runApiResponse(listScimUsers(request), scimErrorResponse),
      POST: ({ request }) => runApiResponse(createScimUser(request), scimErrorResponse),
    },
  },
});
