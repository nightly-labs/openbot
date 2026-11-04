// Run: bun scripts/channel-skill-validation-e2e.ts [--before-fix]
// Uses real SQLite stores, AgentService, skill lookup and authenticated Team API on loopback.
// Provider turns are held busy. No renderer, account service or provider credentials are needed.
// Reports: .openbot-build/channel-skill-validation-e2e/report[-before].json.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import type { AgentSummary, ChannelCommand } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V8,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { CentralAuthManager } from "../src/main/central-auth-manager";
import { SkillMarketplaceService } from "../src/main/skill-marketplace-service";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";
import type { TeamApiServer as TeamApiServerType } from "../src/main/team-api-server";
import { TeamStore } from "../src/main/team-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/channel-skill-validation-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-channel-skill-validation-"));
// Only Electron is replaced: the HTTP server, routing, stores and domain services are real.
plugin({
  name: "channel-skill-electron-boundary",
  setup(build) {
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => root, getVersion: () => "0.0.0-e2e", isPackaged: false, on: () => {} },
        ipcMain: { handle: () => {}, removeHandler: () => {}, on: () => {} },
        BrowserWindow: class {},
        MessageChannelMain: class {},
        Notification: class {},
        clipboard: {},
        desktopCapturer: {},
        dialog: {},
        nativeImage: {},
        net: {},
        powerMonitor: {},
        safeStorage: {},
        screen: {},
        session: {},
        shell: {},
        systemPreferences: {},
        webContents: {},
      },
    }));
  },
});
const { TeamApiServer } = await import("../src/main/team-api-server");
const unused = () => Effect.die(new Error("Unexpected provider or browser call."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};
const teamBrowser: TeamApiBrowser = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  open: unused,
  activate: unused,
  navigate: unused,
  reload: unused,
  stop: unused,
  takeUserControl: unused,
  releaseUserControl: () => {},
  releaseUserControlHeldBy: () => {},
  close: unused,
  capturePreview: unused,
  setVisible: unused,
  getDisplayState: () => ({ tabs: [], activeTabId: null }),
  loadUrl: unused,
  isPrivate: () => false,
  startView: unused,
  dispatchViewInput: unused,
  copyViewSelection: unused,
  importSignIn: unused,
};
const userData = join(root, "state");
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, join(root, "home"), database);
const mailbox = new MailboxStore(userData, store.sharedRoot, database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar.json"));
const team = new TeamStore(join(userData, "team.json"));
const auth = new CentralAuthManager({
  apiUrl: "https://example.invalid",
  storagePath: join(root, "auth.json"),
  canPersist: () => false,
  encrypt: (value) => Buffer.from(value),
  decrypt: (value) => value.toString("utf8"),
  fetch: async () => {
    throw new Error("Skill validation must not contact the account service.");
  },
});
const skills = new SkillMarketplaceService(auth, () => store.list());
let lookups = 0;
const options = {
  store,
  mailbox,
  browser,
  sidebarLayout: sidebar,
  channelSkills: (agentId: string) => {
    lookups += 1;
    return skills.listInstalledForChatTags(agentId);
  },
};
const agents = new AgentService(options);
const channels = agents.channels;
channels.hooks.busy = () => true;
channels.hooks.usageLimited = () => true;
const actor = { id: "channel-skill-e2e", name: "Synthetic sender" };
let server: TeamApiServerType | undefined;
let port = 0;
let token = "";
const report: { passed: boolean; checks: { name: string; passed: boolean; error?: string }[]; error?: string } = {
  passed: false,
  checks: [],
};
async function check(name: string, action: () => Promise<void>) {
  try {
    await action();
    report.checks.push({ name, passed: true });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.checks.push({ name, passed: false, error: message });
    process.stdout.write(`FAIL ${name}: ${message}\n`);
  }
}
async function wire(path: string, body: ChannelCommand | { username: string; password: string }) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V8),
      [TEAM_APP_VERSION_HEADER]: "0.0.0-e2e",
      [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V8).join(","),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
