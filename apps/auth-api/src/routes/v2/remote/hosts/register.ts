import { isBoolean, isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import {
  apiError,
  json,
  remoteControlPlaneErrorResponse,
  requestAdoptUnlinkedHostedSites,
  requestRemoteControlPlane,
  requestUser,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/hosts/register")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            if (
              !isString(body.hostId) ||
              !isString(body.name) ||
              !isString(body.ownerMembershipId) ||
              !(body.rotateCredential === undefined || isBoolean(body.rotateCredential)) ||
              !(body.machineToken === undefined || isString(body.machineToken)) ||
              !(body.devicePublicKey === undefined || body.devicePublicKey === null || isString(body.devicePublicKey))
            ) {
              return apiError(400, "invalid_remote_request", "The host registration is invalid.");
            }
            const registered = yield* requestRemoteControlPlane().registerHost(user, {
              hostId: body.hostId,
              name: body.name,
              ownerMembershipId: body.ownerMembershipId,
              devicePublicKey: body.devicePublicKey,
              rotateCredential: body.rotateCredential,
              machineToken: body.machineToken,
            });
            // Sites this computer published before it was a server join the server's list. The host is
            // registered either way, so a failure here does not refuse the registration.
            yield* requestAdoptUnlinkedHostedSites(user.id, registered.hostId).pipe(
              Effect.catch(() => Effect.sync(() => console.warn("hosted sites: unlinked site adoption failed"))),
            );
            return json(registered, 201);
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
