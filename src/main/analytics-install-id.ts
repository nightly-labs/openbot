import { randomUUID } from "node:crypto";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { currentAnalyticsInstallId, newAnalyticsInstallId } from "@openbot/telemetry";
import { Effect } from "effect";
import { readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * The install ID that analytics uses when the user does not share analytics with their account.
 * A missing, damaged or 13-month-old file gets a new ID. Null when the new ID cannot be saved: an
 * ID that changes at each start would count one install as many.
 */
export const readAnalyticsInstallId = Effect.fn("readAnalyticsInstallId")(function* (path: string, now: number) {
  const saved = yield* readPreferenceFile(path, (parsed) =>
    isDynamicRecord(parsed) && parsed.version === 1 ? parsed : null,
  ).pipe(Effect.catch(() => Effect.succeed(null)));
  const current = currentAnalyticsInstallId(saved, now);
  if (current) return current.id;
  const created = newAnalyticsInstallId(randomUUID(), now);
  return yield* writePreferenceFile(path, { version: 1, id: created.id, createdAt: created.createdAt }).pipe(
    Effect.as<string | null>(created.id),
    Effect.catch(() => Effect.succeed(null)),
  );
});
