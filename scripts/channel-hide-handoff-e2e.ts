// Checks channel work when the user hides an agent or changes its provider, in this worktree's
// running dev app with real provider turns. Start the app with `bun run dev` (never `--shared`), then
// run `bun scripts/channel-hide-handoff-e2e.ts --allow-mutations [--provider=<provider id>]`. It needs
// three visible agents whose provider is signed in, and a second signed-in provider for the switch
// (default: the first other provider that lists a model).
//
// It checks that a hidden lead does not route and that a restore lets it route, that a hidden owner
// keeps its queued task and does not start it until the restore, and that after a provider switch
// the owner answers in the channel on the new provider, with the channel context. It makes its own
// channels and deletes them, restores each agent it hides, and gives the agent its provider back.
// Writes .openbot-build/channel-hide-handoff-e2e/report.json.
import assert from "node:assert/strict";
import { agentProviderDescriptor, isAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentSummary, ChannelPage, ChannelTask } from "@openbot/contracts/ipc";
import {
  argument,
  ChannelClient,
  connectChannelE2e,
  LONG_PROMPT,
  queueBusy,
  SHORT_PROMPT,
  waitFor,
  writeReport,
} from "./channel-e2e-support";

// A hidden agent must not route or start channel work. The script cannot wait for an event that
// does not come, so it watches the task for this long before the restore.
const QUIET_WINDOW_MS = 8_000;

interface Report {
  hiddenLead?: { ownerWhileHidden: string | null; ownerAfterRestore: string | null };
  hiddenOwner?: { ownerWhileHidden: string | null; stateWhileHidden: string; stateAfterRestore: string };
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

  // 1. A hidden lead routes nothing; the restore routes the waiting task.
  const routed = await client.create("E2E hidden lead", [lead.id, b.id, c.id], lead.id);
  await client.setHidden(lead.id, true);
  hidden.add(lead.id);
  await client.send(routed.id, SHORT_PROMPT, null);
  const queued = await waitFor(
    page,
    "the request makes a task",
    () => client.read(routed.id),
    (channel) => newestTask(channel) !== undefined,
  );
  const waiting = newestTask(queued);
  assert.ok(waiting);
  await page.waitForTimeout(QUIET_WINDOW_MS);
  const stillWaiting = (await client.read(routed.id)).tasks.find((task) => task.id === waiting.id);
  await client.setHidden(lead.id, false);
  hidden.delete(lead.id);
  const afterRestore = await waitFor(
    page,
    "the restored lead routes the task",
    () => client.read(routed.id),
    (channel) => channel.tasks.find((task) => task.id === waiting.id)?.ownerAgentId != null,
  );
  report.hiddenLead = {
    ownerWhileHidden: stillWaiting?.ownerAgentId ?? null,
    ownerAfterRestore: afterRestore.tasks.find((task) => task.id === waiting.id)?.ownerAgentId ?? null,
  };
  assert.equal(stillWaiting?.ownerAgentId, null, "A hidden lead routed the task.");
  assert.equal(stillWaiting?.state, "queued");

  // 2. A hidden owner keeps its task and does not start it. Its own chat turn keeps it busy until
  // the hide, so the task is still queued then; the script then stops that turn to free the agent.
  const kept = await client.create("E2E hidden owner", [b.id, c.id], b.id);
  await client.sendToAgent(b.id, LONG_PROMPT);
  await waitFor(page, "the owner's own chat runs", () => client.queue(b.id), queueBusy);
  await client.send(kept.id, SHORT_PROMPT, b.id);
  const assigned = await waitFor(
    page,
    "the task waits for the busy owner",
    () => client.read(kept.id),
    (channel) => newestTask(channel)?.ownerAgentId === b.id,
  );
  const owned = newestTask(assigned);
  assert.ok(owned);
  assert.equal(owned.state, "queued", "The channel turn started while the owner's own chat ran.");
  await client.setHidden(b.id, true);
  hidden.add(b.id);
  await client.stopOwnChat(b.id);
  await waitFor(
    page,
    "the owner's own chat stops",
    () => client.queue(b.id),
    (snapshot) => !queueBusy(snapshot),
  );
  await page.waitForTimeout(QUIET_WINDOW_MS);
  const whileHidden = (await client.read(kept.id)).tasks.find((task) => task.id === owned.id);
  await client.setHidden(b.id, false);
  hidden.delete(b.id);
  const restored = await waitFor(
    page,
    "the restored owner does the task",
    () => client.read(kept.id),
    (channel) => channel.tasks.find((task) => task.id === owned.id)?.state === "completed",
  );
  report.hiddenOwner = {
    ownerWhileHidden: whileHidden?.ownerAgentId ?? null,
    stateWhileHidden: whileHidden?.state ?? "missing",
    stateAfterRestore: restored.tasks.find((task) => task.id === owned.id)?.state ?? "missing",
  };
  assert.equal(whileHidden?.ownerAgentId, b.id, "The task lost its owner.");
  assert.equal(whileHidden?.state, "queued", "A hidden owner started the channel task.");

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
