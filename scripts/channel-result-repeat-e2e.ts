// Checks that a member reply that repeats its channel result does not stay at streaming (#3673), in
// this worktree's running dev app with real provider turns. Start the app with `bun run dev` (never
// `--shared`), then run `bun scripts/channel-result-repeat-e2e.ts --allow-mutations`. It needs two
// visible agents and a signed-in OpenCode. When no agent runs on OpenCode, it moves one to the free
// OpenCode model for the check and gives it its provider back.
//
// OpenCode starts the final answer with no text, so the channel shows the reply before its text
// equals the result. Each turn calls `channel_result` and then repeats the result. It checks that
// no reply of the ended turn is still at streaming. It makes its own
// channel and deletes it. Writes .openbot-build/channel-result-repeat-e2e/report.json.
import assert from "node:assert/strict";
import { DEVELOPMENT_FREE_DEFAULT } from "@openbot/contracts/development-defaults";
import type { AgentSummary, ChannelPage } from "@openbot/contracts/ipc";
import { ChannelClient, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const WORDS = ["OSPREY", "KESTREL", "PLOVER"];

interface Reply {
  id: string;
  itemType: string | undefined;
  status: string | undefined;
  text: string;
}

interface Report {
  provider?: string;
  turns: Array<{ word: string; state: string | undefined; replies: Reply[] }>;
  passed: boolean;
}

const report: Report = { turns: [], passed: false };
const session = await connectChannelE2e("channel-result-repeat-e2e");
const { page } = session;
const client = new ChannelClient(page);
let restore: AgentSummary | null = null;

/** Did the task after the first `count` tasks end? An earlier task that ended does not count. */
const ended = (count: number) => (channel: ChannelPage) => {
  const state = channel.tasks[count]?.state;
  return state === "completed" || state === "failed" || state === "paused" || state === "cancelled";
};

try {
  const agents = await client.agents();
  const found = agents.find((agent) => agent.provider === "opencode") ?? agents.at(-1);
  const lead = agents.find((agent) => agent.id !== found?.id);
  assert.ok(found && lead, "This check needs two visible agents.");
  if (found.provider !== "opencode") restore = found;
  const member =
    found.provider === "opencode"
      ? found
      : await client.update(found.id, {
          provider: DEVELOPMENT_FREE_DEFAULT.provider,
          model: DEVELOPMENT_FREE_DEFAULT.model,
        });
  report.provider = member.provider;
  const channel = await client.create("E2E channel result repeat", [member.id, lead.id], member.id);
  for (const word of WORDS) {
    const before = await client.read(channel.id);
    const sequence = before.throughSequence;
    const count = before.tasks.length;
    await client.send(
      channel.id,
      `Call the channel_result tool once with the text ${word}. After the tool returns, reply with ${word} only.`,
      member.id,
    );
    const current = await waitFor(page, `the ${word} turn ends`, () => client.read(channel.id), ended(count));
    report.turns.push({
      word,
      state: current.tasks[count]?.state,
      replies: current.messages
        .filter((message) => message.sequence > sequence && message.author.id === member.id)
        .map(({ id, message }) => ({ id, itemType: message.itemType, status: message.status, text: message.text })),
    });
  }
  for (const turn of report.turns) {
    assert.equal(turn.state, "completed", `The ${turn.word} turn did not complete.`);
    assert.deepEqual(
      turn.replies.filter((reply) => reply.status === "streaming"),
      [],
      `A reply of the ended ${turn.word} turn is still arriving.`,
    );
  }
  report.passed = true;
} finally {
  try {
    await client.cleanup();
  } finally {
    // The agent gets its provider back also when the clean-up fails.
    if (restore)
      await client.update(restore.id, { provider: restore.provider, model: restore.model }).catch(() => undefined);
    writeReport("channel-result-repeat-e2e", report);
    await session.close();
  }
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
