// Checks channel work when the user hides an agent or changes its provider, in this worktree's
// running dev app with real provider turns. Start the app with `bun run dev` (never `--shared`), then
// run `bun scripts/channel-hide-handoff-e2e.ts --allow-mutations [--provider=<provider id>]`. It needs
// three visible agents whose provider is signed in, and a second signed-in provider for the switch
// (default: the first other provider that lists a model).
//
// It checks that a hidden lead routes a task, that a hidden owner does its task, each while the
// agent stays hidden, and that after a provider switch the owner answers in the channel on the new
// provider, with the channel context. It makes its own
// channels and deletes them, restores each agent it hides, and gives the agent its provider back.
// Writes .openbot-build/channel-hide-handoff-e2e/report.json.
import assert from "node:assert/strict";
import { agentProviderDescriptor, isAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentSummary, ChannelPage, ChannelTask } from "@openbot/contracts/ipc";
import { argument, ChannelClient, connectChannelE2e, SHORT_PROMPT, waitFor, writeReport } from "./channel-e2e-support";

interface Report {
  hiddenLead?: { ownerWhileHidden: string | null; stillHidden: boolean };
  hiddenOwner?: { ownerWhileHidden: string | null; stateWhileHidden: string; stillHidden: boolean };
  providerSwitch?: { from: string; to: string; replied: boolean };
  passed: boolean;
}

const report: Report = { passed: false };
const session = await connectChannelE2e("channel-hide-handoff-e2e");
const { page } = session;
const client = new ChannelClient(page);
const hidden = new Set<string>();
let restoreProvider: { agent: AgentSummary } | null = null;

const newestTask = (channel: ChannelPage): ChannelTask | undefined => channel.tasks.at(-1);

try {
  const agents = (await client.agents()).filter((agent) => agentProviderDescriptor(agent.provider).concurrentTurns);
  assert.ok(agents.length >= 3, "This check needs three visible agents whose provider runs turns at the same time.");
  const [lead, b, c] = agents;
  assert.ok(lead && b && c);

  const isHidden = async (agentId: string) =>
    (await page.evaluate(() => window.openbot.agent.listHiddenAgents())).agents.some(
      (agent) => agent.agentId === agentId,
    );

  // 1. A hidden lead routes the task of a request that names no owner.
  const routed = await client.create("E2E hidden lead", [lead.id, b.id, c.id], lead.id);
  await client.setHidden(lead.id, true);
  hidden.add(lead.id);
  await client.send(routed.id, SHORT_PROMPT, null);
  const afterRoute = await waitFor(
    page,
    "the hidden lead routes the task",
    () => client.read(routed.id),
    (channel) => newestTask(channel)?.ownerAgentId != null,
  );
  report.hiddenLead = {
    ownerWhileHidden: newestTask(afterRoute)?.ownerAgentId ?? null,
    stillHidden: await isHidden(lead.id),
  };
  assert.ok(report.hiddenLead.stillHidden, "The channel work put the lead back in the list.");
  await client.setHidden(lead.id, false);
  hidden.delete(lead.id);

  // 2. A hidden owner does its task.
  const kept = await client.create("E2E hidden owner", [b.id, c.id], b.id);
  await client.setHidden(b.id, true);
  hidden.add(b.id);
  await client.send(kept.id, SHORT_PROMPT, b.id);
  const done = await waitFor(
    page,
    "the hidden owner does the task",
    () => client.read(kept.id),
    (channel) => ["completed", "failed", "paused"].includes(newestTask(channel)?.state ?? ""),
  );
  report.hiddenOwner = {
    ownerWhileHidden: newestTask(done)?.ownerAgentId ?? null,
    stateWhileHidden: newestTask(done)?.state ?? "missing",
    stillHidden: await isHidden(b.id),
  };
  assert.equal(report.hiddenOwner.ownerWhileHidden, b.id, "The task lost its owner.");
  assert.equal(report.hiddenOwner.stateWhileHidden, "completed", "A hidden owner did not do the channel task.");
  assert.ok(report.hiddenOwner.stillHidden, "The channel work put the owner back in the list.");
  await client.setHidden(b.id, false);
  hidden.delete(b.id);

  // 3. After a provider switch the owner answers in the channel on the new provider.
  const providerId = argument("provider");
  const models = await page.evaluate(() => window.openbot.agent.listModels());
  const target = models
    .flatMap((model) => (isAgentProvider(model.provider) ? [{ ...model, provider: model.provider }] : []))
    .find((model) => (providerId ? model.provider === providerId : model.provider !== c.provider));
  assert.ok(target, `No model of ${providerId ?? "another provider"} is available. Sign in, or pass --provider=<id>.`);
  const switched = await client.create("E2E provider switch", [c.id], c.id);
  await client.send(switched.id, "Remember the code word PELICAN. Reply with OK only. Do not use tools.", c.id);
  await waitFor(
    page,
    "the first channel turn completes",
    () => client.read(switched.id),
    (channel) => newestTask(channel)?.state === "completed",
  );
  restoreProvider = { agent: c };
  await client.update(c.id, { provider: target.provider, model: target.id });
  const sequence = (await client.read(switched.id)).throughSequence;
  await client.send(switched.id, "Which code word did I give you? Reply with the word only. Do not use tools.", c.id);
  const answered = await waitFor(
    page,
    "the owner answers on the new provider",
    () => client.read(switched.id),
    (channel) =>
      newestTask(channel)?.state === "failed" ||
      newestTask(channel)?.state === "paused" ||
      (newestTask(channel)?.state === "completed" &&
        channel.messages.some((message) => message.sequence > sequence && message.author.id === c.id)),
  );
  assert.equal(newestTask(answered)?.state, "completed", `The turn on ${target.provider} failed.`);
  const reply = answered.messages.filter((message) => message.sequence > sequence && message.author.id === c.id).at(-1);
  report.providerSwitch = { from: c.provider, to: target.provider, replied: reply !== undefined };
  assert.match(reply?.message.text ?? "", /pelican/i, "The answer on the new provider lost the channel context.");

  report.passed = true;
} finally {
  await client.cleanup();
  for (const agentId of hidden) await client.setHidden(agentId, false).catch(() => undefined);
  if (restoreProvider)
    await client
      .update(restoreProvider.agent.id, {
        provider: restoreProvider.agent.provider,
        model: restoreProvider.agent.model,
      })
      .catch(() => undefined);
  writeReport("channel-hide-handoff-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