const markAgent = (agent: AgentSummary) => serializeChatTagReference("agent", agent.name, agent.id);
const markSkill = (id = "channel-e2e-ready") => serializeChatTagReference("skill", id, id);
const skillBytes = Buffer.from("---\nname: channel-e2e-ready\ndescription: Synthetic skill.\n---\nReply ready.\n");
async function seedSkills(agent: AgentSummary, enabled = true) {
  const entry = (slug: string) => ({
    skillId: slug,
    slug,
    name: slug,
    version: 1,
    bundleSha256: "synthetic",
    receiptId: "synthetic",
    enabled,
    files: { "SKILL.md": createHash("sha256").update(skillBytes).digest("hex") },
  });
  await mkdir(join(agent.workspacePath, ".openbot"), { recursive: true });
  await writeFile(
    join(agent.workspacePath, ".openbot/skills-lock.json"),
    JSON.stringify({
      version: 1,
      skills: {
        "channel-e2e-ready": entry("channel-e2e-ready"),
        "channel-e2e-broken": entry("channel-e2e-broken"),
      },
    }),
  );
  for (const directory of [".agents/skills", ".claude/skills"]) {
    const folder = join(agent.workspacePath, directory, "channel-e2e-ready");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "SKILL.md"), skillBytes);
  }
}
try {
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(team.initialize());
  const createAgent = (name: string) =>
    runCauseEffect(
      store.createAgent({
        name,
        description: "Synthetic channel validation agent",
        avatarSeed: randomUUID(),
        avatarHue: null,
      }),
    );
  const first = await createAgent("First");
  const second = await createAgent("Second");
  const outside = await createAgent("Outside");
  await seedSkills(first);
  const listed = await runCauseEffect(skills.listInstalledForChatTags(first.id));
  assert.equal(listed.find((skill) => skill.skillId === "channel-e2e-ready")?.state, "installed");
  assert.equal(listed.find((skill) => skill.skillId === "channel-e2e-broken")?.state, "needs-repair");
  const channelId = randomUUID();
  await runCauseEffect(
    channels.command(
      {
        type: "save",
        operationId: randomUUID(),
        channelId,
        draft: {
          name: "Skill validation",
          title: "",
          instructions: "",
          leadAgentId: first.id,
          members: [first, second].map((agent) => ({ agentId: agent.id, instructions: "" })),
        },
      },
      actor,
    ),
  );
  const command = (
    text: string,
    recipientAgentId: string | null = null,
  ): Extract<ChannelCommand, { type: "send" }> => ({
    type: "send",
    operationId: randomUUID(),
    channelId,
    text,
    recipientAgentId,
    replyToMessageId: null,
    attachmentDraftIds: [],
  });
  const snapshot = () => ({
    channel: channels.store.get(channelId),
    messages: channels.store.messages(channelId),
    tasks: channels.store.tasks(channelId),
    assignments: channels.store.assignments(channelId),
  });
  const addressError = "Address this skill message to one agent in the channel.";
  const skillError = "The selected skill is no longer available to that agent.";
  const invalid = [
    { name: "no address", text: markSkill() },
    { name: "field without address", text: markSkill(), recipient: first.id },
    { name: "everyone", text: `@everyone ${markSkill()}` },
    { name: "multiple mentions", text: `${markAgent(first)} ${markAgent(second)} ${markSkill()}` },
    { name: "duplicate mentions", text: `${markAgent(first)} ${markAgent(first)} ${markSkill()}` },
    { name: "everyone with member", text: `${markAgent(first)} @everyone ${markSkill()}`, recipient: first.id },
    { name: "nonmember", text: `${markAgent(outside)} ${markSkill()}` },
    { name: "deleted member", text: `${serializeChatTagReference("agent", "Deleted", randomUUID())} ${markSkill()}` },
    { name: "field mismatch", text: `${markAgent(first)} ${markSkill()}`, recipient: second.id },
    { name: "missing skill", text: `${markAgent(first)} ${markSkill("channel-e2e-missing")}`, error: skillError },
    { name: "broken skill", text: `${markAgent(first)} ${markSkill("channel-e2e-broken")}`, error: skillError },
    {
      name: "one invalid of two skills",
      text: `${markAgent(first)} ${markSkill()} ${markSkill("channel-e2e-missing")}`,
      error: skillError,
    },
  ];
  async function rejected(input: Extract<ChannelCommand, { type: "send" }>, expected: string, remote: boolean) {
    const before = snapshot();
    if (remote) {
      const result = await wire(CHANNEL_ROUTES.command, input);
      assert.equal(result.status, 400, "Team API accepted an invalid skill request or returned a server error.");
      assert.deepEqual(result.body, { error: expected });
    } else {
      await assert.rejects(runCauseEffect(channels.command(input, actor)), { message: expected });
      assert.equal(channels.committed(actor.id, input.operationId), false);
    }
    assert.deepEqual(snapshot(), before, "Rejected send changed channel state.");
  }
  for (const input of invalid)
    await check(`service: ${input.name}`, () =>
      rejected(command(input.text, input.recipient ?? null), input.error ?? addressError, false),
    );
  const owner = { username: "skill-e2e", password: randomUUID() };
  await runCauseEffect(team.configure("Skill E2E", owner.username, owner.password));
  server = new TeamApiServer({
    store: team,
    agents,
    mailbox,
    browser: teamBrowser,
    sidebarLayout: sidebar,
    appVersion: "0.0.0-e2e",
    channels,
  });
  port = await Effect.runPromise(server.start());
  const login = await wire("/v1/auth/login", owner);
  assert.equal(login.status, 200);
  assert.ok(isDynamicRecord(login.body) && typeof login.body.sessionToken === "string");
  token = login.body.sessionToken;
  for (const input of invalid)
    await check(`Team API: ${input.name}`, () =>
      rejected(command(input.text, input.recipient ?? null), input.error ?? addressError, true),
    );
  for (const remote of [false, true]) {
    const label = remote ? "Team API" : "service";
    store.setHidden(first.id, new Date().toISOString());
    await check(`${label}: hidden member`, () =>
      rejected(command(`${markAgent(first)} ${markSkill()}`), addressError, remote),
    );
    store.setHidden(first.id, null);
    await seedSkills(first, false);
    await check(`${label}: disabled skill`, () =>
      rejected(command(`${markAgent(first)} ${markSkill()}`), skillError, remote),
    );
    await seedSkills(first);
    await check(`${label}: valid and receipt retry after removal`, async () => {
      const input = command(`${markAgent(first)} ${markSkill()} Reply ready.`, first.id);
      const before = channels.store.tasks(channelId).length;
      if (remote) assert.equal((await wire(CHANNEL_ROUTES.command, input)).status, 200);
      else await runCauseEffect(channels.command(input, actor));
      const after = snapshot();
      assert.equal(after.tasks.length, before + 1);
      assert.equal(after.tasks.at(-1)?.ownerAgentId, first.id);
      await runCauseEffect(skills.uninstall({ agentId: first.id, skillId: "channel-e2e-ready" }));
      const readsBefore = lookups;
      if (remote) assert.equal((await wire(CHANNEL_ROUTES.command, input)).status, 200);
      else await runCauseEffect(channels.command(input, actor));
      assert.deepEqual(snapshot(), after);
      assert.equal(lookups, readsBefore, "A committed receipt must not revalidate skills.");
      await rejected({ ...input, operationId: randomUUID() }, skillError, remote);
      await seedSkills(first);
    });
    await check(`${label}: ordinary multiple recipients`, async () => {
      const before = channels.store.tasks(channelId).length;
      const readsBefore = lookups;
      const input = command(`${markAgent(first)} ${markAgent(second)} Reply normally.`, first.id);
      if (remote) assert.equal((await wire(CHANNEL_ROUTES.command, input)).status, 200);
      else await runCauseEffect(channels.command(input, actor));
      assert.deepEqual(
        channels.store
          .tasks(channelId)
          .slice(before)
          .map((task) => task.ownerAgentId)
          .sort(),
        [first.id, second.id].sort(),
      );
      assert.equal(lookups, readsBefore, "A send without a skill must not query skills.");
    });
  }
  await check("service: a missing skill source fails closed", async () => {
    const closed = new AgentService({ store, mailbox, browser, sidebarLayout: sidebar });
    try {
      const before = snapshot();
      await assert.rejects(
        runCauseEffect(closed.channels.command(command(`${markAgent(first)} ${markSkill()}`), actor)),
        { message: skillError },
      );
      assert.deepEqual(snapshot(), before);
    } finally {
      await runCauseEffect(closed.stop());
    }
  });
  for (const remote of [false, true])
    await check(`${remote ? "Team API" : "service"}: rejected attachment stays retryable`, async () => {
      const file = join(root, "synthetic.txt");
      await writeFile(file, "Synthetic channel attachment.");
      const [draft] = await runCauseEffect(mailbox.prepareImportedAttachments([file], []));
      assert.ok(draft);
      const input = { ...command(`${markAgent(first)} ${markSkill("missing")}`), attachmentDraftIds: [draft.id] };
      await rejected(input, skillError, remote);
      const corrected = { ...input, text: `${markAgent(first)} ${markSkill()} Read the attachment.` };
      if (remote) assert.equal((await wire(CHANNEL_ROUTES.command, corrected)).status, 200);
      else await runCauseEffect(channels.command(corrected, actor));
      const saved = channels.store.messages(channelId).find((message) => message.message.text === corrected.text);
      assert.equal(saved?.message.attachments?.length, 1, "The refusal consumed the attachment draft.");
    });
  report.passed = report.checks.every((item) => item.passed);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  if (server) await Effect.runPromise(server.stop());
  await runCauseEffect(agents.stop());
  await runCauseEffect(auth.dispose());
  database.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const file = process.argv.includes("--before-fix") ? "report-before.json" : "report.json";
  await writeFile(join(OUT, file), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.passed ? 0 : 1;
