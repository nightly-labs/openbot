import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CrmChange } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import { CRM_CAPABILITY, CRM_CODECS, CRM_ROUTES, crmEvent } from "@openbot/contracts/team-protocol/crm-v1";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import { TEAM_PROTOCOL_V8 } from "@openbot/contracts/team-protocol/v8";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { VAULT_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v1";
import { sourceText } from "@openbot/i18n/source";
import {
  decodeRemoteCrmActivityPage,
  decodeRemoteCrmApplyResult,
  decodeRemoteCrmCustomerPage,
  decodeRemoteCrmOverview,
  decodeRemoteCrmPaymentPage,
  decodeRemoteCrmSettings,
} from "@openbot/team-client/crm-decoding";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { type CrmHandle, createCrm } from "../src/backend/crm/crm";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/crm-team-api-e2e");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };
const STEP_DEADLINE_MS = 30_000;

plugin({
  name: "crm-team-api-electron-boundary",
  setup(build) {
    class Inert {}
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => HOST_VERSION, isPackaged: false, on: () => undefined },
        BrowserWindow: Object.assign(class extends Inert {}, { getAllWindows: () => [] }),
        MessageChannelMain: class extends Inert {},
        Notification: Object.assign(class extends Inert {}, { isSupported: () => false }),
        clipboard: {},
        dialog: {},
        ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
        nativeImage: {},
        net: {},
        powerMonitor: { on: () => undefined },
        safeStorage: { isEncryptionAvailable: () => false },
        screen: {},
        session: {},
        shell: { openExternal: async () => undefined },
        systemPreferences: {},
        webContents: { getAllWebContents: () => [] },
      },
    }));
  },
});

const { TeamApiServer } = await import("../src/main/team-api-server");
const { AGENT_ACCESS_FILE, AgentAccessStore } = await import("../src/main/agent-access-store");
const { TeamStore } = await import("../src/main/team-store");
const { createCrmPreferenceStore, crmSettingsStore } = await import("../src/main/crm-preference-store");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "WebRTC: the clients use HTTP and the event socket; the frame budget is not reached by these pages.",
    "Agent proposals: no agent turn runs; the step calls the host's agent operation directly.",
  ],
  steps: [],
};

async function step<T>(
  name: string,
  run: () => Promise<T>,
  summarize: (value: T) => unknown = (value) => value,
): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: summarize(value) });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): JsonObject {
  assert.ok(isRecord(value), `${label} is not an object.`);
  return value;
}

function text(value: unknown, label: string): string {
  assert.equal(typeof value, "string", `${label} is not text.`);
  return String(value);
}

function list(value: unknown, label: string): unknown[] {
  assert.ok(Array.isArray(value), `${label} is not a list.`);
  return value;
}

const unused = () => Effect.die(new Error("Not used by this check."));
const agentBrowser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
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
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
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
  startTeach: unused,
  stopTeach: () => [],
  releaseUserControl: () => {},
  releaseUserControlHeldBy: () => {},
  releaseUserControlRefused: () => {},
  close: unused,
  capturePreview: unused,
  setVisible: unused,
  getDisplayState: () => ({ tabs: [], activeTabId: null }),
  loadUrl: unused,
  isPrivate: () => false,
  startView: unused,
  dispatchViewInput: unused,
  copyViewSelection: unused,
  answerViewDialog: unused,
  importSignIn: unused,
};

