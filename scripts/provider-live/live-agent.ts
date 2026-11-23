import type { Browser } from "@e2e-dev/web";
import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { expect } from "e2e";
import { isLiveProvider, LIVE_MODELS, type LiveProvider } from "./targets";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const POLL_MS = 500;
const PROVIDER_READY_MS = 300_000;
const SETTLED_STATES = ["available", "sign-in-required", "error", "outdated"];

export async function waitFor<T>(
  label: string,
  limitMs: number,
  read: () => Promise<T>,
  ready: (value: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + limitMs;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}. Last value: ${JSON.stringify(value)}`);
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

export async function readyProvider(browser: Browser): Promise<{ provider: LiveProvider; model: string }> {
  const provider = await waitFor(
    "the app bridge",
    30_000,
    () => browser.evaluate(async () => (await window.openbot?.getSetupState())?.preferredProvider ?? null),
    (preferred) => preferred !== null,
  );
  if (!isLiveProvider(provider)) throw new Error(`The profile names no live provider: ${String(provider)}`);

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

  await browser.evaluate(async () => {
    for (const left of await window.openbot.agent.listAgents()) await window.openbot.agent.deleteAgent(left.id);
    return null;
  });
  return { provider, model };
}
