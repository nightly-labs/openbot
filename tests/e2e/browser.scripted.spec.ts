import { randomUUID } from "node:crypto";
import { expect, test } from "./support/fixtures";
import { prompt, type Scenario } from "./support/scenario";
import { settings } from "./support/settings";
import { completed, newAgent, openAgent, send, t } from "./support/ui";

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
  await expect(app.page.getByText("Browser task complete", { exact: true })).toBeVisible();
});

test("takeover lets the user return browser control to the agent", async ({ app }) => {
  const agent = await newAgent(app);
  const id = randomUUID();
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt(browserTask(`${settings().siteUrl}/?case=${id}`, true)));
  await expect(app.page.getByRole("button", { name: t("prompt.browser.done"), exact: true })).toBeVisible();
  await app.page
    .getByRole("button", { name: t("prompt.browser.openPage", { title: "Release test form" }), exact: true })
    .click();
  await app.page.getByRole("button", { name: t("browser.reload"), exact: true }).click();
  await app.page.getByRole("button", { name: t("prompt.browser.done"), exact: true }).click();
  await completed(app, agent.id, "Browser task complete");
  expect(await fetch(`${settings().siteUrl}/receipts?case=${id}`).then((response) => response.json())).toEqual(["42"]);
});

for (const accepted of [true, false]) {
  test(`approval-${accepted ? "accept" : "decline"} returns the user decision`, async ({ app }) => {
    const agent = await newAgent(app);
    await openAgent(app, agent.name);
    await send(app, agent.name, prompt({ steps: [{ kind: "approval" }], reply: "Approval result" }));
    await app.page
      .getByRole("button", { name: t(accepted ? "prompt.approval.allow" : "prompt.approval.deny"), exact: true })
      .click();
    await completed(app, agent.id, "Approval result");
    const snapshot = await app.page.evaluate((id) => window.openbot.agent.readConversation(id), agent.id);
    expect(snapshot.messages.find((message) => message.text.startsWith("Approval result"))?.text).toContain(
      accepted ? "accept" : "decline",
    );
  });
}

test("question returns the selected answer to the provider", async ({ app }) => {
  const agent = await newAgent(app);
  await openAgent(app, agent.name);
  await send(app, agent.name, prompt({ steps: [{ kind: "question" }], reply: "Question result" }));
  await app.page.getByRole("radio", { name: /Green/ }).check();
  await completed(app, agent.id, "Question result");
  const snapshot = await app.page.evaluate((id) => window.openbot.agent.readConversation(id), agent.id);
  expect(snapshot.messages.find((message) => message.text.startsWith("Question result"))?.text).toContain("Green");
});