const root = await mkdtemp(join(tmpdir(), "openbot-crm-team-api-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const crmPreferencePath = join(userData, "openbot-crm-v1.json");

interface Host {
  database: OpenBotDatabase;
  agents: AgentService;
  crm: CrmHandle;
  server: InstanceType<typeof TeamApiServer>;
  team: InstanceType<typeof TeamStore>;
  port: number;
}

let host: Host | null = null;
const sockets: WebSocket[] = [];

async function startHost(): Promise<Host> {
  const database = new OpenBotDatabase(userData);
  const agentStore = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
  const access = new AgentAccessStore(join(userData, AGENT_ACCESS_FILE));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  assert.equal(await runCauseEffect(access.load()), true, "The roles file did not load.");
  if (!team.getIdentity()) await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
  const agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
  const preference = createCrmPreferenceStore(crmPreferencePath);
  await Effect.runPromise(preference.load());
  const crm = await Effect.runPromise(
    createCrm({ database, settings: crmSettingsStore(preference), changed: () => agents.notifyCrmChanged() }),
  );
  const server = new TeamApiServer({
    store: team,
    agents,
    mailbox,
    browser: teamBrowser,
    sidebarLayout: sidebar,
    appVersion: HOST_VERSION,
    hiddenAgents: agents,
    agentAccess: access,
    crm,
  });
  const port = await Effect.runPromise(server.start());
  return { database, agents, crm, server, team, port };
}

async function stopHost(): Promise<void> {
  if (!host) return;
  const stopping = host;
  host = null;
  await Effect.runPromise(stopping.server.stop()).catch(() => undefined);
  await Effect.runPromise(stopping.crm.close()).catch(() => undefined);
  await runCauseEffect(stopping.agents.stop()).catch(() => undefined);
  stopping.database.close();
}

function current(): Host {
  assert.ok(host, "The host is not running.");
  return host;
}

async function call(
  method: string,
  path: string,
  input: { token?: string; body?: unknown; capabilities?: readonly string[]; protocol?: number } = {},
): Promise<{ status: number; body: unknown }> {
  const protocol = input.protocol ?? TEAM_PROTOCOL_V9;
  const headers: Record<string, string> = {
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(protocol),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
    [TEAM_CAPABILITIES_HEADER]: (input.capabilities ?? teamCapabilitiesForProtocol(protocol)).join(","),
  };
  if (input.body !== undefined) headers["Content-Type"] = "application/json";
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  const response = await fetch(`http://127.0.0.1:${current().port}${path}`, {
    method,
    headers,
    body: input.body === undefined ? null : JSON.stringify(input.body),
  });
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

async function wire(
  path: string,
  token: string,
  body: unknown,
  capabilities?: readonly string[],
): Promise<{ status: number; body: unknown }> {
  const codec = CRM_CODECS.get(path);
  assert.ok(codec, `No crm-v1 codec for ${path}.`);
  codec.request(body);
  const response = await call("POST", path, { token, body, ...(capabilities ? { capabilities } : {}) });
  return { status: response.status, body: codec.response(response.status, response.body) };
}

async function ok<T>(path: string, token: string, body: unknown, decode: (value: unknown) => T): Promise<T> {
  const response = await wire(path, token, body);
  assert.equal(response.status, 200, `${path} returned ${response.status}: ${JSON.stringify(response.body)}`);
  return decode(response.body);
}

const apply = (token: string, change: CrmChange) => ok(CRM_ROUTES.apply, token, change, decodeRemoteCrmApplyResult);

async function applied(token: string, change: CrmChange): Promise<string | null> {
  const result = await apply(token, change);
  assert.ok(result.ok, `${change.kind} conflicted.`);
  return result.id;
}

async function customer(token: string, id: string) {
  const page = await ok(CRM_ROUTES.customers, token, {}, decodeRemoteCrmCustomerPage);
  const found = page.customers.find((entry) => entry.id === id);
  assert.ok(found, `Customer ${id} is not on the first page.`);
  return found;
}

async function login(credentials: { username: string; password: string }): Promise<string> {
  const response = await call("POST", TEAM_API_ROUTES.auth.login, { body: credentials });
  assert.equal(response.status, 200, `Sign-in returned ${response.status}.`);
  return text(record(response.body, "login").sessionToken, "session token");
}

function typeOf(value: unknown): string[] {
  return isRecord(value) && typeof value.type === "string" ? [value.type] : [];
}

async function openEvents(token: string): Promise<{ socket: WebSocket; types: string[] }> {
  const socket = new WebSocket(`ws://127.0.0.1:${current().port}${TEAM_API_ROUTES.events}`, [
    TEAM_PROTOCOL_V1_WEBSOCKET,
    `openbot-token.${token}`,
  ]);
  sockets.push(socket);
  const types: string[] = [];
  socket.addEventListener("message", (event) => {
    types.push(...typeOf(JSON.parse(String(event.data))));
  });
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener("open", () => resolveOpen(), { once: true });
    socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
  });
  const snapshot = nextMessage(socket, (value) =>
    isRecord(value) && value.type === "runtime-snapshot" ? value : null,
  );
  socket.send(
    JSON.stringify({
      type: "agent-event-scope",
      includeConversations: false,
      capabilities: ["agent-runtime-snapshots", CRM_CAPABILITY, VAULT_CAPABILITY],
    }),
  );
  await snapshot;
  return { socket, types };
}

function nextMessage<T>(socket: WebSocket, pick: (value: unknown) => T | null): Promise<T> {
  return new Promise((resolveMessage, reject) => {
    const onMessage = (event: MessageEvent) => {
      const picked = pick(JSON.parse(String(event.data)));
      if (picked === null) return;
      socket.removeEventListener("message", onMessage);
      resolveMessage(picked);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", (event) => reject(new Error(`The event socket closed: ${event.code}.`)), {
      once: true,
    });
  });
}

