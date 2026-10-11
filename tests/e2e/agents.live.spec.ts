import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import type { CreateAgentInput } from "@openbot/contracts/ipc";
import { expect, test } from "./support/fixtures";
import { modelFor, providers, settings } from "./support/settings";
import { conversation, createGroup, openAgent, selectModel, send, sendGroup, t } from "./support/ui";

test.use({ realProviders: true });

test("live-switch preserves an agent and its files across provider changes", async ({ app, owner }, testInfo) => {
  testInfo.annotations.push(
    ...(["codex", "claude"] as const).map((provider) => ({
      type: "model",
      description: `${provider}:${modelFor(provider)}`,
    })),
  );
  const marker = randomUUID();
  const agent = await app.page.evaluate((input) => window.openbot.agent.createAgent(input), {
    name: `Switch ${marker.slice(0, 8)}`,
    description: "Provider switch release test",
    initialMessage: "Reply READY without tools.",
    provider: "codex",
    model: modelFor("codex"),
    reasoningEffort: "low",
    avatarSeed: marker,
    avatarHue: null,
  } satisfies CreateAgentInput);
  await expect
    .poll(
      async () => {
        const snapshot = await conversation(app, agent.id);
        return (
          snapshot.activeTurnId === null &&
          snapshot.messages.some((item) => item.author === "assistant" && item.text.includes("READY"))
        );
      },
      { timeout: 120_000 },
    )
    .toBe(true);
  await openAgent(app, agent.name);
  const filename = `switch-${marker}.txt`;
  const content = `Preserved ${marker}`;
  await send(
    app,
    agent.name,
    `Write ${filename} in your workspace with exact contents "${content}" and no newline. Attach it with openbot.attach_files_to_response. Reply FILE READY.`,
  );
  await expect
    .poll(
      async () =>
        (await conversation(app, agent.id)).messages.some((item) =>
          item.attachments?.some((file) => file.name === filename),
        ),
      { timeout: 120_000 },
    )
    .toBe(true);
  await expect.poll(async () => (await conversation(app, agent.id)).activeTurnId).toBeNull();
  const before = await conversation(app, agent.id);
  expect(before.threadId).not.toBeNull();
  const path = join(owner.profile, "workspace-home/OpenBot/Agents", agent.id, filename);
  expect(await readFile(path, "utf8")).toBe(content);
  for (const provider of ["claude", "codex"] as const) {
    await selectModel(app, provider, modelFor(provider));
    await expect
      .poll(
        async () =>
          (await app.page.evaluate(() => window.openbot.agent.listAgents())).find((item) => item.id === agent.id)
            ?.provider,
      )
      .toBe(provider);
    const restored = (await app.page.evaluate(() => window.openbot.agent.listAgents())).find(
      (item) => item.id === agent.id,
    );
    expect(restored).toMatchObject({ name: agent.name, workspacePath: agent.workspacePath, model: modelFor(provider) });
    const history = await conversation(app, agent.id);
    expect(history.threadId).toBe(before.threadId);
    expect(history.messages.filter((item) => before.messages.some((previous) => previous.id === item.id))).toEqual(
      before.messages,
    );
    await send(
      app,
      agent.name,
      `Read ${filename} from your workspace. Reply with "${provider} confirmed: " followed by the exact file contents. Do not edit the file.`,
    );
    await expect
      .poll(
        async () => {
          const snapshot = await conversation(app, agent.id);
          return (
            snapshot.activeTurnId === null &&
            snapshot.messages.some(
              (item) => item.author === "assistant" && item.text.includes(`${provider} confirmed: ${content}`),
            )
          );
        },
        { timeout: 120_000 },
      )
      .toBe(true);
    expect(await readFile(path, "utf8")).toBe(content);
    expect((await conversation(app, agent.id)).threadId).toBe(before.threadId);
  }
  await app.page.getByRole("button", { name: t("attachment.preview", { name: filename }), exact: true }).click();
  await expect(app.page.getByRole("complementary", { name: t("preview.panel.label") })).toContainText(content);
  await app.page.getByRole("button", { name: t("preview.panel.close") }).click();
});

