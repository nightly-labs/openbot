import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWebAppInvitePath, parseInviteUrl } from "@openbot/contracts/invite-links";
import type { OpenBotDesktopApi, ServerSummary } from "@openbot/contracts/ipc";
import { en } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import { chromium, type Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/local-server-members-e2e");
const NAME = "E2E members";
const START_DEADLINE_MS = 90_000;
const REGISTER_DEADLINE_MS = 60_000;
const CONNECT_DEADLINE_MS = 120_000;
const LINK_OPTIONS = { allowLocalDevelopmentApiUrl: true };

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; steps: Step[]; unverified: string[] } = {
  passed: false,
  steps: [],
  unverified: [
    "Which path closed the removed member's session: the account service, or the child's sync after the desktop app sent the new list. Both run; the check sees only the result.",
    "An email invitation: the dev account service does not send mail.",
  ],
};

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  try {
    const value = await run();
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function servers(page: Page): Promise<ServerSummary[]> {
  return page.evaluate(() => window.openbot.servers.list());
}

async function until(what: string, timeoutMs: number, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check().catch(() => false))) {
    assert.ok(Date.now() < deadline, `${what} did not happen within ${timeoutMs} ms.`);
    await new Promise((done) => setTimeout(done, 500));
  }
}

async function waitForServer(page: Page, serverId: string, state: ServerSummary["state"]): Promise<void> {
  await until(`The server going ${state}`, START_DEADLINE_MS, async () =>
    (await servers(page)).some((server) => server.id === serverId && server.state === state),
  );
}

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "app" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start one dev app for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "local-server-members-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("local-server-members-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});
const page = session.page;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const memberEmail = `e2e-member-${Date.now()}@example.com`;