try {
  host = await startHost();
  const ownerToken = await login(OWNER);

  const memberToken = await step(
    "setup: an owner and a member",
    async () => {
      const invite = await runCauseEffect(current().team.createInvite("member"));
      const joined = await call("POST", TEAM_API_ROUTES.join.server, {
        body: { inviteToken: invite.token, ...MEMBER },
      });
      assert.equal(joined.status, 201, `Join returned ${joined.status}.`);
      return login(MEMBER);
    },
    () => ({ member: MEMBER.username }),
  );

  await step("capability: protocol 9 sees crm-v1 and protocol 8 does not", async () => {
    const capabilities = async (protocol: number) =>
      list(
        record((await call("GET", TEAM_API_ROUTES.compatibility, { protocol })).body, "compatibility").capabilities,
        "capabilities",
      );
    assert.ok((await capabilities(TEAM_PROTOCOL_V9)).includes(CRM_CAPABILITY));
    assert.ok(!(await capabilities(TEAM_PROTOCOL_V8)).includes(CRM_CAPABILITY));
    return { v9: true, v8: false };
  });

  await step("refusals: a member gets 403, a client without crm-v1 gets 400, a GET gets 404", async () => {
    const member = await wire(CRM_ROUTES.overview, memberToken, {});
    assert.equal(member.status, 403, JSON.stringify(member.body));
    assert.ok(JSON.stringify(member.body).includes(sourceText("error.team.adminRequired")));
    const old = await wire(
      CRM_ROUTES.overview,
      ownerToken,
      {},
      teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).filter((capability) => capability !== CRM_CAPABILITY),
    );
    assert.equal(old.status, 400, JSON.stringify(old.body));
    assert.ok(JSON.stringify(old.body).includes(sourceText("error.crm.serverTooOld")));
    const read = await call("GET", CRM_ROUTES.overview, { token: ownerToken });
    assert.equal(read.status, 404, JSON.stringify(read.body));
    return { member: member.status, withoutCapability: old.status, get: read.status };
  });

  await step("switch: the CRM is off by default, a member cannot turn it on, and the owner turns it on", async () => {
    const before = await ok(CRM_ROUTES.settings, ownerToken, {}, decodeRemoteCrmSettings);
    assert.equal(before.enabled, false);
    const refused = await Effect.runPromise(Effect.flip(current().crm.agentCustomer("any-agent", "any-customer")));
    assert.equal(refused.message, sourceText("error.crm.off"));
    const member = await wire(CRM_ROUTES.setSettings, memberToken, { enabled: true });
    assert.equal(member.status, 403, JSON.stringify(member.body));
    const memberRead = await wire(CRM_ROUTES.settings, memberToken, {});
    assert.equal(memberRead.status, 403, JSON.stringify(memberRead.body));
    const on = await ok(CRM_ROUTES.setSettings, ownerToken, { enabled: true }, decodeRemoteCrmSettings);
    assert.equal(on.enabled, true);
    assert.equal((await ok(CRM_ROUTES.settings, ownerToken, {}, decodeRemoteCrmSettings)).enabled, true);
    const saved = createCrmPreferenceStore(crmPreferencePath);
    await Effect.runPromise(saved.load());
    assert.equal(saved.get().enabled, true);
    return { before: before.enabled, member: member.status, memberRead: memberRead.status, after: on.enabled };
  });

  const created = await step("customer: the owner makes a customer", async () => {
    const overview = await ok(CRM_ROUTES.overview, ownerToken, {}, decodeRemoteCrmOverview);
    assert.deepEqual(
      overview.statuses.slice(0, 3).map((status) => [status.id, status.label]),
      [
        ["lead", null],
        ["customer", null],
        ["former", null],
      ],
    );
    const id = await applied(ownerToken, {
      kind: "customer-create",
      customer: { name: "Acme", currency: "EUR", statusId: "customer", notes: "Pays on time." },
    });
    assert.ok(id, "The new customer has no id.");
    const entry = await customer(ownerToken, id);
    assert.equal(entry.name, "Acme");
    assert.equal(entry.revision, 1);
    const activity = await ok(CRM_ROUTES.activity, ownerToken, { customerId: id }, decodeRemoteCrmActivityPage);
    assert.ok(activity.activity.length > 0, "The new customer has no activity.");
    assert.equal(activity.activity[0]?.actor.kind, "person");
    assert.ok(activity.activity[0]?.actor.name, "The activity does not name the member who made the change.");
    return { id, number: entry.number, activity: activity.activity.map((item) => item.kind) };
  });
  const customerId = created.id;

  await step("plan: a monthly plan makes the first payment; paying it makes the next one", async () => {
    const planId = await applied(ownerToken, {
      kind: "plan-create",
      plan: { customerId, name: "Pro", amountMinor: 4_900, every: "month", startsOn: "2026-01-15" },
    });
    assert.ok(planId, "The new plan has no id.");
    const open = async () =>
      (await ok(CRM_ROUTES.payments, ownerToken, { state: "open", customerId }, decodeRemoteCrmPaymentPage)).payments;
    const first = await open();
    assert.deepEqual(
      first.map((payment) => [payment.planId, payment.dueOn, payment.amountMinor, payment.currency]),
      [[planId, "2026-01-15", 4_900, "EUR"]],
    );
    const firstId = first[0]?.id ?? "";
    await applied(ownerToken, { kind: "payment-paid", paymentIds: [firstId], paidAt: "2026-01-16T09:00:00.000Z" });
    const next = await open();
    assert.deepEqual(
      next.map((payment) => [payment.planId, payment.dueOn]),
      [[planId, "2026-02-15"]],
    );
    const paid = await ok(CRM_ROUTES.payments, ownerToken, { state: "paid", customerId }, decodeRemoteCrmPaymentPage);
    assert.deepEqual(
      paid.payments.map((payment) => payment.id),
      [firstId],
    );
    const entry = await customer(ownerToken, customerId);
    assert.equal(entry.paidMinor, 4_900);
    assert.equal(entry.nextDueOn, "2026-02-15");
    return { first: first[0]?.dueOn, next: next[0]?.dueOn, paidMinor: entry.paidMinor };
  });

  await step("revision: an update with a stale revision gets a conflict and changes nothing", async () => {
    const before = await customer(ownerToken, customerId);
    await applied(ownerToken, {
      kind: "customer-update",
      customerId,
      patch: { phone: "+48 600 000 000" },
      baseRevision: before.revision,
    });
    const stale = await apply(ownerToken, {
      kind: "customer-update",
      customerId,
      patch: { phone: "+48 700 000 000" },
      baseRevision: before.revision,
    });
    assert.deepEqual(stale, { ok: false, conflict: "revision" });
    const after = await customer(ownerToken, customerId);
    assert.equal(after.phone, "+48 600 000 000");
    assert.ok(after.revision > before.revision);
    return { before: before.revision, after: after.revision, stale };
  });

  await step("statuses and tags: delete moves customers to the replacement and drops the tag", async () => {
    const statusId = await applied(ownerToken, { kind: "status-create", label: "Trial" });
    const tagId = await applied(ownerToken, { kind: "tag-create", label: "vip" });
    assert.ok(statusId && tagId, "The new status or tag has no id.");
    const duplicate = await wire(CRM_ROUTES.apply, ownerToken, { kind: "tag-create", label: "vip" });
    assert.equal(duplicate.status, 400, JSON.stringify(duplicate.body));
    const before = await customer(ownerToken, customerId);
    await applied(ownerToken, {
      kind: "customer-update",
      customerId,
      patch: { statusId },
      baseRevision: before.revision,
    });
    await applied(ownerToken, { kind: "customer-tags", customerId, tagIds: [tagId] });
    const builtin = await wire(CRM_ROUTES.apply, ownerToken, {
      kind: "status-delete",
      statusId: "lead",
      replaceWith: "customer",
    });
    assert.equal(builtin.status, 400, JSON.stringify(builtin.body));
    await applied(ownerToken, { kind: "status-delete", statusId, replaceWith: "former" });
    await applied(ownerToken, { kind: "tag-delete", tagId });
    const after = await customer(ownerToken, customerId);
    assert.equal(after.statusId, "former");
    assert.deepEqual(after.tagIds, []);
    const overview = await ok(CRM_ROUTES.overview, ownerToken, {}, decodeRemoteCrmOverview);
    assert.ok(!overview.statuses.some((status) => status.id === statusId));
    assert.ok(!overview.tags.some((tag) => tag.id === tagId));
    const missing = await wire(CRM_ROUTES.apply, ownerToken, { kind: "tag-delete", tagId });
    assert.equal(missing.status, 404, JSON.stringify(missing.body));
    return { duplicateTag: duplicate.status, builtinDelete: builtin.status, missingTag: missing.status };
  });

  await step("private fields and agent access: the owner sets both", async () => {
    const agent = await runCauseEffect(
      current().agents.createAgentProfile({
        name: "Ledger",
        description: "Ledger",
        avatarSeed: "ledger",
        avatarHue: null,
      }),
    );
    await applied(ownerToken, { kind: "private-fields", fields: ["notes", "phone", "amounts"] });
    await applied(ownerToken, { kind: "agent-access", agentIds: [agent.id] });
    const overview = await ok(CRM_ROUTES.overview, ownerToken, {}, decodeRemoteCrmOverview);
    assert.deepEqual([...overview.privateFields].sort(), ["amounts", "notes", "phone"]);
    assert.deepEqual(overview.agentIds, [agent.id]);
    assert.equal((await customer(ownerToken, customerId)).notes, "Pays on time.");
    const read = await Effect.runPromise(current().crm.agentCustomer(agent.id, customerId));
    assert.equal(read.notes, "hidden");
    assert.deepEqual(read.hiddenFields, ["phone", "notes", "amounts"]);
    const text = JSON.stringify(read);
    for (const key of ['"open"', '"late"', '"paid"', '"amount"'])
      assert.ok(!text.includes(key), `The agent read ${key}: ${text}`);
    await applied(ownerToken, { kind: "private-fields", fields: ["notes", "phone"] });
    return { privateFields: overview.privateFields, agents: overview.agentIds.length, agentId: agent.id };
  });

  await step("proposals: the owner approves one agent proposal and rejects another", async () => {
    const [agentId] = (await ok(CRM_ROUTES.overview, ownerToken, {}, decodeRemoteCrmOverview)).agentIds;
    assert.ok(agentId, "No agent has CRM access.");
    const propose = (domain: string) =>
      Effect.runPromise(
        current().crm.agentPropose(agentId, {
          change: { kind: "customer-update", customerId, patch: { domain } },
          reason: "The customer's site moved.",
          threadId: null,
        }),
      );
    const approve = await propose("acme.example");
    const reject = await propose("wrong.example");
    const pending = await ok(CRM_ROUTES.overview, ownerToken, {}, decodeRemoteCrmOverview);
    assert.deepEqual(
      pending.proposals.map((proposal) => proposal.id).sort(),
      [approve.proposalId, reject.proposalId].sort(),
    );
    const member = await wire(CRM_ROUTES.apply, memberToken, {
      kind: "proposal-decide",
      proposalId: approve.proposalId,
      approve: true,
    });
    assert.equal(member.status, 403, JSON.stringify(member.body));
    await applied(ownerToken, { kind: "proposal-decide", proposalId: approve.proposalId, approve: true });
    await applied(ownerToken, { kind: "proposal-decide", proposalId: reject.proposalId, approve: false });
    const after = await ok(CRM_ROUTES.overview, ownerToken, {}, decodeRemoteCrmOverview);
    assert.deepEqual(after.proposals, []);
    assert.equal((await customer(ownerToken, customerId)).domain, "acme.example");
    const activity = await ok(CRM_ROUTES.activity, ownerToken, { customerId }, decodeRemoteCrmActivityPage);
    assert.ok(
      activity.activity.some((item) => item.proposedBy === agentId),
      "No activity row names the agent of the approved proposal.",
    );
    assert.ok(activity.activity.some((item) => item.kind === "proposal-rejected"));
    const again = await wire(CRM_ROUTES.apply, ownerToken, {
      kind: "proposal-decide",
      proposalId: approve.proposalId,
      approve: true,
    });
    assert.equal(again.status, 404, JSON.stringify(again.body));
    return { pending: pending.proposals.length, member: member.status, decidedAgain: again.status };
  });

  await step("event: the owner's socket hears crm-changed and the member's socket does not", async () => {
    const owner = await openEvents(ownerToken);
    const member = await openEvents(memberToken);
    const heard = nextMessage(owner.socket, crmEvent);
    const memberMarker = nextMessage(member.socket, (value) =>
      isRecord(value) && value.type === "vault-changed" ? value : null,
    );
    const before = await customer(ownerToken, customerId);
    await applied(ownerToken, {
      kind: "customer-update",
      customerId,
      patch: { contactName: "Ada" },
      baseRevision: before.revision,
    });
    await heard;
    current().agents.notifyVaultChanged();
    await memberMarker;
    assert.ok(!member.types.includes("crm-changed"), JSON.stringify(member.types));
    return { owner: owner.types.filter((type) => type === "crm-changed").length, member: member.types };
  });

  await step("overview: many long proposals are cut to fit one frame, and the rest come back", async () => {
    const agentIds: string[] = [];
    for (let index = 0; index < 8; index++) {
      const agent = await runCauseEffect(
        current().agents.createAgentProfile({
          name: `Clerk ${index}`,
          description: "Clerk",
          avatarSeed: `clerk-${index}`,
          avatarHue: null,
        }),
      );
      agentIds.push(agent.id);
    }
    await applied(ownerToken, { kind: "private-fields", fields: [] });
    await applied(ownerToken, { kind: "agent-access", agentIds });
    const ids: string[] = [];
    for (const [number, agentId] of agentIds.entries())
      for (let index = 0; index < 50; index++) {
        const proposal = await Effect.runPromise(
          current().crm.agentPropose(agentId, {
            change: {
              kind: "customer-update",
              customerId,
              patch: { notes: `${number}-${index} `.padEnd(4_000, "n") },
            },
            reason: "r".repeat(1_000),
            threadId: null,
          }),
        );
        ids.push(proposal.proposalId);
      }
    const first = await wire(CRM_ROUTES.overview, ownerToken, {});
    assert.equal(first.status, 200, JSON.stringify(first.body).slice(0, 300));
    const shown = decodeRemoteCrmOverview(first.body).proposals.length;
    assert.ok(shown > 0 && shown < ids.length, `The overview showed ${shown} of ${ids.length} proposals.`);
    for (const proposal of decodeRemoteCrmOverview(first.body).proposals)
      await applied(ownerToken, { kind: "proposal-decide", proposalId: proposal.id, approve: false });
    const next = await ok(CRM_ROUTES.overview, ownerToken, {}, decodeRemoteCrmOverview);
    assert.ok(next.proposals.length > 0, "The cut proposals did not come back.");
    return { proposals: ids.length, shown, next: next.proposals.length };
  });

  report.passed = true;
} finally {
  for (const socket of sockets) socket.close();
  await stopHost();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${join(OUT, "report.json")}\n`);
}
