import { randomUUID } from "node:crypto";
import type { AgentSummary, CreateAgentInput } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { expect, type Page } from "@playwright/test";
import type { TestApp } from "./app";
import { prompt } from "./scenario";
import { scriptedModel } from "./settings";

const t = translateFor("en");

export async function newAgent(app: TestApp, name = `Test ${randomUUID().slice(0, 8)}`): Promise<AgentSummary> {
  const agent = await app.page.evaluate((input) => window.openbot.agent.createAgent(input), {
    name,
    description: "Complete only the release test task.",
    avatarSeed: randomUUID(),
    avatarHue: null,
    initialMessage: prompt({ reply: "Ready." }),
    provider: "codex",
    model: scriptedModel,
    reasoningEffort: "low",
  } satisfies CreateAgentInput);
  await completed(app, agent.id, "Ready.");
  return agent;
}

export async function openAgent(app: TestApp, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await app.page.getByRole("button", { name: new RegExp(`^${escaped}(?:[,.]|$)`) }).click();
  await expect(app.page.getByRole("textbox", { name: t("composer.placeholder.message", { name }) })).toBeVisible();
}

export async function send(app: TestApp, name: string, text: string) {
  await app.page.getByRole("textbox", { name: t("composer.placeholder.message", { name }) }).fill(text);
  await app.page.getByRole("button", { name: t("composer.send.message"), exact: true }).click();
}

export function conversation(app: TestApp, id: string) {
  return app.page.evaluate((agentId) => window.openbot.agent.readConversation(agentId), id);
}

export async function completed(app: TestApp, id: string, text: string) {
  await expect
    .poll(
      async () => {
        const snapshot = await conversation(app, id);
        return snapshot.activeTurnId === null && snapshot.messages.some((message) => message.text.includes(text));
      },
      { timeout: 120_000, message: `The agent must finish with ${text}.` },
    )
    .toBe(true);
}

export async function createGroup(page: Page, name: string, members: AgentSummary[]) {
  await page.getByRole("button", { name: t("sidebar.new.menu"), exact: true }).click();
  await page.getByRole("menuitem", { name: t("sidebar.new.channel"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: t("channel.form.name") }).fill(name);
  for (const agent of members) await dialog.getByRole("checkbox", { name: new RegExp(agent.name) }).check();
  await dialog.getByRole("button", { name: t("common.create"), exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const channel = (await page.evaluate(() => window.openbot.agent.listChannels())).find((item) => item.name === name);
  if (!channel) throw new Error("The created group is missing.");
  return channel;
}

export async function sendGroup(page: Page, text: string) {
  await page.getByRole("textbox", { name: t("channel.composer.label") }).fill(text);
  await page.getByRole("button", { name: t("channel.composer.send"), exact: true }).click();
}

export async function openRoutines(app: TestApp) {
  await app.page.getByRole("button", { name: t("conversation.header.settings"), exact: true }).click();
  await app.page.getByRole("button", { name: /^Routines(?:\s|$)/ }).click();
}

export { t };