for (const provider of providers) {
  test(`live-${provider === "antigravity" ? "gemini" : provider} creates a child, delegates browser work, and generates files`, async ({
    app,
    owner,
  }, testInfo) => {
    const agentId = `release-${provider}`;
    const agent = (await app.page.evaluate(() => window.openbot.agent.listAgents())).find(
      (item) => item.id === agentId,
    );
    if (!agent) throw new Error(`Missing ${provider} test agent.`);
    const id = randomUUID();
    const childName = `Worker ${id.slice(0, 8)}`;
    const filename = `report-${id}.txt`;
    const title = `Counter ${id.slice(0, 8)}`;
    testInfo.annotations.push(
      { type: "provider", description: provider },
      { type: "model", description: modelFor(provider) },
    );
    await openAgent(app, agent.name);
    await send(
      app,
      agent.name,
      [
        `Run this release test. Create one persistent OpenBot agent named "${childName}" with your provider and model.`,
        'Its initial task is "Reply READY without tools". Then use openbot.send_message to give it this exact task:',
        `"Use openbot_browser to open ${settings().siteUrl}/?case=${id}. Read the reference on that page.`,
        'Call type with target {"kind":"role","role":"textbox","name":"Result"} and text set to the reference.',
        'Call click with target {"kind":"role","role":"button","name":"Save result"}. Include tabId in every browser call.',
        'Confirm the returned page says Saved followed by the reference. Then reply to the requester with the reference and result."',
        "End your turn while waiting for its reply. After its reply, do these two actions yourself:",
        `1. Write ${filename} in your workspace with the exact content "Release ${id}: 42" (no trailing newline) and attach it with openbot.attach_files_to_response.`,
        `2. Use openbot.html_render with title "${title}" to show a self-contained HTML page with one button initially labelled "Count: 0".`,
        'Clicking the button must change its label to "Count: 1". Do not publish a website. Finish with a short report.',
      ].join("\n"),
    );
    await expect
      .poll(() => fetch(`${settings().siteUrl}/receipts?case=${id}`).then((response) => response.json()), {
        timeout: 120_000,
        message: `${provider} child must submit the browser form.`,
      })
      .toEqual(["42"]);
    await expect
      .poll(
        async () =>
          (await conversation(app, agent.id)).messages.some((message) =>
            message.attachments?.some((file) => file.name === filename),
          ),
        { timeout: 120_000 },
      )
      .toBe(true);
    await expect.poll(async () => (await conversation(app, agent.id)).activeTurnId).toBeNull();
    const children = (await app.page.evaluate(() => window.openbot.agent.listAgents())).filter(
      (item) => item.name === childName,
    );
    expect(children).toHaveLength(1);
    const child = children[0];
    expect(child?.provider).toBe(provider);
    expect(child?.model).toBe(modelFor(provider));
    if (!child) throw new Error("The real provider did not create its child.");
    await expect.poll(async () => (await conversation(app, child.id)).activeTurnId).toBeNull();
    const childHistory = await conversation(app, child.id);
    const delegated = childHistory.messages.filter(
      (message) => message.senderAgentId === agent.id && message.text.includes(id),
    );
    expect(delegated).toHaveLength(1);
    expect(delegated[0]?.status).toBe("completed");
    const parentHistory = await conversation(app, agent.id);
    expect(
      parentHistory.messages.some((message) => message.senderAgentId === child.id && message.text.includes("42")),
    ).toBe(true);
    expect(await readFile(join(owner.profile, "workspace-home/OpenBot/Agents", agent.id, filename), "utf8")).toBe(
      `Release ${id}: 42`,
    );
    await app.page.getByRole("button", { name: t("attachment.preview", { name: filename }), exact: true }).click();
    await expect(app.page.getByRole("complementary", { name: t("preview.panel.label") })).toContainText(
      `Release ${id}: 42`,
    );
    await app.page.getByRole("button", { name: t("preview.panel.close") }).click();
    await expect(app.page.getByRole("complementary", { name: t("preview.panel.label") })).not.toBeVisible();
    const visual = app.page.getByTitle(title, { exact: true });
    // The frame moves when the preview closes. Wait for its actionability before targeting its content.
    await visual.click({ trial: true });
    const frame = visual.contentFrame();
    const counter = frame.getByRole("button");
    await expect(counter).toHaveAccessibleName("Count: 0");
    await counter.click();
    await expect(counter).toHaveAccessibleName("Count: 1");
    expect(await fetch(`${settings().siteUrl}/receipts?case=${id}`).then((response) => response.json())).toEqual([
      "42",
    ]);
  });
}

