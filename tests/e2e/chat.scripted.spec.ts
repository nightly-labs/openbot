import { randomUUID } from "node:crypto";
import { assertHost } from "./support/app";
import { expect, test } from "./support/fixtures";
import { prompt } from "./support/scenario";
import { completed, conversation, newAgent, openAgent, send, t } from "./support/ui";

test("chat sends, streams, follows up, stops, and sends again", async ({ app, owner }) => {
  const agent = await newAgent(app);
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt({ steps: [{ kind: "hold", key: "chat-stream" }], reply: "First answer" }));
  await expect(app.page.getByText("Working on the test task.", { exact: true })).toBeVisible();
  await owner.release("chat-stream");
  await completed(app, agent.id, "First answer");
  await send(app, agent.name, prompt({ reply: "Follow-up answer" }));
  await completed(app, agent.id, "Follow-up answer");
  await send(app, agent.name, prompt({ steps: [{ kind: "hold", key: "never-release" }], reply: "Must not appear" }));
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
    messages.findIndex((message) => message.text === "After stop"),
  );
});

test("queue edits and removes pending input", async ({ app, owner }) => {
  const agent = await newAgent(app);
  const key = randomUUID();
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt({ steps: [{ kind: "hold", key }], reply: "Blocker finished" }));
  await expect(app.page.getByText("Working on the test task.", { exact: true })).toBeVisible();
  await send(app, agent.name, prompt({ reply: "Old queued answer" }));
  await app.page.getByRole("button", { name: t("queue.item.editLabel", { position: 1 }) }).click();
  await app.page
    .getByRole("textbox", { name: t("composer.placeholder.message", { name: agent.name }) })
    .fill(prompt({ reply: "Edited queued answer" }));
  await app.page.getByRole("button", { name: t("composer.send.saveQueued") }).click();
  await send(app, agent.name, prompt({ reply: "Deleted queued answer" }));
  await app.page.getByRole("button", { name: t("queue.item.deleteLabel", { position: 2 }) }).click();
  await owner.release(key);
  await completed(app, agent.id, "Edited queued answer");
  const snapshot = await conversation(app, agent.id);
  expect(snapshot.messages.filter((message) => message.text === "Edited queued answer")).toHaveLength(1);
  expect(
    snapshot.messages.some((message) => ["Old queued answer", "Deleted queued answer"].includes(message.text)),
  ).toBe(false);
});

test("restart preserves identity and conversation", async ({ app, owner, serverId }) => {
  const agent = await newAgent(app);
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt({ reply: "Saved before restart" }));
  await completed(app, agent.id, "Saved before restart");
  const before = await conversation(app, agent.id);
  await owner.restart();
  if (serverId) await assertHost(app, serverId);
  await openAgent(app, agent.name);
  await expect(app.page.getByText("Saved before restart", { exact: true })).toBeVisible();
  const after = await conversation(app, agent.id);
  expect(after.threadId).toBe(before.threadId);
  expect(after.messages.map((message) => message.id)).toEqual(before.messages.map((message) => message.id));
  await send(app, agent.name, prompt({ reply: "Saved after restart" }));
  await completed(app, agent.id, "Saved after restart");
});

test("reconnect keeps a task result without duplicate submission", async ({ app, owner, serverId }) => {
  const agent = await newAgent(app);
  const key = randomUUID();
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt({ steps: [{ kind: "hold", key }], reply: "Result after reconnect" }));
  await expect.poll(async () => (await conversation(app, agent.id)).activeTurnId).not.toBeNull();
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
  await expect(app.page.getByText("Result after reconnect", { exact: true })).toBeVisible();
  expect(
    (await conversation(app, agent.id)).messages.filter((message) => message.text === "Result after reconnect"),
  ).toHaveLength(1);
});
