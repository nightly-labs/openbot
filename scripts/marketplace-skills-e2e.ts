// Exercises an existing local dev app with the local catalog. Adds the "Change Review" skill to
// agents through the Agents dialog, undoes it, removes it, and turns it off and on. Four more skills
// go to Chief for the sort check and leave again. At the end no agent has any of them.
// Writes .openbot-build/marketplace-skills-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

const OUT = resolve(import.meta.dirname, "../.openbot-build/marketplace-skills-e2e");
const SKILL = "Change Review";
/** The Undo toast stays this long, and then the held removes commit. */
const TOAST_WAIT = 15_000;

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "marketplace-skills-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("marketplace-skills-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const steps: string[] = [];
const consoleErrors: string[] = [];
try {
  const page = session.page;
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 400));
  });
  const rail = page.getByRole("navigation", { name: "Pages", exact: true });
  const marketplace = page.getByRole("region", { name: "Marketplace", exact: true });
  const dialog = page.getByRole("dialog", { name: SKILL, exact: true });
  const toast = (text: string) =>
    page.locator('[data-sonner-toast]:not([data-removed="true"])').filter({ hasText: text });

  /** The id of each agent that has the skill, read again from main. */
  const holders = async (enabledOnly = false) =>
    page.evaluate(
      async ({ name, enabledOnly }) => {
        const agents = await window.openbot.agent.listAgents();
        const ids: string[] = [];
        for (const agent of agents) {
          const skills = await window.openbot.skills.listInstalled(agent.id);
          if (skills.some((skill) => skill.name === name && (!enabledOnly || skill.enabled !== false)))
            ids.push(agent.name);
        }
        return ids.sort();
      },
      { name: SKILL, enabledOnly },
    );
  /** Polls main until the agents with the skill are `expected`. */
  const waitForHolders = async (expected: readonly string[], enabledOnly = false) => {
    const want = [...expected].sort();
    const end = Date.now() + 10_000;
    let actual = await holders(enabledOnly);
    while (JSON.stringify(actual) !== JSON.stringify(want) && Date.now() < end) {
      await page.waitForTimeout(250);
      actual = await holders(enabledOnly);
    }
    assert.deepEqual(actual, want, `Agents with ${SKILL}${enabledOnly ? " on" : ""}`);
  };
  const tab = async (name: string) => {
    await marketplace
      .getByRole("navigation", { name: "Marketplace content types" })
      .getByRole("button", { name, exact: true })
      .click();
  };
  const openSkills = async () => {
    await rail.getByRole("button", { name: "Marketplace", exact: true }).click();
    await marketplace.waitFor();
    await tab("Skills");
    await marketplace.getByRole("tablist", { name: "Source" }).waitFor();
    // The page keeps its source and search while the app runs.
    await marketplace.getByRole("tablist", { name: "Source" }).getByRole("tab", { name: "All", exact: true }).click();
  };
  /** Checks the named agents in the dialog and saves. The dialog closes. */
  const saveDialog = async (check: Record<string, boolean>) => {
    await dialog.waitFor();
    for (const [agent, on] of Object.entries(check)) {
      const box = dialog.getByRole("checkbox", { name: agent, exact: true });
      if ((await box.isChecked()) !== on) await box.click();
      assert.equal(await box.isChecked(), on, `${agent} in the dialog`);
    }
    const save = dialog.getByRole("button").last();
    assert.equal(await save.isEnabled(), true, "Save is off after a change");
    await save.click();
    await dialog.waitFor({ state: "detached" });
  };

  assert.deepEqual(await holders(), [], `Remove ${SKILL} from every agent before the run.`);
  await openSkills();

  // 1. The library: "Your skills" first, then catalog groups with no total.
  const regions = await marketplace
    .getByRole("region")
    .evaluateAll((all) =>
      all.map((region) => region.getAttribute("aria-label") ?? region.querySelector("h4")?.textContent ?? ""),
    );
  assert.ok(regions[0]?.startsWith("Your skills"), `First group: ${regions[0]}`);
  assert.ok(regions.includes("Coding"), "The Coding group has no total in its name");
  steps.push("library shows Your skills, then catalog groups without a total");

  // 2. The source switch: Verified shows only verified skills, Public none of them.
  const source = marketplace.getByRole("tablist", { name: "Source" });
  const catalogCards = marketplace.getByRole("button", { name: /^Add .* to agents$/ });
  await source.getByRole("tab", { name: "Verified", exact: true }).click();
  await source.getByRole("tab", { name: "Verified", exact: true, selected: true }).waitFor();
  await marketplace.getByRole("button", { name: `Add ${SKILL} to agents` }).waitFor();
  const verifiedNames = await catalogCards.evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")));
  assert.ok(verifiedNames.length >= 1, "Verified lists no skill");
  assert.ok(
    verifiedNames.every((name) => /Change Review|Interface Critique|Bug Triage|Account Brief/.test(name ?? "")),
    `Verified lists an unverified skill: ${verifiedNames.join(", ")}`,
  );
  await source.getByRole("tab", { name: "Public", exact: true }).click();
  await marketplace.getByRole("button", { name: `Add ${SKILL} to agents` }).waitFor({ state: "detached" });
  await marketplace.getByRole("button", { name: "Add Project Plan to agents" }).waitFor();
  await source.getByRole("tab", { name: "All", exact: true }).click();
  await marketplace.getByRole("button", { name: `Add ${SKILL} to agents` }).waitFor();
  steps.push(`source switch: Verified shows ${verifiedNames.length} verified skills, Public hides them`);

  // 3. A group page, and its sort menu. "See all" shows when a group has more than 6 skills, so
  // Chief gets 4 more for this step.
  const extra = ["Project Plan", "Meeting Actions", "Launch Notes", "Outreach Draft"];
  for (const name of extra) {
    await marketplace.getByRole("button", { name: `Add ${name} to agents` }).click();
    const extraDialog = page.getByRole("dialog", { name, exact: true });
    await extraDialog.getByRole("checkbox", { name: "Chief", exact: true }).click();
    await extraDialog.getByRole("button").last().click();
    await extraDialog.waitFor({ state: "detached" });
    await marketplace
      .getByRole("button", { name: `Open ${name}` })
      .first()
      .waitFor();
  }
  await marketplace.getByRole("button", { name: "See all: Your skills", exact: true }).click();
  const sort = marketplace.getByRole("button", { name: /^Sort: / });
  await sort.waitFor();
  assert.equal(await sort.getAttribute("aria-label"), "Sort: Most used");
  const shownNames = () =>
    marketplace
      .getByRole("button", { name: /^Open / })
      .evaluateAll((all) => all.map((one) => (one.getAttribute("aria-label") ?? "").slice(5)));
  for (const choice of ["Name", "Recently updated", "Most used"]) {
    await marketplace.getByRole("button", { name: /^Sort: / }).click();
    await page.getByRole("menuitemradio", { name: choice, exact: true }).click();
    // A choice closes the menu, and the page behind it is in the tree again.
    await page.getByRole("menu").waitFor({ state: "detached" });
    await marketplace.getByRole("button", { name: `Sort: ${choice}`, exact: true }).waitFor();
    if (choice === "Name") {
      const names = await shownNames();
      assert.deepEqual(
        names,
        [...names].sort((left, right) => left.localeCompare(right)),
        "Name sort order",
      );
    }
  }
  steps.push(`Your skills page: each sort closes the menu; Name gives ${(await shownNames()).length} skills in order`);
  await page.keyboard.press("Escape");
  await marketplace.getByRole("tablist", { name: "Source" }).waitFor();
  await page.evaluate(async (names) => {
    for (const agent of await window.openbot.agent.listAgents())
      for (const skill of await window.openbot.skills.listInstalled(agent.id))
        if (names.includes(skill.name))
          await window.openbot.skills.uninstall({ agentId: agent.id, skillId: skill.skillId });
  }, extra);
  await marketplace.getByRole("button", { name: "See all: Your skills", exact: true }).waitFor({ state: "detached" });

  // 11. Escape closes the dialog and changes nothing.
  await marketplace.getByRole("button", { name: `Add ${SKILL} to agents` }).click();
  await dialog.waitFor();
  await dialog.getByRole("checkbox", { name: "Chief", exact: true }).click();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(await holders(), []);
  steps.push("Escape closes the dialog with no change");

  // 4. Add to two agents through the dialog.
  await marketplace.getByRole("button", { name: `Add ${SKILL} to agents` }).click();
  await saveDialog({ Chief: true, Research: true });
  await toast(`${SKILL} installed on 2 agents.`).waitFor();
  await waitForHolders(["Chief", "Research"]);
  const yours = marketplace.getByRole("region", { name: /^Your skills/ });
  await yours.getByRole("button", { name: `Open ${SKILL}` }).waitFor();
  steps.push("dialog adds the skill to Chief and Research; it shows in Your skills");

  // 5. Undo of an add removes the skill again.
  await toast(`${SKILL} installed on 2 agents.`).getByRole("button", { name: "Undo" }).click();
  await page.getByText(`The change to ${SKILL} is undone.`).waitFor({ state: "attached" });
  await waitForHolders([]);
  await yours.getByRole("button", { name: `Open ${SKILL}` }).waitFor({ state: "detached" });
  steps.push("Undo takes the add back");

  // 6. Add again, then remove from one agent. The remove waits for the toast, then commits.
  await marketplace.getByRole("button", { name: `Add ${SKILL} to agents` }).click();
  await saveDialog({ Chief: true, Research: true });
  await waitForHolders(["Chief", "Research"]);
  await toast(`${SKILL} installed on 2 agents.`).waitFor({ state: "detached", timeout: TOAST_WAIT });
  await yours.getByRole("button", { name: `${SKILL} is on Chief and Research. Choose agents` }).click();
  await saveDialog({ Research: false });
  await toast(`${SKILL} removed from 1 agent.`).waitFor();
  assert.deepEqual(await holders(), ["Chief", "Research"], "The remove did not wait for the toast");
  await yours.getByRole("button", { name: `${SKILL} is on Chief. Choose agents` }).waitFor();
  await toast(`${SKILL} removed from 1 agent.`).waitFor({ state: "detached", timeout: TOAST_WAIT });
  await waitForHolders(["Chief"]);
  steps.push("remove from Research hides it at once and commits when the toast closes");

  // 9. The switch on the skill page turns the skill off and on for one agent.
  await yours.getByRole("button", { name: `Open ${SKILL}` }).click();
  await marketplace.getByRole("heading", { name: "Agents · 1" }).waitFor();
  const toggle = marketplace.getByRole("switch", { name: `${SKILL} for Chief` });
  assert.equal(await toggle.isChecked(), true);
  // The input is under the drawn switch, so the keyboard turns it.
  await toggle.press("Space");
  await waitForHolders([], true);
  assert.equal(await toggle.isChecked(), false);
  await toggle.press("Space");
  await waitForHolders(["Chief"], true);
  assert.equal(await toggle.isChecked(), true);
  steps.push("switch turns the skill off and on for Chief");

  // 7. Remove all, then Undo: the skill stays.
  await marketplace.getByRole("button", { name: `Remove ${SKILL} from 1 agent`, exact: true }).click();
  await marketplace.getByRole("heading", { name: "Agents · 1" }).waitFor({ state: "detached" });
  await toast(`${SKILL} removed from 1 agent.`).getByRole("button", { name: "Undo" }).click();
  await page.getByText(`The change to ${SKILL} is undone.`).waitFor({ state: "attached" });
  await marketplace.getByRole("heading", { name: "Agents · 1" }).waitFor();
  assert.deepEqual(await holders(), ["Chief"]);
  steps.push("Remove all hides the agent; Undo brings it back with no reinstall");

  // 8. Remove all, then leave the Marketplace while the toast is open: the remove still commits.
  await marketplace.getByRole("button", { name: `Remove ${SKILL} from 1 agent`, exact: true }).click();
  await toast(`${SKILL} removed from 1 agent.`).waitFor();
  await rail.getByRole("button", { name: "Agents", exact: true }).click();
  await marketplace.waitFor({ state: "detached" });
  await toast(`${SKILL} removed from 1 agent.`).waitFor({ state: "detached", timeout: TOAST_WAIT });
  await waitForHolders([]);
  steps.push("a remove commits after the Marketplace closes");

  // 10. A skill made on this computer opens its own page.
  await openSkills();
  const local = marketplace.getByRole("button", { name: "Open smoke-hello", exact: true });
  if ((await local.count()) > 0) {
    await local.click();
    await marketplace.getByRole("heading", { name: "smoke-hello", exact: true }).first().waitFor();
    await marketplace.getByRole("switch", { name: "smoke-hello for Chief" }).waitFor();
    steps.push("local skill page opens with its agents");
  } else {
    steps.push("no local skill on this profile");
  }

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, "skills.png") });
  const report = { passed: true, steps, consoleErrors };
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  mkdirSync(OUT, { recursive: true });
  await session.page.screenshot({ path: resolve(OUT, "failure.png") }).catch(() => undefined);
  const report = { passed: false, steps, consoleErrors, error: String(error) };
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  throw error;
} finally {
  await session.close();
}
