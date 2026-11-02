import { Effect } from "effect";

/**
 * A sweep that runs `pass` until no call came during the last pass. A call while a pass runs only
 * asks for one more pass, so many events in a row cost one or two passes, not one each.
 */
export function coalescedPasses(pass: () => Effect.Effect<void>): () => Effect.Effect<void> {
  let sweeping = false;
  let again = false;
  return () =>
    Effect.suspend(() => {
      if (sweeping) {
        again = true;
        return Effect.void;
      }
      sweeping = true;
      return Effect.gen(function* () {
        do {
          again = false;
          yield* pass();
        } while (again);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            sweeping = false;
          }),
        ),
      );
    });
}
