import { randomUUID } from "node:crypto";
import { assertHost } from "./support/app";
import { expect, test } from "./support/fixtures";
import { prompt } from "./support/scenario";
import { completed, conversation, newAgent, openAgent, providerThreads, send, t } from "./support/ui";

test("reconnect keeps a task result without duplicate submission", async ({ app, owner, serverId }) => {
  if (!serverId) throw new Error("This case requires a remote client.");
  const agent = await newAgent(app);
  const id = randomUUID();
  // Each restart replaces the client page.
  const view = () => app.page.getByRole("main", { name: t("conversation.view.label"), exact: true });
  await openAgent(app, agent.name);
  const threadId = (await conversation(app, agent.id)).threadId;
  expect(threadId).not.toBeNull();
  // The agent's first turn runs on creation.
  expect(await providerThreads(owner, agent.id)).toEqual([["completed"]]);

  // The turn completes while the client is closed.
  const away = prompt({ steps: [{ kind: "hold", key: `away-${id}` }], reply: `Result while away ${id}` });
  await send(app, agent.name, away);
  await expect.poll(async () => (await conversation(app, agent.id)).activeTurnId).not.toBeNull();
  // Closing the client cuts the actual WebRTC peer. The host keeps the running turn.
  await app.restart({
    whileStopped: async () => {
      await owner.release(`away-${id}`);
      await completed(owner, agent.id, `Result while away ${id}`);
    },
  });
  await assertHost(app, serverId);
  await openAgent(app, agent.name);
  await expect(view().getByText(`Result while away ${id}`, { exact: true })).toBeVisible();

  // The client comes back while the turn still runs. The result arrives after the reconnect.
  const running = prompt({
    steps: [{ kind: "hold", key: `running-${id}` }],
    stream: [`Running stream ${id}`, " continues."],
    reply: `Result after reconnect ${id}`,
  });
  await send(app, agent.name, running);
  await expect(view().getByText(new RegExp(`^Running stream ${id}`))).toBeVisible();
  await app.restart();
  await assertHost(app, serverId);
  await openAgent(app, agent.name);
  await expect(app.page.getByRole("button", { name: t("composer.send.stop"), exact: true })).toBeVisible();
  expect((await conversation(app, agent.id)).activeTurnId).not.toBeNull();
  await owner.release(`running-${id}`);
  await completed(app, agent.id, `Result after reconnect ${id}`);
  await expect(view().getByText(`Result after reconnect ${id}`, { exact: true })).toBeVisible();

  const snapshot = await conversation(app, agent.id);
  expect(snapshot.threadId).toBe(threadId);
  for (const { input, result } of [
    { input: away, result: `Result while away ${id}` },
    { input: running, result: `Result after reconnect ${id}` },
  ]) {
    expect(snapshot.messages.filter((message) => message.author === "user" && message.text === input)).toHaveLength(1);
    expect(snapshot.messages.filter((message) => message.text === result)).toHaveLength(1);
    await expect(view().getByText(result, { exact: true })).toHaveCount(1);
  }
  // One provider turn for each submitted prompt: a reconnect must not submit it again.
  expect(await providerThreads(owner, agent.id)).toEqual([["completed", "completed", "completed"]]);
  expect((await conversation(owner, agent.id)).messages.map((message) => message.id)).toEqual(
    snapshot.messages.map((message) => message.id),
  );
});
