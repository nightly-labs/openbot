import { randomUUID } from "node:crypto";
import { expect, test } from "./support/fixtures";
import { prompt } from "./support/scenario";
import { completed, conversation, newAgent, openAgent, providerThreads, resumeHost, send, t } from "./support/ui";

test("chat sends, streams, follows up, stops, and sends again", async ({ app, owner, serverId }) => {
  const agent = await newAgent(app);
  const id = randomUUID();
  await openAgent(app, agent.name);
  const view = app.page.getByRole("main", { name: t("conversation.view.label"), exact: true });
  const stop = app.page.getByRole("button", { name: t("composer.send.stop"), exact: true });
  const sendButton = app.page.getByRole("button", { name: t("composer.send.message"), exact: true });
  await send(
    app,
    agent.name,
    prompt({
      steps: [{ kind: "hold", key: `first-${id}` }],
      stream: ["First stream ", `${id} continues.`],
      reply: "First answer",
    }),
  );
  // Two deltas join in one message. The renderer can keep back an unfinished trailing word.
  await expect(view.getByText(new RegExp(`^First stream ${id}`))).toBeVisible();
  expect((await conversation(app, agent.id)).activeTurnId).not.toBeNull();
  await owner.release(`first-${id}`);
  await completed(app, agent.id, "First answer");
  await send(app, agent.name, prompt({ reply: "Follow-up answer" }));
  await completed(app, agent.id, "Follow-up answer");
  const stopped = `stop-${id}`;
  await send(
    app,
    agent.name,
    prompt({
      steps: [{ kind: "hold", key: stopped }],
      stream: [`Stopped stream ${id}`, " continues."],
      reply: `Must not appear ${id}`,
    }),
  );
  await expect(view.getByText(new RegExp(`^Stopped stream ${id}`))).toBeVisible();
  await stop.click();
  await expect(stop).toBeHidden();
  await expect(sendButton).toBeVisible();
  await expect.poll(async () => (await conversation(app, agent.id)).activeTurnId).toBeNull();
  await expect
    .poll(async () => (await providerThreads(owner, agent.id)).map((turns) => turns.at(-1)))
    .toEqual(["interrupted"]);
  // A turn that Stop did not end would continue now and save its reply.
  await owner.release(stopped);
  await send(app, agent.name, prompt({ reply: "After stop" }));
  await completed(app, agent.id, "After stop");
  // One provider thread, one turn for each prompt. Only the stopped turn is interrupted.
  expect(await providerThreads(owner, agent.id)).toEqual([
    ["completed", "completed", "completed", "interrupted", "completed"],
  ]);
  const messages = (await conversation(app, agent.id)).messages;
  for (const text of ["First answer", "Follow-up answer", "After stop"]) {
    expect(messages.filter((message) => message.text === text)).toHaveLength(1);
    await expect(view.getByText(text, { exact: true })).toBeVisible();
  }
  expect(messages.some((message) => message.text.includes(`Must not appear ${id}`))).toBe(false);
  await expect(view.getByText(`Must not appear ${id}`)).toHaveCount(0);
  expect(messages.findIndex((message) => message.text === "First answer")).toBeLessThan(
    messages.findIndex((message) => message.text === "Follow-up answer"),
  );
  expect(messages.findIndex((message) => message.text === "Follow-up answer")).toBeLessThan(
    messages.findIndex((message) => message.text === "After stop"),
  );
  // The remote client must show the host's saved conversation, not a copy of its own.
  if (serverId)
    expect((await conversation(owner, agent.id)).messages.map((message) => message.id)).toEqual(
      messages.map((message) => message.id),
    );
});

test("queue edits and removes pending input", async ({ app, owner }) => {
  const agent = await newAgent(app);
  const key = randomUUID();
  await openAgent(app, agent.name);
  const view = app.page.getByRole("main", { name: t("conversation.view.label"), exact: true });
  await send(app, agent.name, prompt({ steps: [{ kind: "hold", key }], reply: "Blocker finished" }));
  await expect(view.getByText(/^Working on the test/)).toBeVisible();
  await send(app, agent.name, prompt({ reply: "Old queued answer" }));
  await app.page.getByRole("button", { name: t("queue.item.editLabel", { position: 1 }) }).click();
  const composer = app.page.getByRole("textbox", { name: t("composer.placeholder.message", { name: agent.name }) });
  await expect(composer).toHaveText(prompt({ reply: "Old queued answer" }));
  await composer.fill(prompt({ reply: "Edited queued answer" }));
  await app.page.getByRole("button", { name: t("composer.send.saveQueued") }).click();
  const deleted = prompt({ reply: "Deleted queued answer" });
  await send(app, agent.name, deleted);
  const deletedRow = app.page.getByRole("group", { name: t("queue.item.label", { position: 2, preview: deleted }) });
  await expect(deletedRow).toBeVisible();
  await app.page.getByRole("button", { name: t("queue.item.deleteLabel", { position: 2 }) }).click();
  await expect(deletedRow).toHaveCount(0);
  await expect(app.page.getByTitle(deleted, { exact: true })).toHaveCount(0);
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
  await expect(view.getByText("Edited queued answer", { exact: true })).toBeVisible();
});

test("restart preserves identity and conversation", async ({ app, owner, serverId }) => {
  const agent = await newAgent(app);
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt({ reply: "Saved before restart" }));
  await completed(app, agent.id, "Saved before restart");
  const before = await conversation(app, agent.id);
  expect(before.threadId).not.toBeNull();
  await owner.restart();
  if (serverId) await resumeHost(app, owner, serverId);
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
