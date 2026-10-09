import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { redactText } from "@openbot/logging";
import { test as base, expect } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { assertHost, joinHost, TestApp, testEmail } from "./app";
import { output, providers, settings } from "./settings";

interface Stack {
  owner: TestApp;
  client: TestApp;
  serverId: string | null;
}
interface WorkerFixtures {
  realProviders: boolean;
  stack: Stack;
}
interface TestFixtures {
  app: TestApp;
  owner: TestApp;
  serverId: string | null;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  realProviders: [false, { option: true, scope: "worker" }],
  stack: [
    async ({ realProviders }, use, workerInfo) => {
      await mkdir(output, { recursive: true });
      const directory = await mkdtemp(join(settings().directory, "app-"));
      const owner = await TestApp.start(join(directory, "owner"), realProviders, testEmail());
      let client = owner;
      try {
        let serverId: string | null = null;
        if (workerInfo.project.name === "host") {
          client = await TestApp.start(join(directory, "client"), realProviders, testEmail());
          serverId = await joinHost(owner, client);
        }
        // No provider fallback: each requested model must be available before the first test.
        if (realProviders) {
          const agents = await client.page.evaluate(() => window.openbot.agent.listAgents());
          for (const provider of providers) {
            const agent = agents.find((entry) => entry.id === `release-${provider}`);
            expect(agent?.provider).toBe(provider);
            await expect
              .poll(
                () =>
                  client.page
                    .evaluate(() => window.openbot.agent.listModels())
                    .then((models) => models.some((model) => model.provider === provider && model.id === agent?.model)),
                { timeout: 60_000, message: `${provider} model is required.` },
              )
              .toBe(true);
            const model = (await client.page.evaluate(() => window.openbot.agent.listModels())).find(
              (entry) => entry.provider === provider && entry.id === agent?.model,
            );
            if (agent && model && !model.supportedReasoningEfforts.includes(agent.reasoningEffort)) {
              await client.page.evaluate((input) => window.openbot.agent.updateAgent(input), {
                agentId: agent.id,
                reasoningEffort: model.defaultReasoningEffort,
              });
            }
          }
        }
        await use({ owner, client, serverId });
      } finally {
        if (client !== owner) await client.stop();
        await owner.stop();
        await rm(directory, { recursive: true, force: true });
      }
    },
    { scope: "worker", timeout: 180_000 },
  ],
  owner: async ({ stack }, use) => {
    await use(stack.owner);
  },
  serverId: async ({ stack }, use) => {
    await use(stack.serverId);
  },
  app: async ({ stack }, use, testInfo) => {
    if (stack.serverId) await assertHost(stack.client, stack.serverId);
    const context = stack.client.page.context();
    // Actions only. Network bodies, source files, and credential-screen snapshots are not recorded.
    await context.tracing.start({ snapshots: false, screenshots: false, sources: false });
    try {
      await use(stack.client);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        const artifactRoot = join(output, "report", testInfo.testId.replaceAll(/[^a-zA-Z0-9_-]/g, "_"));
        await mkdir(artifactRoot, { recursive: true });
        await stack.client.page.screenshot({ path: join(artifactRoot, "failure.png") }).catch(() => undefined);
        const raw = join(stack.client.profile, "trace.zip");
        await context.tracing.stop({ path: raw }).catch(() => undefined);
        try {
          const entries = unzipSync(await readFile(raw));
          // Without snapshots there are no binary resources. Reject an unexpected trace format.
          const safe = Object.fromEntries(
            Object.entries(entries).map(([name, bytes]) => {
              if (!/\.(trace|network|stacks)$/u.test(name)) throw new Error("Unexpected trace resource.");
              return [name, strToU8(redactText(strFromU8(bytes)))];
            }),
          );
          await writeFile(join(artifactRoot, "trace.zip"), zipSync(safe));
        } catch {
          /* Keep the UI screenshot and report when the trace cannot be safely exported. */
        }
      } else await context.tracing.stop().catch(() => undefined);
    }
  },
});

export { expect };