const before = await servers(page);
try {
  await step("The dev app is signed in", async () => {
    const state = await page.evaluate(() => window.openbot.auth.getState());
    assert.equal(state.status, "signed_in", "Sign in to the dev app first.");
    return { status: state.status };
  });

  const server = await step("Create a server on this computer", async () => {
    const created = await page.evaluate((name) => window.openbot.localServers.create(name), NAME);
    assert.equal(created.thisComputer, true);
    await waitForServer(page, created.id, "online");
    return created;
  });

  const owner = await step("The account lists the server with its owner", async () => {
    await until("The account listing the server", REGISTER_DEADLINE_MS, async () =>
      (await page.evaluate((id) => window.openbot.servers.listMembers(id), server.id)).some(
        (member) => member.role === "owner" && member.email !== null,
      ),
    );
    const members = await page.evaluate((id) => window.openbot.servers.listMembers(id), server.id);
    const found = members.find((member) => member.role === "owner");
    assert.ok(found, "The member list has no owner.");
    assert.ok(found.email, "The owner has no email: the list did not come from the account.");
    return { count: members.length, ownerId: found.id };
  });

  await step("Create a link invite and a permanent link", async () => {
    const link = await page.evaluate((id) => window.openbot.servers.createInvite({ role: "member" }, id), server.id);
    const permanent = await page.evaluate(
      (id) => window.openbot.servers.createInvite({ role: "member", permanent: true }, id),
      server.id,
    );
    assert.equal(permanent.permanent, true, "The permanent link came back single-use.");
    assert.ok(link.inviteUrl.includes(server.id), "The invite link does not name the server.");
    const invites = await page.evaluate((id) => window.openbot.servers.listInvites(id), server.id);
    const ids = new Set(invites.map((invite) => invite.id));
    assert.ok(ids.has(link.id) && ids.has(permanent.id), "The invite list does not hold both invites.");
    for (const invite of [link, permanent])
      await page.evaluate(([inviteId, id]) => window.openbot.servers.revokeInvite(inviteId, id), [
        invite.id,
        server.id,
      ] as const);
    const after = await page.evaluate((id) => window.openbot.servers.listInvites(id), server.id);
    assert.ok(
      !after.some((invite) => invite.id === link.id || invite.id === permanent.id),
      "A revoked invite is still in the list.",
    );
    return { link: link.id, permanent: permanent.id };
  });

  const web = await browser.newPage();
  await step("A new account joins from the web client over WebRTC", async () => {
    const invite = await page.evaluate((id) => window.openbot.servers.createInvite({ role: "member" }, id), server.id);
    const origin = new URL(parseInviteUrl(invite.inviteUrl, LINK_OPTIONS).apiUrl).origin;
    await web.goto(`${origin}${createWebAppInvitePath(invite.inviteUrl, LINK_OPTIONS)}`);
    await web.getByLabel(en["account.login.email"], { exact: true }).fill(memberEmail);
    await web.getByRole("button", { name: en["account.login.sendCode"], exact: true }).click();
    const [prefix = ""] = en["account.login.developmentCode"].split("{code}");
    const codeLine = web.getByText(new RegExp(`^${prefix}`));
    const code = ((await codeLine.textContent()) ?? "").slice(prefix.length).replace(/[^A-Za-z0-9]/g, "");
    await web.getByLabel(en["account.otp.label"], { exact: true }).fill(code);
    await codeLine.waitFor({ state: "hidden" });
    await web.getByRole("button", { name: en["server.join.connect"], exact: true }).click();
    await until("The member going online on the child", CONNECT_DEADLINE_MS, async () =>
      (await page.evaluate((id) => window.openbot.servers.getPresenceFor(id), server.id)).members.some(
        (member) => member.role !== "owner" && member.online,
      ),
    );
    await web.screenshot({ path: resolve(OUT, "web-connected.png") });
  });

  const member = await step("The child knows the member by email", async () => {
    await until("The member's email on the child", CONNECT_DEADLINE_MS, async () =>
      (await page.evaluate((id) => window.openbot.servers.getPresenceFor(id), server.id)).members.some(
        (item) => item.role !== "owner" && item.username === memberEmail,
      ),
    );
    const listed = await page.evaluate((id) => window.openbot.servers.listMembers(id), server.id);
    const found = listed.find((item) => item.email === memberEmail);
    assert.ok(found, "The account does not list the member.");
    return { id: found.id, role: found.role, accountMembers: listed.length };
  });

  await step("Removing the member ends its access", async () => {
    await page.evaluate(([memberId, id]) => window.openbot.servers.removeMember(memberId, id), [
      member.id,
      server.id,
    ] as const);
    await until(
      "The member going offline on the child",
      CONNECT_DEADLINE_MS,
      async () =>
        !(await page.evaluate((id) => window.openbot.servers.getPresenceFor(id), server.id)).members.some(
          (item) => item.id === member.id && item.online,
        ),
    );
    await web.getByText(en["webClient.error.accessEnded"], { exact: true }).waitFor({ timeout: CONNECT_DEADLINE_MS });
    await web.screenshot({ path: resolve(OUT, "web-access-ended.png") });
  });

  await step("Restart the server: the desktop app logs in as its owner again", async () => {
    await page.evaluate((id) => window.openbot.localServers.restart(id), server.id);
    await waitForServer(page, server.id, "online");
    const presence = await page.evaluate((id) => window.openbot.servers.getPresenceFor(id), server.id);
    assert.ok(
      presence.members.some((member) => member.id === owner.ownerId),
      "The child does not show the owner after the restart.",
    );
    return { members: presence.members.length };
  });

  await step("Delete the server", async () => {
    await page.evaluate((id) => window.openbot.localServers.delete(id), server.id);
    assert.ok(!(await servers(page)).some((item) => item.id === server.id), "The server is still listed.");
  });

  report.passed = true;
} finally {
  const known = new Set(before.map((server) => server.id));
  const left = (await servers(page).catch(() => [])).filter((server) => server.thisComputer && !known.has(server.id));
  for (const server of left)
    await page.evaluate((id) => window.openbot.localServers.delete(id), server.id).catch(() => undefined);
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  await session.close();
}
logger.info(`Checked the members and invitations of a server on this computer. Wrote ${resolve(OUT, "report.json")}.`);
