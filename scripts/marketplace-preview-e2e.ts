// Exercises an existing local dev app. Does not create, submit, or install Agents.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "marketplace-preview-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("marketplace-preview-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
});
try {
  const page = session.page;
  const open = page.getByRole("button", { name: "Open Marketplace", exact: true });
  if (await open.isVisible()) await open.click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await page.getByRole("button", { name: "Marketplace menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "My submissions", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Marketplace menu");
  const selector = page.getByRole("combobox", { name: "Agent to publish", exact: true });
  await selector.waitFor();
  const options = await selector
    .locator("option")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ value: node.getAttribute("value") ?? "", name: node.textContent ?? "" })),
    );
  const agents = options
    .filter((item, index) => options.findIndex((other) => other.name === item.name) === index)
    .slice(0, 3);
  assert.ok(agents.length >= 2, "This check needs at least two local Agents with different names.");
  const category = page.getByRole("combobox", { name: "Agent category", exact: true });
  const submit = page.getByRole("button", { name: "Submit for review", exact: true });
  const measurements = [];
  for (const [index, agent] of agents.entries()) {
    await selector.focus();
    await selector.selectOption(agent.value);
    await page.getByRole("heading", { name: agent.name, exact: true }).waitFor();
    await page.waitForFunction(
      () => document.querySelector(".agent-publish-card")?.getAttribute("aria-busy") === "false",
    );
    assert.equal(
      await selector.evaluate((node) => document.activeElement === node),
      true,
      "Agent selector lost focus.",
    );
    assert.equal(await submit.isEnabled(), true);
    if (index === 0) await category.selectOption("research");
    assert.equal(await category.inputValue(), "research", "Changing Agent reset the draft category.");
    measurements.push(
      await page.locator(".agent-publish-card").evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { top: rect.top, height: rect.height };
      }),
    );
  }
  const first = agents[0];
  const last = agents.at(-1);
  assert.ok(first && last);
  await selector.selectOption(first.value);
  await selector.selectOption(last.value);
  await page.getByRole("heading", { name: last.name, exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector(".agent-publish-card")?.getAttribute("aria-busy") === "false",
  );
  assert.equal(await category.inputValue(), "research");
  assert.equal(await submit.isEnabled(), true);
  // Report geometry for visual QA; keep behavior assertions separate from CSS layout.
  process.stdout.write(
    `${JSON.stringify({ passed: true, agentsChecked: agents.length, cardMeasurements: measurements })}\n`,
  );
} finally {
  await session.close();
}
