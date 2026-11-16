// The seeded thread that the pinned-message E2E scripts use. `pinned-message-jump-e2e.ts --seed` writes it.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Schema } from "effect";

export const SEED_FILE = resolve(import.meta.dirname, "../.openbot-build/pinned-message-jump-e2e/seed.json");

const SeedSchema = Schema.Struct({
  agentId: Schema.String,
  agentName: Schema.String,
  taskId: Schema.String,
  count: Schema.Number,
});
export type Seed = typeof SeedSchema.Type;

const decodeSeed = Schema.decodeUnknownSync(Schema.fromJsonString(SeedSchema));

/** The id of a seeded message. */
export const seedMessageId = (index: number) => `pin-timing-${String(index).padStart(6, "0")}`;

export function readSeed(): Seed {
  assert.ok(existsSync(SEED_FILE), "Seed first: bun scripts/pinned-message-jump-e2e.ts --seed --profile=<userData>");
  return decodeSeed(readFileSync(SEED_FILE, "utf8"));
}
