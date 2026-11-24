import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { readyProvider } from "./live-agent";

const ANSWER_MS = 180_000;
const PROMPT = "Join these letters into one word and reply with only that word: P, O, N, G. Do not use tools.";
const ANSWER = "PONG";

test("the agent answers a message", async ({ app, screen, browser }) => {
  await app.open("/");
  const { provider, model } = await readyProvider(browser);

  const name = `Live ${provider}`;
  const agentId = await browser.evaluate(
    async (input) =>
      (
        await window.openbot.agent.createAgent({
          name: input.name,
          description: "Answers one test message.",
          avatarSeed: `live-${input.provider}`,
          avatarHue: null,
          initialMessage: "Reply with only the word ready. Do not use tools.",
          provider: input.provider,
          model: input.model,
        })
      ).id,
    { name, provider, model },
  );
  try {
    await app.open("/");
    const composer = screen.getByRole("textbox", `Message ${name}`);
    await composer.fill(PROMPT);
    await composer.press("Enter");
    await expect(screen.getByText(ANSWER).first()).toBeVisible({ timeout: ANSWER_MS });
    await app.screenshot("answered");
  } catch (error) {
    await app.screenshot("no-answer").catch(() => undefined);
    throw error;
  } finally {
    await browser
      .evaluate((id) => window.openbot.agent.deleteAgent(id).then(() => null), agentId)
      .catch(() => undefined);
  }
});
