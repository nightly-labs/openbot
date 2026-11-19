import { Effect } from "effect";

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
