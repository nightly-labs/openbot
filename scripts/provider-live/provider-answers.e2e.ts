// One real turn on one provider, through the real desktop window. The test runs one time for each
// target of `e2e.config.ts`; the profile of the target says which provider it is. It makes an agent
// on that provider, sends one message in the chat, and waits for the answer of the real model.
import { test } from "@e2e-dev/web";
import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { expect } from "e2e";
import { isLiveProvider, LIVE_MODELS } from "./targets";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const POLL_MS = 500;
/** A first run downloads the provider CLI before the provider can start. */
const PROVIDER_READY_MS = 300_000;
const ANSWER_MS = 180_000;
// The message does not hold the answer, so only a reply of the model can show it.
const PROMPT = "Join these letters into one word and reply with only that word: P, O, N, G. Do not use tools.";
const ANSWER = "PONG";
/** The states in which a provider does not change without the user. */
const SETTLED_STATES = ["available", "sign-in-required", "error", "outdated"];

/** Reads `read` again until `ready` accepts the value. The app sends no event to the test. */
async function waitFor<T>(label: string, limitMs: number, read: () => Promise<T>, ready: (value: T) => boolean) {
  const deadline = Date.now() + limitMs;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}. Last value: ${JSON.stringify(value)}`);
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

test("the agent answers a message", async ({ app, screen, browser }) => {
  await app.open("/");
  const provider = await waitFor(
    "the app bridge",
    30_000,
    () => browser.evaluate(async () => (await window.openbot?.getSetupState())?.preferredProvider ?? null),
    (preferred) => preferred !== null,
  );
  if (!isLiveProvider(provider)) throw new Error(`The profile names no live provider: ${String(provider)}`);

  // The provider must have its CLI and the user's sign-in. Only the download can be started here.
  let downloadStarted = false;
  const status = await waitFor(
    `${provider} is available`,
    PROVIDER_READY_MS,
    async () => {
      const found = await browser.evaluate(async (id) => {
        const current = (await window.openbot.agent.getStatus()).providers?.find((candidate) => candidate.id === id);
        return current ? { state: current.state, message: current.message } : null;
      }, provider);
      if (found?.state === "not-installed" && !downloadStarted) {
        downloadStarted = true;
        await browser.evaluate((id) => window.openbot.providerRuntimes.download(id).then(() => null), provider);
      }
      return found;
    },
    (found) => found !== null && SETTLED_STATES.includes(found.state),
  );
  expect(status, `${provider} needs a sign-in or a repair on this computer`).toMatchObject({ state: "available" });

  const models = await waitFor(
    `the ${provider} models`,
    60_000,
    () =>
      browser.evaluate(
        async (id) =>
          (await window.openbot.agent.listModels()).filter((model) => model.provider === id).map((model) => model.id),
        provider,
      ),
    (listed) => listed.length > 0,
  );
  const model = models.find((id) => id === LIVE_MODELS[provider]) ?? models[0];
  if (!model) throw new Error(`No ${provider} model.`);

  // The profile is the test's own. An earlier run that stopped early can leave its agent.
  await browser.evaluate(async () => {
    for (const left of await window.openbot.agent.listAgents()) await window.openbot.agent.deleteAgent(left.id);
    return null;
  });

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
