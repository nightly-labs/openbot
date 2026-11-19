// One real turn on one provider, through the real desktop window. The test runs one time for each
// target of `e2e.config.ts`; the profile of the target says which provider it is. It makes an agent
// on that provider, sends one message in the chat, and waits for the answer of the real model.
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { readyProvider } from "./live-agent";

const ANSWER_MS = 180_000;
// The message does not hold the answer, so only a reply of the model can show it.
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
    // The window shows an agent that the bridge made only after it loads again. The profile has
    // one agent, so the window opens its chat.
    await app.open("/");
    const composer = screen.getByRole("textbox", `Message ${name}`);
    await composer.fill(PROMPT);
    await composer.press("Enter");
    // The answer is in the message and in the chat list.
    await expect(screen.getByText(ANSWER).first()).toBeVisible({ timeout: ANSWER_MS });
    await app.screenshot("answered");
  } catch (error) {
    // The chat shows the error of the provider. The picture at the failure is too late: the agent
    // is deleted by then.
    await app.screenshot("no-answer").catch(() => undefined);
    throw error;
  } finally {
    // The agent has a folder in the user's OpenBot home, outside the profile.
    await browser
      .evaluate((id) => window.openbot.agent.deleteAgent(id).then(() => null), agentId)
      .catch(() => undefined);
  }
});
