import { resolve } from "node:path";
import { isActivityInboxFollowupInput } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const [userDataPath, rawInput] = process.argv.slice(2);
if (!userDataPath || !rawInput) throw new Error("Expected a database path and follow-up input.");
const parsed = JSON.parse(rawInput);
if (!isDynamicRecord(parsed) || !isActivityInboxFollowupInput(parsed) || !isString(parsed.actorId))
  throw new Error("Invalid follow-up fixture input.");
const input = { ...parsed, actorId: parsed.actorId };
const database = new OpenBotDatabase(resolve(userDataPath));
try {
  await runCauseEffect(database.initialize());
  const result = database.beginActivityInboxFollowup(input);
  // Machine-readable: one JSON response for the parent E2E fixture.
  process.stdout.write(`${JSON.stringify({ shouldSend: result.shouldSend, receipt: result.receipt })}\n`);
} finally {
  database.close();
}
