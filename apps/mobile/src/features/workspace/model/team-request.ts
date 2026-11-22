import { runTeamEffect } from "@openbot/team-client";
import { Effect } from "effect";

export function runTeamRequest<A>(operation: Effect.Effect<A, { readonly cause: unknown }>): Promise<A> {
  return runTeamEffect(operation.pipe(Effect.mapError((error) => error.cause)));
}
