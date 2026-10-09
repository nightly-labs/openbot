import { randomUUID } from "node:crypto";
import { expect, test } from "./support/fixtures";
import { prompt, type Scenario } from "./support/scenario";
import { settings } from "./support/settings";
import { completed, conversation, newAgent, openAgent, send, t } from "./support/ui";

function browserTask(url: string, takeover: boolean): Scenario {
  return {
    steps: [
      { kind: "tool", namespace: "openbot_browser", name: "open", args: { url }, save: "browser" },
      ...(takeover
        ? [
            {
              kind: "tool" as const,
              namespace: "openbot_browser" as const,
              name: "request_takeover",
              args: { tabId: "$result:browser.tab.id" },
            },
          ]
        : []),
      {
        kind: "tool",
        namespace: "openbot_browser",
        name: "type",
        args: {
          tabId: "$result:browser.tab.id",
          target: { kind: "role", role: "textbox", name: "Result" },
          text: "42",
        },
      },
      {
        kind: "tool",
        namespace: "openbot_browser",
        name: "click",
        args: { tabId: "$result:browser.tab.id", target: { kind: "role", role: "button", name: "Save result" } },
      },
      {
        kind: "tool",
        namespace: "openbot_browser",
        name: "snapshot",
        args: { tabId: "$result:browser.tab.id", image: "never" },
      },
      { kind: "tool", namespace: "openbot_browser", name: "close_tab", args: { tabId: "$result:browser.tab.id" } },
    ],
    reply: "Browser task complete",
  };
}

test("browser submits a form through real browser tools", async ({ app }) => {
  const agent = await newAgent(app);
  const id = randomUUID();
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt(browserTask(`${settings().siteUrl}/?case=${id}`, false)));
  await completed(app, agent.id, "Browser task complete");
  expect(await fetch(`${settings().siteUrl}/receipts?case=${id}`).then((response) => response.json())).toEqual(["42"]);
  expect(
    (await conversation(app, agent.id)).messages.filter(
      (message) => message.author === "assistant" && message.text === "Browser task complete",
    ),
  ).toHaveLength(1);
  await expect(
    app.page
      .getByRole("main", { name: t("conversation.view.label"), exact: true })
      .getByText("Browser task complete", { exact: true }),
  ).toBeVisible();
});

test("takeover lets the user return browser control to the agent", async ({ app }) => {
  const agent = await newAgent(app);
  const id = randomUUID();
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt(browserTask(`${settings().siteUrl}/?case=${id}`, true)));
  await expect(app.page.getByRole("button", { name: t("prompt.browser.done"), exact: true })).toBeVisible();
  expect((await conversation(app, agent.id)).activeTurnId).not.toBeNull();
  expect(await fetch(`${settings().siteUrl}/receipts?case=${id}`).then((response) => response.json())).toEqual([]);
  await app.page
    .getByRole("button", { name: t("prompt.browser.openPage", { title: "Release test form" }), exact: true })
    .click();
  await app.page.getByRole("button", { name: t("browser.reload"), exact: true }).click();
  await app.page.getByRole("button", { name: t("browser.hide"), exact: true }).click();
  await app.page.getByRole("button", { name: t("prompt.browser.done"), exact: true }).click();
  await completed(app, agent.id, "Browser task complete");
  await expect(app.page.getByRole("button", { name: t("prompt.browser.done"), exact: true })).not.toBeVisible();
  expect(await app.page.evaluate(() => window.openbot.browser.listTabs())).toEqual([]);
  expect(await fetch(`${settings().siteUrl}/receipts?case=${id}`).then((response) => response.json())).toEqual(["42"]);
});

for (const accepted of [true, false]) {
  test(`approval-${accepted ? "accept" : "decline"} returns the user decision`, async ({ app, owner }) => {
    const agent = await newAgent(app);
    await owner.page.evaluate(
      (agentId) => window.openbot.setApprovalAutomation({ agentId, autoApprove: false, turbo: false }),
      agent.id,
    );
    await openAgent(app, agent.name);
    await send(app, agent.name, prompt({ steps: [{ kind: "approval" }], reply: "Approval result" }));
    const allow = app.page.getByRole("button", { name: t("prompt.approval.allow"), exact: true });
    const deny = app.page.getByRole("button", { name: t("prompt.approval.deny"), exact: true });
    await expect(allow).toBeVisible();
    await expect(deny).toBeVisible();
    const pending = await conversation(app, agent.id);
    expect(pending.activeTurnId).not.toBeNull();
    expect(pending.messages.some((message) => message.text.startsWith("Approval result"))).toBe(false);
    await (accepted ? allow : deny).click();
    await completed(app, agent.id, "Approval result");
    const snapshot = await app.page.evaluate((id) => window.openbot.agent.readConversation(id), agent.id);
    const replies = snapshot.messages.filter(
      (message) => message.author === "assistant" && message.text.startsWith("Approval result "),
    );
    expect(replies.map((message) => JSON.parse(message.text.slice("Approval result ".length)))).toEqual([
      { decision: accepted ? "accept" : "decline" },
    ]);
    await expect(allow).not.toBeVisible();
    await expect(deny).not.toBeVisible();
  });
}

test("question returns the selected answer to the provider", async ({ app }) => {
  const agent = await newAgent(app);
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt({ steps: [{ kind: "question" }], reply: "Question result" }));
  const choice = app.page.getByRole("radio", { name: /Green/ });
  await expect(choice).toBeVisible();
  const pending = await conversation(app, agent.id);
  expect(pending.activeTurnId).not.toBeNull();
  expect(pending.messages.some((message) => message.text.startsWith("Question result"))).toBe(false);
  await choice.click();
  await completed(app, agent.id, "Question result");
  const snapshot = await app.page.evaluate((id) => window.openbot.agent.readConversation(id), agent.id);
  const replies = snapshot.messages.filter(
    (message) => message.author === "assistant" && message.text.startsWith("Question result "),
  );
  expect(replies.map((message) => JSON.parse(message.text.slice("Question result ".length)))).toEqual([
    { answers: { colour: { answers: ["Green"] } } },
  ]);
  await expect(choice).not.toBeVisible();
});
