// A second SQLite connection used by activity-inbox-e2e to exercise duplicate capture races.
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const [userDataPath, agentId, threadId, turnId] = process.argv.slice(2);
if (!userDataPath || !agentId || !threadId || !turnId) throw new Error("Capture worker needs the fixture identifiers.");

const database = new OpenBotDatabase(userDataPath);
try {
  await runCauseEffect(database.initialize());
  database.captureActivityInboxFinalTaskTurn({ agentId, threadId, turnId });
  process.stdout.write("captured\n");
} finally {
  database.close();
}
