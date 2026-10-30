// Checks that channel work moves to the backup model when the agent's model is at its usage limit, in
// this worktree's running dev app with real provider turns. Start the app with `bun run dev` (never
// `--shared`), then run `bun scripts/channel-usage-limit-e2e.ts --allow-mutations [--spent=<provider id>]`.
// It needs a signed-in provider whose account is at its usage limit (default: codex), and a visible
// agent on another provider that lists two models.
//
// It puts the agent on the spent model with an automatic backup on its own provider, sends it channel
// work, and checks that the agent moves to the backup, that the channel task completes on it, and that
// the model switch note shows in the channel and in the agent's chat. It makes its own channel and
// deletes it, and gives the agent its model and backup models back. A model that the user picks ends
// the way back to the spent model, so the agent does not return to it at the reset.
// Writes .openbot-build/channel-usage-limit-e2e/report.json.
import assert from "node:assert/strict";
import { agentProviderDescriptor, isAgentProvider } from "@openbot/contracts/agent-providers";
import { type AgentSummary, type ChannelPage, MODEL_SWITCH_ITEM_TYPES } from "@openbot/contracts/ipc";
import { argument, ChannelClient, connectChannelE2e, SHORT_PROMPT, waitFor, writeReport } from "./channel-e2e-support";

interface Report {
  spent?: { provider: string; model: string };
  backup?: { provider: string; model: string };
  moved?: { provider: string; model: string };
  taskState?: string;
  channelNote?: boolean;
  chatNote?: boolean;
  passed: boolean;
}

const report: Report = { passed: false };
const session = await connectChannelE2e("channel-usage-limit-e2e");
const { page } = session;
const client = new ChannelClient(page);
let restore: AgentSummary | null = null;
const switchNote = MODEL_SWITCH_ITEM_TYPES["usage-limit"];

const ended = (channel: ChannelPage) => {
  const state = channel.tasks.at(-1)?.state;
  return state === "completed" || state === "failed" || state === "paused" || state === "cancelled";
};

try {
  const spentProvider = argument("spent") ?? "codex";
  const models = (await page.evaluate(() => window.openbot.agent.listModels())).flatMap((model) =>
    isAgentProvider(model.provider) ? [{ ...model, provider: model.provider }] : [],
  );
  const spent = models.find((model) => model.provider === spentProvider);
  assert.ok(spent, `No model of ${spentProvider} is available. Sign in, or pass --spent=<id>.`);
  const agent = (await client.agents()).find(
    (candidate) =>
      candidate.provider !== spentProvider &&
      agentProviderDescriptor(candidate.provider).concurrentTurns &&
      models.some((model) => model.provider === candidate.provider && model.id !== candidate.model),
  );
  assert.ok(agent, "This check needs a visible agent on another provider that lists two models.");
  const backup = models.find((model) => model.provider === agent.provider && model.id !== agent.model);
  assert.ok(backup);
  report.spent = { provider: spent.provider, model: spent.id };
  report.backup = { provider: backup.provider, model: backup.id };

  restore = agent;
  await client.update(agent.id, {
    provider: spent.provider,
    model: spent.id,
    backupModels: { automatic: true, order: [{ provider: backup.provider, model: backup.id }] },
  });
  const channel = await client.create("E2E usage limit", [agent.id], agent.id);
  await client.send(channel.id, SHORT_PROMPT, agent.id);

  const done = await waitFor(page, "the channel task ends", () => client.read(channel.id), ended);
  const moved = (await client.agents()).find((candidate) => candidate.id === agent.id);
  assert.ok(moved);
  report.moved = { provider: moved.provider, model: moved.model };
  report.taskState = done.tasks.at(-1)?.state ?? "missing";
  report.channelNote = done.messages.some((message) => message.message.itemType === switchNote);
  const chat = await page.evaluate((id) => window.openbot.agent.readConversation(id), agent.id);
  report.chatNote = chat.messages.some((message) => message.itemType === switchNote);

  assert.ok(
    moved.provider !== spent.provider || report.taskState !== "completed",
    `${spent.provider} is not at its usage limit: the turn completed on it.`,
  );
  assert.equal(moved.provider, backup.provider, "The agent did not move to its backup model.");
  assert.equal(moved.model, backup.id);
  assert.equal(report.taskState, "completed", "The channel task did not complete on the backup model.");
  assert.ok(report.channelNote, "The channel has no model switch note.");
  assert.ok(report.chatNote, "The agent's chat has no model switch note.");

  report.passed = true;
} finally {
  await client.cleanup();
  if (restore)
    await client
      .update(restore.id, {
        provider: restore.provider,
        model: restore.model,
        backupModels: restore.backupModels ?? null,
      })
      .catch(() => undefined);
  writeReport("channel-usage-limit-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
