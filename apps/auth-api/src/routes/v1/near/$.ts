import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { NearIntentsRelayError, nearIntentsRelayErrorResponse } from "../../../server/near-intents-relay";
import {
  nearIntentsErrorResponse,
  requestNearIntentsOwner,
  requestNearIntentsRelay,
} from "../../../server/request-auth";

function relay({ request }: { request: Request }) {
  return runApiResponse(
    Effect.gen(function* () {
      const owner = yield* requestNearIntentsOwner(request);
      if (!owner)
        return nearIntentsRelayErrorResponse(
          new NearIntentsRelayError(401, "unauthorized", "Sign in to use the crypto wallet."),
        );
      return yield* requestNearIntentsRelay().handle(request, owner);
    }),
    nearIntentsErrorResponse,
  );
}

export const Route = createFileRoute("/v1/near/$")({
  server: { handlers: { GET: relay, POST: relay } },
});
