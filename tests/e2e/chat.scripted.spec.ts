import { randomUUID } from "node:crypto";
import { assertHost } from "./support/app";
import { expect, test } from "./support/fixtures";
import { prompt } from "./support/scenario";
import { completed, conversation, newAgent, openAgent, send, t } from "./support/ui";

test("chat sends, streams, follows up, stops, and sends again", async ({ app, owner }) => {
  const agent = await newAgent(app);
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt({ steps: [{ kind: "hold", key: "chat-stream" }], reply: "First answer" }));
  // The streaming renderer can retain an unfinished trailing word until the next chunk.
  await expect(app.page.getByText(/^Working on the test/)).toBeVisible();
  expect((await conversation(app, agent.id)).activeTurnId).not.toBeNull();
  await expect(app.page.getByText("First answer", { exact: true })).toHaveCount(0);
  await owner.release("chat-stream");
  await completed(app, agent.id, "First answer");
  await send(app, agent.name, prompt({ reply: "Follow-up answer" }));
  await completed(app, agent.id, "Follow-up answer");
  await send(app, agent.name, prompt({ steps: [{ kind: "hold", key: "never-release" }], reply: "Must not appear" }));
  await expect(app.page.getByText(/^Working on the test/)).toBeVisible();
  await app.page.getByRole("button", { name: t("composer.send.stop") }).click();
  await expect.poll(async () => (await conversation(app, agent.id)).activeTurnId).toBeNull();
  await send(app, agent.name, prompt({ reply: "After stop" }));
  await completed(app, agent.id, "After stop");
  const messages = (await conversation(app, agent.id)).messages;
  for (const text of ["First answer", "Follow-up answer", "After stop"]) {
    expect(messages.filter((message) => message.text === text)).toHaveLength(1);
    await expect(app.page.getByText(text, { exact: true })).toBeVisible();
  }
  expect(messages.some((message) => message.text === "Must not appear")).toBe(false);
  expect(messages.findIndex((message) => message.text === "First answer")).toBeLessThan(
    messages.findIndex((message) => message.text === "Follow-up answer"),
  );
  expect(messages.findIndex((message) => message.text === "Follow-up answer")).toBeLessThan(
    messages.findIndex((message) => message.text === "After stop"),
  );
  expect((await conversation(owner, agent.id)).messages.map((message) => message.id)).toEqual(
    messages.map((message) => message.id),
  );
});

test("queue edits and removes pending input", async ({ app, owner }) => {
  const agent = await newAgent(app);
  const key = randomUUID();
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt({ steps: [{ kind: "hold", key }], reply: "Blocker finished" }));
  await expect(app.page.getByText(/^Working on the test/)).toBeVisible();
  await send(app, agent.name, prompt({ reply: "Old queued answer" }));
  await app.page.getByRole("button", { name: t("queue.item.editLabel", { position: 1 }) }).click();
  await app.page
    .getByRole("textbox", { name: t("composer.placeholder.message", { name: agent.name }) })
    .fill(prompt({ reply: "Edited queued answer" }));
  await app.page.getByRole("button", { name: t("composer.send.saveQueued") }).click();
  await send(app, agent.name, prompt({ reply: "Deleted queued answer" }));
  await app.page.getByRole("button", { name: t("queue.item.deleteLabel", { position: 2 }) }).click();
  await expect
    .poll(() =>
      app.page.evaluate(
        (agentId) =>
          window.openbot.agent
            .listQueue(agentId)
            .then((queue) =>
              queue.deliveries.filter((delivery) => delivery.status === "queued").map((delivery) => delivery.text),
            ),
        agent.id,
      ),
    )
    .toEqual([prompt({ reply: "Edited queued answer" })]);
  await owner.release(key);
  await completed(app, agent.id, "Edited queued answer");
  const snapshot = await conversation(app, agent.id);
  expect(snapshot.messages.filter((message) => message.text === "Edited queued answer")).toHaveLength(1);
  expect(
    snapshot.messages.some((message) => ["Old queued answer", "Deleted queued answer"].includes(message.text)),
  ).toBe(false);
  await expect(app.page.getByText("Edited queued answer", { exact: true })).toBeVisible();
});

test("restart preserves identity and conversation", async ({ app, owner, serverId }) => {
  const agent = await newAgent(app);
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt({ reply: "Saved before restart" }));
  await completed(app, agent.id, "Saved before restart");
  const before = await conversation(app, agent.id);
  expect(before.threadId).not.toBeNull();
  await owner.restart();
  if (serverId) await assertHost(app, serverId);
  await openAgent(app, agent.name);
  await expect(
    app.page
      .getByRole("main", { name: t("conversation.view.label"), exact: true })
      .getByText("Saved before restart", { exact: true }),
  ).toBeVisible();
  const after = await conversation(app, agent.id);
  expect(after.threadId).toBe(before.threadId);
  expect(after.messages.map((message) => ({ id: message.id, text: message.text }))).toEqual(
    before.messages.map((message) => ({ id: message.id, text: message.text })),
  );
  const restored = (await app.page.evaluate(() => window.openbot.agent.listAgents())).find(
    (entry) => entry.id === agent.id,
  );
  expect(restored).toMatchObject({
    id: agent.id,
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    workspacePath: agent.workspacePath,
  });
  await send(app, agent.name, prompt({ reply: "Saved after restart" }));
  await completed(app, agent.id, "Saved after restart");
  expect((await conversation(app, agent.id)).threadId).toBe(before.threadId);
});

test("reconnect keeps a task result without duplicate submission", async ({ app, owner, serverId }) => {
  const agent = await newAgent(app);
  const key = randomUUID();
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt({ steps: [{ kind: "hold", key }], reply: "Result after reconnect" }));
  await expect.poll(async () => (await conversation(app, agent.id)).activeTurnId).not.toBeNull();
  const threadId = (await conversation(app, agent.id)).threadId;
  expect(threadId).not.toBeNull();
  if (serverId) {
    // Closing the client cuts the actual WebRTC peer. The host keeps the running turn.
    await app.stop();
    await owner.release(key);
    await completed(owner, agent.id, "Result after reconnect");
    await app.restart();
    await assertHost(app, serverId);
  } else {
    await app.page.reload();
    await owner.release(key);
  }
  await openAgent(app, agent.name);
  await completed(app, agent.id, "Result after reconnect");
  await expect(
    app.page
      .getByRole("main", { name: t("conversation.view.label"), exact: true })
      .getByText("Result after reconnect", { exact: true }),
  ).toBeVisible();
  expect((await conversation(app, agent.id)).threadId).toBe(threadId);
  expect(
    (await conversation(app, agent.id)).messages.filter((message) => message.text === "Result after reconnect"),
  ).toHaveLength(1);
});
