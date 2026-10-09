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
  const children = (await app.page.evaluate(() => window.openbot.agent.listAgents())).filter(
    (agent) => agent.name === name,
  );
  expect(children).toHaveLength(1);
  const child = children[0];
  expect(child?.provider).toBe(parent.provider);
  if (!child) throw new Error("The child was not created.");
  expect(child.model).toBe(parent.model);
  await openAgent(app, child.name);
  const view = app.page.getByRole("main", { name: t("conversation.view.label"), exact: true });
  const childMessages = (await conversation(app, child.id)).messages;
  for (const text of ["Child initial task complete", "Child delegated result 42"]) {
    await expect(view.getByText(text, { exact: true })).toBeVisible();
    expect(childMessages.filter((message) => message.author === "assistant" && message.text === text)).toHaveLength(1);
  }
  const parentMessages = (await conversation(app, parent.id)).messages;
  expect(
    parentMessages.filter(
      (message) =>
        message.senderAgentId === child.id && message.text.includes("Status: done\nResult: Child delegated result 42"),
    ),
  ).toHaveLength(1);
});

test("delegate delivers two parallel requests and routes replies once", async ({ app, owner }, testInfo) => {
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
  await app.page.getByRole("button", { name: t("chat.marker.agentCount", { count: 2 }), exact: true }).click();
  await expect(app.page.getByRole("menuitem", { name: new RegExp(first.name) })).toBeVisible();
  await app.page.screenshot({ path: testInfo.outputPath("recipient-menu.png") });
  await app.page.getByRole("menuitem", { name: new RegExp(first.name) }).click();
  await expect(
    app.page.getByRole("textbox", { name: t("composer.placeholder.message", { name: first.name }) }),
  ).toBeVisible();
  await owner.release(key);
  await expect
    .poll(async () =>
      (await conversation(app, parent.id)).messages
        .filter((message) => message.text.includes("Status: done\nResult: Parallel result"))
        .map((message) => message.senderAgentId)
        .sort(),
    )
    .toEqual([first.id, second.id].sort());
  for (const child of [first, second]) {
    await completed(app, child.id, "Parallel result");
    expect(
      (await conversation(app, child.id)).messages.filter((message) => message.text === "Parallel result"),
    ).toHaveLength(1);
  }
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
  await expect(
    app.page.getByLabel(
      t("chat.marker.accessible.message", {
        label: t("chat.marker.messaged"),
        agent: child.name,
        status: t("chat.marker.status.failed"),
      }),
      { exact: true },
    ),
  ).toBeVisible();
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
  const replies = (await conversation(app, parent.id)).messages.filter((message) => message.senderAgentId === child.id);
  expect(replies.filter((message) => message.text.includes("Status: done\nResult: Delegation recovered"))).toHaveLength(
    1,
  );
  expect(
    replies.some(
      (message) => message.text.includes("Cancelled child result") || message.text.includes("Must not finish"),
    ),
  ).toBe(false);
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
  await expect
    .poll(() =>
      app.page
        .evaluate((channelId) => window.openbot.agent.readChannel({ channelId }), group.id)
        .then((page) =>
          page.tasks
            .filter((task) => task.state === "completed")
            .map((task) => task.ownerAgentId)
            .sort(),
        ),
    )
    .toEqual([lead.id, worker.id].sort());
  const page = await app.page.evaluate((channelId) => window.openbot.agent.readChannel({ channelId }), group.id);
  const leadTask = page.tasks.find((task) => task.ownerAgentId === lead.id);
  expect(page.tasks.find((task) => task.ownerAgentId === worker.id)?.parentTaskId).toBe(leadTask?.id);
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
  await expect
    .poll(() =>
      app.page
        .evaluate((channelId) => window.openbot.agent.readChannel({ channelId }), group.id)
        .then((snapshot) =>
          snapshot.tasks
            .filter((task) => !page.tasks.some((previous) => previous.id === task.id))
            .map((task) => ({ owner: task.ownerAgentId, state: task.state })),
        ),
    )
    .toEqual([{ owner: lead.id, state: "completed" }]);
});