test("live-group routes Codex to Claude to OpenCode within a group", async ({ app }, testInfo) => {
  const groupProviders = ["codex", "claude", "opencode"] as const;
  testInfo.annotations.push(
    ...groupProviders.map((provider) => ({ type: "model", description: `${provider}:${modelFor(provider)}` })),
  );
  const agents = await app.page.evaluate(() => window.openbot.agent.listAgents());
  const members = groupProviders.map((provider) => {
    const agent = agents.find((item) => item.id === `release-${provider}`);
    if (!agent) throw new Error(`Missing ${provider} test agent.`);
    return agent;
  });
  const [codex, claude, opencode] = members;
  if (!codex || !claude || !opencode) throw new Error("Three providers are required.");
  const marker = `Chain ${randomUUID()}`;
  const group = await createGroup(app.page, marker, members);
  await sendGroup(
    app.page,
    [
      `${serializeChatTagReference("agent", codex.name, codex.id)} use channel_assign to give ${claude.name} (${claude.id}) this task:`,
      `"Use channel_assign to ask ${opencode.name} (${opencode.id}) to compute 6 * 7 and report '${marker}: 42' with channel_result.`,
      `End your turn while it works. When it answers, use channel_result to return '${marker}: 42'."`,
      `When Claude answers, publish '${marker}: 42' with channel_result. Do not use send_message in this group.`,
      "Use resources ['none']; this task needs no files, browser, or commands.",
    ].join("\n"),
  );
  await expect
    .poll(
      () =>
        app.page
          .evaluate((channelId) => window.openbot.agent.readChannel({ channelId }), group.id)
          .then((page) =>
            groupProviders.every((provider) =>
              page.tasks.some((task) => task.ownerAgentId === `release-${provider}` && task.state === "completed"),
            ),
          ),
      { timeout: 120_000 },
    )
    .toBe(true);
  const history = await app.page.evaluate((channelId) => window.openbot.agent.readChannel({ channelId }), group.id);
  for (const member of members) expect(history.tasks.filter((task) => task.ownerAgentId === member.id)).toHaveLength(1);
  const codexTask = history.tasks.find((task) => task.ownerAgentId === codex.id);
  const claudeTask = history.tasks.find((task) => task.ownerAgentId === claude.id);
  const opencodeTask = history.tasks.find((task) => task.ownerAgentId === opencode.id);
  if (!codexTask || !claudeTask || !opencodeTask) throw new Error("The group task chain is incomplete.");
  expect(claudeTask.parentTaskId).toBe(codexTask.id);
  expect(opencodeTask.parentTaskId).toBe(claudeTask.id);
  for (const member of members)
    await expect
      .poll(
        async () => {
          const current = await app.page.evaluate(
            (channelId) => window.openbot.agent.readChannel({ channelId }),
            group.id,
          );
          return current.messages.some(
            (message) => message.author.id === member.id && message.message.text.includes(`${marker}: 42`),
          );
        },
        { message: `${member.name} must publish its group result.` },
      )
      .toBe(true);
  await expect(app.page.getByText(`${marker}: 42`, { exact: true }).first()).toBeVisible();
});
