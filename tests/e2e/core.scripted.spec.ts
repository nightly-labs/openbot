import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./support/fixtures";
import { prompt } from "./support/scenario";
import { scriptedModel } from "./support/settings";
import { completed, conversation, newAgent, openAgent, selectModel, send, t, upload } from "./support/ui";

test("ui-create creates an agent with the selected model and sends its first message", async ({ app }) => {
  const name = `Setup ${randomUUID().slice(0, 8)}`;
  await app.page.getByRole("button", { name: t("sidebar.new.menu"), exact: true }).click();
  await app.page.getByRole("menuitem", { name: t("sidebar.new.agent"), exact: true }).click();
  await app.page.getByRole("textbox", { name: t("agent.setup.name"), exact: true }).fill(name);
  await app.page
    .getByRole("textbox", { name: t("agent.setup.purpose"), exact: true })
    .fill(prompt({ reply: "Setup complete" }));
  await selectModel(app, "codex", scriptedModel, true);
  await app.page.getByRole("button", { name: t("agent.setup.create"), exact: true }).click();
  await expect(app.page.getByRole("textbox", { name: t("composer.placeholder.message", { name }) })).toBeVisible();
  const matches = (await app.page.evaluate(() => window.openbot.agent.listAgents())).filter(
    (item) => item.name === name,
  );
  expect(matches).toHaveLength(1);
  const agent = matches[0];
  if (!agent) throw new Error("The created agent is missing.");
  expect(agent).toMatchObject({ provider: "codex", model: scriptedModel });
  await completed(app, agent.id, "Setup complete");
  await send(app, name, prompt({ reply: "First user request complete" }));
  await completed(app, agent.id, "First user request complete");
  expect(
    (await conversation(app, agent.id)).messages.filter((item) => item.text === "First user request complete"),
  ).toHaveLength(1);
});

test("conversation-isolation keeps streaming results, drafts and attachments in their conversation", async ({
  app,
  owner,
}) => {
  const first = await newAgent(app);
  const second = await newAgent(app);
  const key = randomUUID();
  await openAgent(app, first.name);
  await send(app, first.name, prompt({ steps: [{ kind: "hold", key }], reply: `First result ${key}` }));
  await expect.poll(async () => (await conversation(app, first.id)).activeTurnId).not.toBeNull();
  const filename = `draft-${key}.txt`;
  const path = join(app.profile, filename);
  const content = `Uploaded content ${randomUUID()}`;
  await writeFile(path, content);
  await upload(app, path);
  const draft = prompt({ steps: [{ kind: "read-upload", name: filename, save: "file" }], reply: "$result:file" });
  await app.page.getByRole("textbox", { name: t("composer.placeholder.message", { name: first.name }) }).fill(draft);
  await openAgent(app, second.name);
  const secondComposer = app.page.getByRole("textbox", {
    name: t("composer.placeholder.message", { name: second.name }),
  });
  await expect(secondComposer).toHaveText("");
  await expect(
    app.page.getByRole("button", { name: t("composer.attachment.remove", { name: filename }) }),
  ).not.toBeVisible();
  await send(app, second.name, prompt({ reply: `Second result ${key}` }));
  await completed(app, second.id, `Second result ${key}`);
  await owner.release(key);
  await completed(app, first.id, `First result ${key}`);
  const view = app.page.getByRole("main", { name: t("conversation.view.label") });
  await expect(view.getByText(`First result ${key}`, { exact: true })).not.toBeVisible();
  await openAgent(app, first.name);
  await expect(
    app.page.getByRole("textbox", { name: t("composer.placeholder.message", { name: first.name }) }),
  ).toHaveText(draft);
  await expect(
    app.page.getByRole("button", { name: t("composer.attachment.remove", { name: filename }) }),
  ).toBeVisible();
  await app.page.getByRole("button", { name: t("composer.send.message"), exact: true }).click();
  await completed(app, first.id, content);
  const a = await conversation(owner, first.id);
  const b = await conversation(owner, second.id);
  expect(a.messages.filter((item) => item.author === "assistant" && item.text === content)).toHaveLength(1);
  expect(
    a.messages
      .filter((item) => item.author === "user" && item.text === draft)
      .map((item) => item.attachments?.map((file) => file.name)),
  ).toEqual([[filename]]);
  expect(a.messages.some((item) => item.text === `Second result ${key}`)).toBe(false);
  expect(
    b.messages.some(
      (item) =>
        item.text === `First result ${key}` ||
        item.text === draft ||
        item.attachments?.some((file) => file.name === filename),
    ),
  ).toBe(false);
});

test("history loads older messages and preserves the reading position while new work completes", async ({
  app,
  owner,
}) => {
  const agent = await newAgent(app);
  const marker = randomUUID();
  // Setup uses real sends and storage. More than 50 messages forces history pagination.
  for (let i = 0; i < 30; i++) {
    const reply = `History ${marker} item ${i}`;
    await app.page.evaluate((input) => window.openbot.agent.sendMessage(input), {
      agentId: agent.id,
      text: prompt({ reply }),
    });
    await completed(app, agent.id, reply);
  }
  const latest = `New result ${marker}`;
  await app.page.evaluate((input) => window.openbot.agent.sendMessage(input), {
    agentId: agent.id,
    text: prompt({ steps: [{ kind: "hold", key: marker }], reply: latest }),
  });
  await expect.poll(async () => (await conversation(app, agent.id)).activeTurnId).not.toBeNull();
  const tail = (await conversation(app, agent.id)).messages.find((item) => item.text === `History ${marker} item 29`);
  if (!tail) throw new Error("The history fixture is empty.");
  await app.page.evaluate((input) => window.openbot.agent.markConversationRead(input), {
    agentId: agent.id,
    throughMessageId: tail.id,
  });
  const page = await app.page.evaluate(
    (agentId) => window.openbot.agent.readConversationPage({ agentId, anchor: { type: "latest" }, limit: 50 }),
    agent.id,
  );
  expect(page.pageInfo.hasOlder).toBe(true);
  expect(page.messages.some((item) => item.text === `History ${marker} item 0`)).toBe(false);
  await app.page.reload();
  await openAgent(app, agent.name);
  const view = app.page.getByRole("main", { name: t("conversation.view.label") });
  const stop = app.page.getByRole("button", { name: t("composer.send.stop"), exact: true });
  await expect(stop).toBeVisible();
  const oldest = view.getByText(`History ${marker} item 0`, { exact: true });
  await expect(oldest).not.toBeInViewport();
  await view.hover();
  await expect(async () => {
    await app.page.mouse.wheel(0, -1600);
    await expect(oldest).toBeInViewport({ timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await owner.release(marker);
  await completed(app, agent.id, latest);
  await expect(stop).not.toBeVisible();
  await expect(oldest).toBeInViewport();
  await app.page.getByRole("button", { name: /new message|latest message/i }).click();
  await expect(view.getByText(latest, { exact: true })).toBeInViewport();
  const messages = (await conversation(app, agent.id)).messages;
  expect(messages.filter((item) => item.text === latest)).toHaveLength(1);
});
