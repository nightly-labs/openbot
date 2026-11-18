// Drives this worktree's real dev app and preload. Run after `bun run dev` with
// `bun scripts/channel-skill-picker-e2e.ts --allow-mutations`. Creates and removes one channel.
import assert from "node:assert/strict";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import { translateFor } from "@openbot/i18n";
import { ChannelClient, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const report: {
  channelId?: string;
  skillId?: string;
  sent?: boolean;
  invalidRecipient?: boolean;
  unavailableSkill?: boolean;
  passed: boolean;
  error?: string;
} = {
  passed: false,
};
const session = await connectChannelE2e("channel-skill-picker-e2e");
const { page } = session;
const labels = translateFor((await page.evaluate(() => document.documentElement.lang)).startsWith("zh") ? "zh" : "en");
const client = new ChannelClient(page);
const name = `E2E channel skill ${crypto.randomUUID().slice(0, 4)}`;
const composer = () => page.getByRole("textbox", { name: labels("channel.composer.label") });
const send = () => page.getByRole("button", { name: labels("composer.send.message"), exact: true }).click();

try {
  const agents = await client.agents();
  assert.ok(agents.length >= 2, "This check needs two visible agents.");
  const installed = await Promise.all(
    agents.map((agent) => page.evaluate((id) => window.openbot.agent.listInstalledSkills(id), agent.id)),
  );
  const index = installed.findIndex((skills) =>
    skills.some((skill) => skill.enabled !== false && skill.state !== "needs-repair"),
  );
  assert.ok(index >= 0, "This check needs an agent with an available skill.");
  const agent = agents[index];
  const other = agents.find((candidate) => candidate.id !== agent?.id);
  const skill = installed[index]?.find(
    (candidate) => candidate.enabled !== false && candidate.state !== "needs-repair",
  );
  assert.ok(agent && other && skill);
  report.skillId = skill.skillId;

  const channel = await client.create(name, [agent.id, other.id], agent.id);
  report.channelId = channel.id;
  await page
    .getByRole("navigation", { name: labels("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${name}[,.]`) })
    .first()
    .click();
  await composer().waitFor();

  // The first `$` in a multi-member channel chooses an agent; the next list chooses that agent's skill.
  await composer().pressSequentially("$");
  await page
    .getByRole("listbox", { name: labels("composer.picker.channelAgentLabel") })
    .getByRole("option", { name: labels("composer.picker.option.agent", { name: agent.name }), exact: true })
    .click();
  await page
    .getByRole("listbox", { name: labels("composer.picker.skillLabel") })
    .getByRole("option", { name: labels("composer.picker.option.skill", { name: skill.name }), exact: true })
    .click();
  await page.keyboard.insertText(" Reply with ready.");
  await send();
  const sent = await waitFor(
    page,
    "the skill message is stored",
    () => client.read(channel.id),
    (current) =>
      current.messages.some(
        (message) => message.author.kind === "member" && message.message.text.includes(`(skill:${skill.skillId})`),
      ),
    15_000,
  );
  assert.ok(
    sent.messages.some(
      (message) =>
        message.author.kind === "member" &&
        message.message.text.startsWith(serializeChatTagReference("agent", agent.name, agent.id)),
    ),
  );
  report.sent = true;
  const count = sent.messages.filter((message) => message.author.kind === "member").length;

  // A skill marker without a valid channel recipient stays in the draft and never reaches the host.
  await composer().fill(
    `${serializeChatTagReference("agent", "Outside", crypto.randomUUID())} ${serializeChatTagReference("skill", skill.name, skill.skillId)} invalid recipient`,
  );
  await send();
  await page.getByText(labels("channel.error.skillAddress"), { exact: true }).waitFor();
  assert.equal(
    (await client.read(channel.id)).messages.filter((message) => message.author.kind === "member").length,
    count,
  );
  report.invalidRecipient = true;

  // Failed sends remain retryable and serialize later sends in the same channel.
  const unavailableName = `${name} unavailable`;
  const unavailableChannel = await client.create(unavailableName, [agent.id, other.id], agent.id);
  await page
    .getByRole("navigation", { name: labels("sidebar.nav.label") })
    .getByRole("button", { name: new RegExp(`^${unavailableName}[,.]`) })
    .first()
    .click();
  await composer().waitFor();
  await composer().fill("");
  await composer().pressSequentially(`@${agent.name.slice(0, 3)}`);
  await page
    .getByRole("listbox", { name: labels("composer.picker.mentionLabel") })
    .getByRole("option", { name: labels("composer.picker.option.agent", { name: agent.name }), exact: true })
    .click();
  await page.keyboard.insertText(
    ` ${serializeChatTagReference("skill", "Missing", crypto.randomUUID())} unavailable skill`,
  );
  await send();
  await page.getByText(labels("channel.error.skillUnavailable"), { exact: true }).waitFor();
  assert.equal(
    (await client.read(unavailableChannel.id)).messages.filter((message) => message.author.kind === "member").length,
    0,
  );
  report.unavailableSkill = true;
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  throw error;
} finally {
  await client.cleanup();
  writeReport("channel-skill-picker-e2e", report);
  await session.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
