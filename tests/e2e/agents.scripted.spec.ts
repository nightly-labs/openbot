import { randomUUID } from "node:crypto";
import { expect, test } from "./support/fixtures";
import { prompt } from "./support/scenario";
import { completed, conversation, createGroup, newAgent, openAgent, send, sendGroup, t } from "./support/ui";

test("create-agent creates a child, runs its task, and returns a reply", async ({ app }) => {
  const parent = await newAgent(app);
  const name = `Child ${randomUUID().slice(0, 8)}`;
  await openAgent(app, parent.name);
  await send(
    app,
    parent.name,
    prompt({
      steps: [
        {
          kind: "tool",
          name: "create_agent",
          save: "child",
          args: {
            name,
            description: "Release test child.",
            initialMessage: prompt({ reply: "Child initial task complete" }),
          },
        },
        {
          kind: "tool",
          name: "send_message",
          args: { recipientAgentIds: ["$result:child.id"], text: prompt({ reply: "Child delegated result 42" }) },
        },
      ],
      reply: "Child created",
    }),
  );
  await completed(app, parent.id, "Child delegated result 42");
  const child = (await app.page.evaluate(() => window.openbot.agent.listAgents())).find((agent) => agent.name === name);
  expect(child?.provider).toBe(parent.provider);
  if (!child) throw new Error("The child was not created.");
  expect(child.model).toBe(parent.model);
  await openAgent(app, child.name);
  await expect(app.page.getByText("Child initial task complete", { exact: true })).toBeVisible();
  await expect(app.page.getByText("Child delegated result 42", { exact: true })).toBeVisible();
  const parentMessages = (await conversation(app, parent.id)).messages;
  expect(
    parentMessages.filter((message) => message.text.includes("Status: done\nResult: Child delegated result 42")),
  ).toHaveLength(1);
});

test("delegate delivers two parallel requests and routes replies once", async ({ app, owner }) => {
  const parent = await newAgent(app);
  const first = await newAgent(app);
  const second = await newAgent(app);
  const key = randomUUID();
  await openAgent(app, parent.name);
  await send(
    app,
    parent.name,
    prompt({
      steps: [
        {
          kind: "tool",
          name: "send_message",
          args: {
            recipientAgentIds: [first.id, second.id],
            text: prompt({ steps: [{ kind: "hold", key }], reply: "Parallel result" }),
          },
        },
      ],
      reply: "Waiting for two replies",
    }),
  );
  await expect
    .poll(async () => {
      const a = await conversation(app, first.id);
      const b = await conversation(app, second.id);
      return Boolean(a.activeTurnId && b.activeTurnId);
    })
    .toBe(true);
  await expect(app.page.getByText(first.name, { exact: true }).last()).toBeVisible();
  await owner.release(key);
  await expect
    .poll(
      async () =>
        (await conversation(app, parent.id)).messages.filter((message) =>
          message.text.includes("Status: done\nResult: Parallel result"),
        ).length,
    )
    .toBe(2);
});

test("child-failure exposes failed work, cancels delegated work, and recovers", async ({ app }) => {
  const parent = await newAgent(app);
  const child = await newAgent(app);
  await openAgent(app, parent.name);
  await send(
    app,
    parent.name,
    prompt({
      steps: [
        {
          kind: "tool",
          name: "send_message",
          args: {
            recipientAgentIds: [child.id],
            text: prompt({ steps: [{ kind: "fail", message: "Fixture child failure" }], reply: "Must not finish" }),
          },
        },
      ],
      reply: "Request sent",
    }),
  );
  await expect
    .poll(() =>
      app.page
        .evaluate((agentId) => window.openbot.agent.listQueue(agentId), child.id)
        .then((queue) => queue.deliveries.some((delivery) => delivery.status === "failed")),
    )
    .toBe(true);
  await openAgent(app, child.name);
  await expect(app.page.getByText(/Fixture child failure/).first()).toBeVisible();
  await send(app, child.name, prompt({ reply: "Child recovered" }));
  await completed(app, child.id, "Child recovered");
  await openAgent(app, parent.name);
  await send(
    app,
    parent.name,
    prompt({
      steps: [
        {
          kind: "tool",
          name: "send_message",
          args: {
            recipientAgentIds: [child.id],
            text: prompt({ steps: [{ kind: "hold", key: randomUUID() }], reply: "Cancelled child result" }),
          },
        },
      ],
      reply: "Child work dispatched",
    }),
  );
  await expect.poll(async () => (await conversation(app, child.id)).activeTurnId).not.toBeNull();
  await send(
    app,
    parent.name,
    prompt({
      steps: [
        {
          kind: "tool",
          name: "interrupt_agent",
          args: {
            agentId: child.id,
            reason: "The user cancelled the delegated task.",
          },
        },
      ],
      reply: "Child work cancelled",
    }),
  );
  await completed(app, parent.id, "Child work cancelled");
  await expect.poll(async () => (await conversation(app, child.id)).activeTurnId).toBeNull();
  expect(
    (await conversation(app, child.id)).messages.some((message) => message.text === "Cancelled child result"),
  ).toBe(false);
  await send(
    app,
    parent.name,
    prompt({
      steps: [
        {
          kind: "tool",
          name: "send_message",
          args: {
            recipientAgentIds: [child.id],
            text: prompt({ reply: "Delegation recovered" }),
          },
        },
      ],
      reply: "Recovery dispatched",
    }),
  );
  await completed(app, parent.id, "Status: done\nResult: Delegation recovered");
});

test("group delegates inside a group and supports member removal", async ({ app }) => {
  const lead = await newAgent(app);
  const worker = await newAgent(app);
  const group = await createGroup(app.page, `Group ${randomUUID().slice(0, 8)}`, [lead, worker]);
  const childTask = prompt({
    steps: [{ kind: "tool", name: "channel_result", args: { text: "Group result 42" } }],
    reply: "Group task finished",
  });
  await sendGroup(
    app.page,
    prompt({
      steps: [
        {
          kind: "tool",
          name: "channel_assign",
          args: {
            recipientAgentId: worker.id,
            task: childTask,
            expectedResult: "Group result 42",
            sourceMessageIds: ["$result:context.task.requestMessageId"],
            resources: ["none"],
          },
        },
      ],
      reply: "Group assignment sent",
    }),
  );
  await expect(app.page.getByText("Group result 42", { exact: true })).toBeVisible();
  const page = await app.page.evaluate((channelId) => window.openbot.agent.readChannel({ channelId }), group.id);
  expect(page.tasks.some((task) => task.ownerAgentId === worker.id && task.state === "completed")).toBe(true);
  await app.page.getByRole("button", { name: t("channel.settings.title"), exact: true }).click();
  await app.page.getByRole("button", { name: t("channel.members.remove", { name: worker.name }) }).click();
  await expect
    .poll(() =>
      app.page
        .evaluate(() => window.openbot.agent.listChannels())
        .then((channels) =>
          channels.find((channel) => channel.id === group.id)?.members.map((member) => member.agentId),
        ),
    )
    .toEqual([lead.id]);
  await app.page.getByRole("button", { name: t("channel.panel.close") }).click();
  await sendGroup(
    app.page,
    prompt({
      steps: [{ kind: "tool", name: "channel_result", args: { text: "Remaining member result" } }],
      reply: "Done",
    }),
  );
  await expect(app.page.getByText("Remaining member result", { exact: true })).toBeVisible();
});
