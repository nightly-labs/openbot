import { randomUUID } from "node:crypto";
import type { TestApp } from "./support/app";
import { expect, test } from "./support/fixtures";
import { prompt, type Scenario } from "./support/scenario";
import { settings } from "./support/settings";
import { completed, conversation, newAgent, openAgent, send, t } from "./support/ui";

// With takeover, the user fills the form and the agent only submits it, so the receipt shows the user's value.
function browserTask(url: string, takeover: boolean): Scenario {
  const tabId = "$result:browser.tab.id";
  return {
    steps: [
      { kind: "tool", namespace: "openbot_browser", name: "open", args: { url }, save: "browser" },
      takeover
        ? { kind: "tool", namespace: "openbot_browser", name: "request_takeover", args: { tabId }, save: "takeover" }
        : {
            kind: "tool",
            namespace: "openbot_browser",
            name: "type",
            args: { tabId, target: { kind: "role", role: "textbox", name: "Result" }, text: "42" },
          },
      {
        kind: "tool",
        namespace: "openbot_browser",
        name: "click",
        args: { tabId, target: { kind: "role", role: "button", name: "Save result" } },
      },
      { kind: "tool", namespace: "openbot_browser", name: "snapshot", args: { tabId, image: "never" } },
      { kind: "tool", namespace: "openbot_browser", name: "close_tab", args: { tabId } },
    ],
    reply: takeover ? "Browser task complete $result:takeover" : "Browser task complete",
  };
}

function receipts(id: string) {
  return fetch(`${settings().siteUrl}/receipts?case=${id}`).then((response) => response.json());
}

async function caseTabs(app: TestApp, id: string) {
  return (await app.page.evaluate(() => window.openbot.browser.listTabs())).filter((tab) => tab.url.includes(id));
}

test("browser submits a form through real browser tools", async ({ app }) => {
  const agent = await newAgent(app);
  const id = randomUUID();
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt(browserTask(`${settings().siteUrl}/?case=${id}`, false)));
  await completed(app, agent.id, "Browser task complete");
  expect(await receipts(id)).toEqual(["42"]);
  expect(await caseTabs(app, id)).toEqual([]);
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

test("takeover lets the user return browser control to the agent", async ({ app, owner }) => {
  const agent = await newAgent(app);
  const id = randomUUID();
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt(browserTask(`${settings().siteUrl}/?case=${id}`, true)));
  const done = app.page.getByRole("button", { name: t("prompt.browser.done"), exact: true });
  await expect(done).toBeVisible();
  expect((await conversation(app, agent.id)).activeTurnId).not.toBeNull();
  expect(await receipts(id)).toEqual([]);
  // The tab is a page of the app that runs the browser: this app locally, the owner in host mode.
  await expect.poll(() => owner.application.windows().some((window) => window.url().includes(id))).toBe(true);
  const tab = owner.application.windows().find((window) => window.url().includes(id));
  if (!tab) throw new Error("The takeover tab is missing.");
  await app.page
    .getByRole("button", { name: t("prompt.browser.openPage", { title: "Release test form" }), exact: true })
    .click();
  const panel = app.page.getByRole("complementary", { name: t("browser.panel.label"), exact: true });
  await expect(panel).toBeVisible();
  await Promise.all([
    tab.waitForEvent("load"),
    app.page.getByRole("button", { name: t("browser.reload"), exact: true }).click(),
  ]);
  await tab.getByRole("textbox", { name: "Result" }).fill("43");
  await app.page.getByRole("button", { name: t("browser.hide"), exact: true }).click();
  await expect(panel).not.toBeVisible();
  await done.click();
  await completed(app, agent.id, "Browser task complete");
  await expect(done).not.toBeVisible();
  const replies = (await conversation(app, agent.id)).messages.filter(
    (message) => message.author === "assistant" && message.text.startsWith("Browser task complete "),
  );
  expect(replies.map((message) => JSON.parse(message.text.slice("Browser task complete ".length)))).toEqual([
    expect.objectContaining({ status: "completed" }),
  ]);
  expect(await caseTabs(app, id)).toEqual([]);
  // The agent submitted the page that the user edited during takeover.
  expect(await receipts(id)).toEqual(["43"]);
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
