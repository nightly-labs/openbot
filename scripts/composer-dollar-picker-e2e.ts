// Checks the non-channel dollar picker in this checkout's real dev app. Sends no messages.
// Run: bun scripts/composer-dollar-picker-e2e.ts --allow-mutations
import assert from "node:assert/strict";
import { translateFor } from "@openbot/i18n";
import { ChannelClient, connectChannelE2e, writeReport } from "./channel-e2e-support";

const session = await connectChannelE2e("composer-dollar-picker-e2e");
const { page } = session;
const labels = translateFor((await page.evaluate(() => document.documentElement.lang)).startsWith("zh") ? "zh" : "en");
const client = new ChannelClient(page);
const report = {
  typedAmount: false,
  dismissedAmount: false,
  explicitQuery: false,
  explicitDismissedAmount: false,
  reopened: false,
  messageSelectionDismissed: false,
  passed: false,
};
const pageErrors: string[] = [];
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
try {
  const agents = await client.agents();
  const agent = agents[0];
  assert.ok(agent);
  const skills = await page.evaluate((id) => window.openbot.agent.listInstalledSkills(id), agent.id);
  const skill = skills.find((item) => item.enabled !== false && item.state !== "needs-repair");
  assert.ok(skill, "This check needs an agent with an available skill.");
  await page
    .getByRole("navigation", { name: labels("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${agent.name},`) })
    .first()
    .click();
  const editor = page.getByRole("textbox", {
    name: labels("composer.placeholder.message", { name: agent.name }),
    exact: true,
  });
  const picker = page.getByRole("listbox", { name: labels("composer.picker.skillLabel") });
  await editor.waitFor();
  await editor.fill("");
  await editor.pressSequentially("$100");
  assert.equal(await editor.innerText(), "$100");
  await picker.waitFor({ state: "hidden" });
  report.typedAmount = true;

  await editor.fill("");
  await editor.pressSequentially("$");
  await picker.waitFor();
  await page.keyboard.press("Escape");
  await picker.waitFor({ state: "hidden" });
  await page.keyboard.type("100");
  assert.equal(await editor.innerText(), "$100");
  await picker.waitFor({ state: "hidden" });
  report.dismissedAmount = true;

  await editor.fill("");
  await page.getByRole("button", { name: labels("composer.add.label"), exact: true }).click();
  await page.getByRole("menuitem", { name: labels("composer.add.skill"), exact: true }).click();
  await picker.waitFor();
  await page.keyboard.press("Escape");
  await picker.waitFor({ state: "hidden" });
  await page.keyboard.type("100");
  assert.equal(await editor.innerText(), "$100");
  await picker.waitFor({ state: "hidden" });
  report.explicitDismissedAmount = true;
  await editor.fill("");
  await page.getByRole("button", { name: labels("composer.add.label"), exact: true }).click();
  await page.getByRole("menuitem", { name: labels("composer.add.skill"), exact: true }).click();
  await picker.waitFor();
  await page.keyboard.type("zz-no-such-skill-123");
  await page
    .getByText(labels("composer.picker.noSkillMatch", { query: "zz-no-such-skill-123" }), { exact: true })
    .waitFor();
  report.explicitQuery = true;
  await page.keyboard.press("Escape");
  await editor.fill("");
  await editor.pressSequentially(`$${skill.name}`);
  await picker
    .getByRole("option", { name: labels("composer.picker.option.skill", { name: skill.name }), exact: true })
    .click();
  assert.ok((await editor.innerText()).includes(skill.name));
  await picker.waitFor({ state: "hidden" });
  report.reopened = true;
  const paragraph = page
    .getByRole("article")
    .locator("p")
    .filter({ hasNot: page.locator("button, a, [role=button]") })
    .first();
  await paragraph.click();
  await paragraph.selectText();
  await page.keyboard.press("Shift");
  const quote = page.getByRole("button", { name: labels("chat.selection.quote"), exact: true });
  await quote.waitFor();
  await page.keyboard.press("Escape");
  await quote.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.getSelection()?.toString()), "");
  report.messageSelectionDismissed = true;
  assert.deepEqual(pageErrors, [], "The picker must not throw renderer errors.");
  report.passed = true;
} finally {
  const editor = page.getByRole("textbox").filter({ visible: true });
  if ((await editor.count()) === 1) await editor.fill("");
  writeReport("composer-dollar-picker-e2e", report);
  await session.close();
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
