// Checks message acknowledgement on an additional local server in this worktree's dev app.
// Start `bun run dev` with an isolated profile, then run this script with --allow-mutations.
// Writes a report and screenshots under .openbot-build/local-server-sender-identity-e2e.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ChannelClient, connectChannelE2e, waitFor, writeReport } from "./channel-e2e-support";

const OUT = resolve(import.meta.dirname, "../.openbot-build/local-server-sender-identity-e2e");
const name = `Identity E2E ${crypto.randomUUID().slice(0, 8)}`;
const text = `Owner message ${crypto.randomUUID()}`;
const session = await connectChannelE2e("local-server-sender-identity-e2e");
const { page } = session;
const client = new ChannelClient(page);
const report: {
  passed: boolean;
  serverId?: string;
  channelId?: string;
  ownerId?: string;
  stored?: number;
  rendered?: number;
  cleanup?: boolean;
  error?: string;
} = { passed: false };
mkdirSync(OUT, { recursive: true });
let serverId: string | undefined;
try {
  assert.ok(
    session.instance.instanceId?.startsWith("wt-"),
    "Use a worktree-specific dev profile, not the shared profile.",
  );
  const server = await page.evaluate((serverName) => window.openbot.localServers.create(serverName), name);
  serverId = server.id;
  report.serverId = server.id;
  assert.equal(server.thisComputer, true);
  await waitFor(
    page,
    "additional local server is online",
    () => page.evaluate(() => window.openbot.servers.list()),
    (servers) => servers.some((entry) => entry.id === server.id && entry.state === "online"),
    90_000,
  );
  await page.evaluate((id) => window.openbot.servers.select(id), server.id);
  await waitFor(
    page,
    "additional local server is selected",
    () => page.evaluate(() => window.openbot.servers.list()),
    (servers) => servers.some((entry) => entry.id === server.id && entry.active && entry.role === "owner"),
    30_000,
  );
  const presence = await waitFor(
    page,
    "password owner",
    () => page.evaluate((id) => window.openbot.servers.getPresenceFor(id), server.id),
    (value) =>
      value.members.some((member) => member.username === "owner" && member.role === "owner" && !member.disabled),
    30_000,
  );
  const owner = presence.members.find(
    (member) => member.username === "owner" && member.role === "owner" && !member.disabled,
  );
  assert.ok(owner);
  report.ownerId = owner.id;
  await page.getByRole("button", { name: /^(Continue|계속)$/ }).click();
  await page.getByRole("button", { name: /^(Create agent|에이전트 만들기)$/ }).click();
  const agents = await waitFor(
    page,
    "test agent created",
    () => client.agents(),
    (items) => items.length === 1,
    30_000,
  );
  const agent = agents[0];
  assert.ok(agent);
  const channel = await client.create(name, [agent.id], agent.id);
  report.channelId = channel.id;
  await page.getByRole("button", { name: new RegExp(`^${name}\\.`) }).click();
  const composer = page.getByRole("textbox", { name: /Message to channel|채널에 메시지 보내기/ });
  await composer.fill(text);
  await page.getByRole("button", { name: /^(Send message|메시지 보내기)$/ }).click();
  const stored = await waitFor(
    page,
    "owner message stored",
    () => client.read(channel.id),
    (value) => value.messages.some((message) => message.message.text === text),
    30_000,
  );
  report.stored = stored.messages.filter((message) => message.message.text === text).length;
  assert.equal(report.stored, 1);
  const author = stored.messages.find((message) => message.message.text === text)?.author;
  assert.equal(author?.kind, "member");
  assert.equal(author?.id, owner.id);
  const rows = page.getByRole("article").filter({ hasText: text });
  await rows.first().getByRole("toolbar").waitFor({ timeout: 30_000 });
  report.rendered = await rows.count();
  assert.equal(report.rendered, 1, "The message must not have a duplicate failed row.");
  assert.match((await rows.first().getAttribute("aria-label")) ?? "", /my message|나의 메시지/i);
  await page.screenshot({ path: resolve(OUT, "success.png") });
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  await page.screenshot({ path: resolve(OUT, "failure.png") }).catch(() => undefined);
  throw error;
} finally {
  try {
    await client.cleanup();
    if (serverId) {
      await page.evaluate((id) => window.openbot.localServers.delete(id), serverId);
      report.cleanup = !(await page.evaluate(() => window.openbot.servers.list())).some(
        (entry) => entry.id === serverId,
      );
      assert.ok(report.cleanup, "The test server remains in the server list.");
    }
  } catch (error) {
    report.passed = false;
    report.cleanup = false;
    report.error = `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
    process.exitCode = 1;
  } finally {
    writeReport("local-server-sender-identity-e2e", report);
    await session.close();
  }
}
