import { Effect, Fiber, Option } from "effect";
import type { MessagingAdapterError } from "./messaging-types";

const NAME_LOOKUPS = 20;
const NAME_DEADLINE_MS = 1_500;

export const mentionNames = Effect.fnUntraced(function* (
  ids: Iterable<string>,
  nameOf: (userId: string) => Effect.Effect<string, MessagingAdapterError>,
) {
  const distinct = [...new Set(ids)].slice(0, NAME_LOOKUPS);
  if (distinct.length === 0) return new Map<string, string>();
  const lookups = yield* Effect.forkDetach(
    Effect.forEach(
      distinct,
      (id) =>
        nameOf(id).pipe(
          Effect.map((name) => [id, name.replace(/\s+/g, " ").trim()] as const),
          Effect.catch(() => Effect.succeed([id, ""] as const)),
        ),
      { concurrency: 4 },
    ),
  );
  const entries = yield* Fiber.join(lookups).pipe(Effect.timeoutOption(NAME_DEADLINE_MS));
  return new Map(Option.getOrElse(entries, () => []).filter(([id, name]) => name && name !== id));
});

export function withMentionNames(text: string, names: ReadonlyMap<string, string>): string {
  if (names.size === 0) return text;
  return text.replace(/@([A-Za-z0-9]+)/g, (mention, id: string) => {
    const name = names.get(id);
    return name ? `@${name}` : mention;
  });
}
