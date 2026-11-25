import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CrmChange, CrmSource, CrmSourceKind } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import { CRM_CODECS, CRM_ROUTES } from "@openbot/contracts/team-protocol/crm-v1";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { sourceText } from "@openbot/i18n/source";
import { redactText, teeLogLines } from "@openbot/logging";
import {
  decodeRemoteCrmActivityPage,
  decodeRemoteCrmApplyResult,
  decodeRemoteCrmCustomerPage,
  decodeRemoteCrmOverview,
  decodeRemoteCrmPaymentPage,
} from "@openbot/team-client/crm-decoding";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { type CrmHandle, createCrm } from "../src/backend/crm/crm";
import { CrmError } from "../src/backend/crm/crm-handle";
import { stripeSource } from "../src/backend/crm/crm-stripe";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/crm-stripe-sync-e2e");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const STEP_DEADLINE_MS = 30_000;
const STRIPE_VERSION = "2025-03-31.basil";
const GOOD_KEY = "rk_test_E2eSyncKey9xQ2w7Ld";
const NO_PERMISSION_KEY = "rk_test_E2eNoSubscriptions4k";
const UNKNOWN_KEY = "rk_test_E2eUnknownKey00000";
const SECRET_KEY = "sk_test_E2eFullAccessKey000";
const KEYS = [GOOD_KEY, NO_PERMISSION_KEY, UNKNOWN_KEY, SECRET_KEY];

plugin({
  name: "crm-stripe-sync-electron-boundary",
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

process.env.OPENBOT_LOG_LEVEL = "trace";
const { TeamApiServer } = await import("../src/main/team-api-server");
const { AGENT_ACCESS_FILE, AgentAccessStore } = await import("../src/main/agent-access-store");
const { TeamStore } = await import("../src/main/team-store");

const logged: string[] = [];
teeLogLines(["team-api-server"], (line) => logged.push(line));

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "The real api.stripe.com: a loopback stand-in answers in the 2025-03-31.basil shapes. Whether a restricted key can read /v1/account is not confirmed against Stripe.",
    "The saved key file: the keys live in memory here; main keeps them in crm-stripe-key.json with the system cipher.",
    "The 5-minute poll: each sync here starts from connect or Sync now.",
    "Agent proposals: no agent turn runs; the step calls the host's agent operation directly.",
    "The log check reads only the Team API logger at trace level. When it has no lines, the check shows only that nothing was logged.",
  ],
  steps: [],
};

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

const NOW = Math.floor(Date.now() / 1000);
const DAY = 24 * 60 * 60;

type StripeObject = { id: string; [key: string]: unknown };

const price = (nickname: string | null, unitAmount: number, product: string, interval: string, intervalCount = 1) => ({
  nickname,
  unit_amount: unitAmount,
  product,
  recurring: { interval, interval_count: intervalCount, usage_type: "licensed" },
});

const customers = new Map<string, StripeObject>(
  [
    { id: "cus_A", name: "Acme in Stripe", email: "ap@acme.example", phone: null, currency: "eur" },
    { id: "cus_B", name: "Beta in Stripe", email: "Billing@Beta.example", phone: null, currency: "eur" },
    { id: "cus_C", name: " Cobalt  ", email: "c@cobalt.example", phone: "+1 555 0100", currency: null },
    { id: "cus_D", name: "Delta", email: "d@delta.example", phone: null, currency: null },
    { id: "cus_E", name: "Iceland ehf", email: "e@iceland.example", phone: null, currency: "isk" },
  ].map((customer) => [customer.id, { object: "customer", ...customer }]),
);
const products = new Map<string, StripeObject>([
  ["prod_P", { id: "prod_P", object: "product", name: "Pro" }],
  ["prod_H", { id: "prod_H", object: "product", name: "Hosting " }],
]);
const subscriptions = new Map<string, StripeObject>(
  [
    { id: "sub_A", customer: "cus_A", currency: "eur", items: [price("Pro monthly", 4900, "prod_P", "month")] },
    { id: "sub_B", customer: "cus_B", currency: "eur", items: [price("Weekly check", 900, "prod_P", "week")] },
    { id: "sub_E", customer: "cus_E", currency: "isk", items: [price("  ", 1_200_000, "prod_H", "year")] },
  ].map(({ items, ...subscription }) => [
    subscription.id,
    {
      object: "subscription",
      status: "active",
      start_date: NOW - 30 * DAY,
      ended_at: null,
      cancel_at: null,
      canceled_at: null,
      items: { object: "list", data: items.map((item) => ({ price: item, quantity: 1 })) },
      ...subscription,
    },
  ]),
);
const invoice = (input: {
  id: string;
  number: string;
  customer: string;
  currency: string;
  status: "open" | "paid";
  amount: number;
  created: number;
  dueDate?: number;
  subscription?: string;
}): [string, StripeObject] => [
  input.id,
  {
    id: input.id,
    object: "invoice",
    number: input.number,
    status: input.status,
    customer: input.customer,
    currency: input.currency,
    amount_due: input.amount,
    amount_paid: input.status === "paid" ? input.amount : 0,
    due_date: input.dueDate ?? null,
    created: input.created,
    status_transitions: { paid_at: input.status === "paid" ? input.created + DAY : null },
    parent: input.subscription ? { subscription_details: { subscription: input.subscription } } : null,
  },
];
const invoices = new Map<string, StripeObject>([
  invoice({
    id: "in_A1",
    number: "A-0001",
    customer: "cus_A",
    currency: "eur",
    status: "paid",
    amount: 4900,
    created: NOW - 30 * DAY,
    subscription: "sub_A",
  }),
  invoice({
    id: "in_A2",
    number: "A-0002",
    customer: "cus_A",
    currency: "eur",
    status: "open",
    amount: 4900,
    created: NOW - DAY,
    dueDate: NOW + 5 * DAY,
    subscription: "sub_A",
  }),
  invoice({
    id: "in_A3",
    number: "A-0003",
    customer: "cus_A",
    currency: "usd",
    status: "open",
    amount: 1500,
    created: NOW - DAY,
  }),
  invoice({
    id: "in_B1",
    number: "B-0001",
    customer: "cus_B",
    currency: "eur",
    status: "open",
    amount: 12_000,
    created: NOW - 2 * DAY,
    dueDate: NOW + 10 * DAY,
  }),
  invoice({
    id: "in_C1",
    number: "C-0001",
    customer: "cus_C",
    currency: "usd",
    status: "open",
    amount: 5000,
    created: NOW - 2 * DAY,
    dueDate: NOW + 7 * DAY,
  }),
  invoice({
    id: "in_E1",
    number: "E-0001",
    customer: "cus_E",
    currency: "isk",
    status: "paid",
    amount: 1_200_000,
    created: NOW - 20 * DAY,
    subscription: "sub_E",
  }),
]);
interface StripeRequest {
  method: string;
  path: string;
  params: string[];
  version: string | null;
  keyMatches: boolean;
}

const stripe: { rateLimited: boolean; requests: StripeRequest[] } = { rateLimited: false, requests: [] };

function change(map: Map<string, StripeObject>, id: string, patch: Partial<StripeObject>): StripeObject {
  const object = map.get(id);
  assert.ok(object, `The stand-in has no ${id}.`);
  const next = { ...object, ...patch };
  map.set(id, next);
  return next;
}

function since(mark: number) {
  return stripe.requests.slice(mark);
}

function embedCustomer(object: StripeObject): StripeObject {
  const ref = object.customer;
  return typeof ref === "string" && customers.has(ref) ? { ...object, customer: customers.get(ref) } : object;
}

function page<T extends { id: string }>(
  items: T[],
  query: URLSearchParams,
): { object: "list"; data: T[]; has_more: boolean } {
  const limit = Number(query.get("limit") ?? "10");
  const after = query.get("starting_after");
  const rest = items.slice(after ? items.findIndex((item) => item.id === after) + 1 : 0);
  return { object: "list", data: rest.slice(0, limit), has_more: rest.length > limit };
}

function stripeAnswer(key: string | null, path: string, query: URLSearchParams): { status: number; body: unknown } {
  if (key !== GOOD_KEY && key !== NO_PERMISSION_KEY)
    return { status: 401, body: { error: { type: "invalid_request_error" } } };
  if (stripe.rateLimited) return { status: 429, body: { error: { type: "rate_limit_error" } } };
  if (key === NO_PERMISSION_KEY && path.startsWith("/v1/subscriptions"))
    return { status: 403, body: { error: { type: "permission_error" } } };
  const expand = query.getAll("expand[]");
  const one = (map: Map<string, StripeObject>, id: string) => {
    const found = map.get(decodeURIComponent(id));
    if (!found) return { status: 404, body: { error: { type: "invalid_request_error" } } };
    return { status: 200, body: expand.includes("customer") ? embedCustomer(found) : found };
  };
  const listOf = (items: StripeObject[]) => {
    const result = page(items, query);
    return {
      status: 200,
      body: expand.includes("data.customer") ? { ...result, data: result.data.map(embedCustomer) } : result,
    };
  };
  const [, , resource, id] = path.split("/");
  if (path === "/v1/account")
    return {
      status: 200,
      body: {
        id: "acct_e2e",
        object: "account",
        default_currency: "eur",
        settings: { dashboard: { display_name: "E2E Studio" } },
      },
    };
  if (resource === "customers") return id ? one(customers, id) : listOf([...customers.values()]);
  if (resource === "products") return id ? one(products, id) : listOf([...products.values()]);
  if (resource === "subscriptions") {
    if (id) return one(subscriptions, id);
    const status = query.get("status");
    return listOf([...subscriptions.values()].filter((item) => status === null || item.status === status));
  }
  if (resource === "invoices") {
    if (id) return one(invoices, id);
    const status = query.get("status");
    const createdFrom = Number(query.get("created[gte]") ?? "0");
    return listOf(
      [...invoices.values()].filter(
        (item) => (status === null || item.status === status) && Number(item.created) >= createdFrom,
      ),
    );
  }
  return { status: 404, body: { error: { type: "invalid_request_error" } } };
}

const stripeServer = createServer((request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const auth = request.headers.authorization ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  stripe.requests.push({
    method: request.method ?? "",
    path: url.pathname,
    params: [...url.searchParams.keys()],
    version: typeof request.headers["stripe-version"] === "string" ? request.headers["stripe-version"] : null,
    keyMatches: key === GOOD_KEY,
  });
  const answer =
    request.method === "GET"
      ? stripeAnswer(key, url.pathname, url.searchParams)
      : { status: 405, body: { error: { type: "invalid_request_error" } } };
  response.writeHead(answer.status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(answer.body));
});
await new Promise<void>((resolveListen) => stripeServer.listen(0, "127.0.0.1", resolveListen));
const stripeAddress = stripeServer.address();
assert.ok(stripeAddress !== null && typeof stripeAddress === "object", "The Stripe stand-in has no port.");
const stripeBase = `http://127.0.0.1:${stripeAddress.port}`;

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
  answerPermission: unused,
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
  importSignIn: unused,
};

const root = await mkdtemp(join(tmpdir(), "openbot-crm-stripe-sync-"));
const userData = join(root, "user-data");
const home = join(root, "home");

const savedKeys = new Map<CrmSourceKind, string>();

let changeWaiters: (() => void)[] = [];
function nextChange(): Promise<void> {
  return new Promise((resolveChange) => changeWaiters.push(resolveChange));
}

interface Host {
  database: OpenBotDatabase;
  agents: AgentService;
  crm: CrmHandle;
  server: InstanceType<typeof TeamApiServer>;
  port: number;
}

let host: Host | null = null;

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
  const crm = await Effect.runPromise(
    createCrm({
      database,
      settings: { get: () => ({ enabled: true }), set: (settings) => Effect.succeed(settings) },
      changed: () => {
        agents.notifyCrmChanged();
        const waiting = changeWaiters;
        changeWaiters = [];
        for (const wake of waiting) wake();
      },
      sources: {
        keys: {
          get: (kind) => savedKeys.get(kind) ?? null,
          set: (kind, key) =>
            Effect.sync(() => {
              if (key === null) savedKeys.delete(kind);
              else savedKeys.set(kind, key);
            }),
        },
        adapters: [stripeSource({ fetch: (input, init) => fetch(input, init), apiBase: stripeBase })],
      },
    }),
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
  return { database, agents, crm, server, port };
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

const responses: string[] = [];

async function call(
  method: string,
  path: string,
  input: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V9),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
    [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).join(","),
  };
  if (input.body !== undefined) headers["Content-Type"] = "application/json";
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  const response = await fetch(`http://127.0.0.1:${current().port}${path}`, {
    method,
    headers,
    body: input.body === undefined ? null : JSON.stringify(input.body),
  });
  const body = await response.text();
  responses.push(body);
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

async function wire(path: string, token: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const codec = CRM_CODECS.get(path);
  assert.ok(codec, `No crm-v1 codec for ${path}.`);
  codec.request(body);
  const response = await call("POST", path, { token, body });
  return { status: response.status, body: codec.response(response.status, response.body) };
}

async function ok<T>(path: string, token: string, body: unknown, decode: (value: unknown) => T): Promise<T> {
  const response = await wire(path, token, body);
  assert.equal(response.status, 200, `${path} returned ${response.status}: ${JSON.stringify(response.body)}`);
  return decode(response.body);
}

async function refused(path: string, token: string, body: unknown, status: number, text: string) {
  const response = await wire(path, token, body);
  assert.equal(response.status, status, `${path} returned ${response.status}: ${JSON.stringify(response.body)}`);
  assert.ok(JSON.stringify(response.body).includes(text), JSON.stringify(response.body));
  return response.status;
}

async function applied(token: string, change: CrmChange): Promise<string | null> {
  const result = await ok(CRM_ROUTES.apply, token, change, decodeRemoteCrmApplyResult);
  assert.ok(result.ok, `${change.kind} conflicted.`);
  return result.id;
}

async function login(): Promise<string> {
  const response = await call("POST", TEAM_API_ROUTES.auth.login, { body: OWNER });
  assert.equal(response.status, 200, `Sign-in returned ${response.status}.`);
  const body = response.body;
  assert.ok(typeof body === "object" && body !== null && "sessionToken" in body);
  return String(body.sessionToken);
}

const overview = (token: string) => ok(CRM_ROUTES.overview, token, {}, decodeRemoteCrmOverview);

async function allCustomers(token: string) {
  const page = await ok(CRM_ROUTES.customers, token, {}, decodeRemoteCrmCustomerPage);
  assert.equal(page.next, null, "The customers did not fit on one page.");
  return page.customers;
}

async function byName(token: string, name: string) {
  const found = (await allCustomers(token)).filter((customer) => customer.name === name);
  assert.equal(found.length, 1, `${found.length} customers are named ${name}.`);
  const [only] = found;
  assert.ok(only);
  return only;
}

async function payments(token: string, customerId: string) {
  const all = [];
  for (const state of ["open", "paid"] as const) {
    const page = await ok(CRM_ROUTES.payments, token, { state, customerId }, decodeRemoteCrmPaymentPage);
    all.push(...page.payments);
  }
  return all;
}

async function activity(token: string, customerId: string) {
  return (await ok(CRM_ROUTES.activity, token, { customerId }, decodeRemoteCrmActivityPage)).activity;
}

async function settled(token: string, trigger: () => Promise<void>): Promise<CrmSource> {
  let next = nextChange();
  await trigger();
  while (true) {
    const source = (await overview(token)).sources.find((item) => item.kind === "stripe");
    assert.ok(source, "No Stripe source after the trigger.");
    if (source.state !== "syncing") return source;
    await next;
    next = nextChange();
  }
}

try {
  host = await startHost();
  const token = await login();

  const before = await step("setup: two customers and a pending agent proposal, before Stripe", async () => {
    const acme = await applied(token, {
      kind: "customer-create",
      customer: { name: "Acme", currency: "EUR", stripeCustomerId: "cus_A" },
    });
    const beta = await applied(token, {
      kind: "customer-create",
      customer: { name: "Beta", currency: "EUR", billingEmail: "billing@beta.example" },
    });
    assert.ok(acme && beta);
    const agent = await runCauseEffect(
      current().agents.createAgentProfile({
        name: "Ledger",
        description: "Ledger",
        avatarSeed: "ledger",
        avatarHue: null,
      }),
    );
    await applied(token, { kind: "agent-access", agentIds: [agent.id] });
    const { proposalId } = await Effect.runPromise(
      current().crm.agentPropose(agent.id, {
        change: { kind: "customer-update", customerId: beta, patch: { stripeCustomerId: "cus_other" } },
        reason: "The billing system moved.",
        threadId: null,
      }),
    );
    return { acme, beta, agentId: agent.id, proposalId };
  });

  await step("connect: a secret key, an unknown key and a key without a permission are refused", async () => {
    const mark = stripe.requests.length;
    const secret = await refused(
      CRM_ROUTES.sourceConnect,
      token,
      { kind: "stripe", key: SECRET_KEY },
      400,
      sourceText("error.crm.sourceSecretKey"),
    );
    assert.equal(stripe.requests.length, mark, "A secret key reached Stripe.");
    const unknown = await refused(
      CRM_ROUTES.sourceConnect,
      token,
      { kind: "stripe", key: UNKNOWN_KEY },
      400,
      sourceText("error.crm.sourceInvalidKey"),
    );
    const permission = await refused(
      CRM_ROUTES.sourceConnect,
      token,
      { kind: "stripe", key: NO_PERMISSION_KEY },
      400,
      sourceText("error.crm.sourcePermission"),
    );
    assert.deepEqual((await overview(token)).sources, []);
    assert.equal(savedKeys.size, 0, "A refused key was saved.");
    return { secret, unknown, permission };
  });

  const first = await step("connect: the first sync imports customers, plans and payments", async () => {
    const mark = stripe.requests.length;
    let sourceId = "";
    const source = await settled(token, async () => {
      const result = await ok(
        CRM_ROUTES.sourceConnect,
        token,
        { kind: "stripe", key: GOOD_KEY },
        decodeRemoteCrmApplyResult,
      );
      assert.ok(result.ok && result.id);
      sourceId = result.id;
    });
    assert.equal(source.id, sourceId);
    assert.equal(source.state, "ok", JSON.stringify(source));
    assert.equal(source.testMode, true);
    assert.equal(source.accountLabel, "E2E Studio");
    assert.equal(source.keyHint, GOOD_KEY.slice(-4));
    assert.ok(source.syncedAt);
    assert.deepEqual(source.skipped, { currency: 1, interval: 1, limit: 0 });

    const all = await allCustomers(token);
    assert.deepEqual(all.map((customer) => customer.name).sort(), ["Acme", "Beta", "Cobalt", "Delta", "Iceland ehf"]);
    assert.ok(
      all.every((customer) => customer.source === "stripe"),
      "A customer is not linked.",
    );

    const acme = await byName(token, "Acme");
    assert.equal(acme.id, before.acme);
    assert.equal(acme.statusId, "customer");
    assert.deepEqual(
      acme.plans.map((plan) => [plan.name, plan.amountMinor, plan.every, plan.source]),
      [["Pro monthly", 4900, "month", "stripe"]],
    );
    const acmePayments = await payments(token, acme.id);
    assert.deepEqual(
      acmePayments
        .map((payment) => [payment.label, payment.amountMinor, payment.paidAt !== null, payment.source])
        .sort(),
      [
        ["A-0001", 4900, true, "stripe"],
        ["A-0002", 4900, false, "stripe"],
      ],
    );
    assert.ok(
      acmePayments.every((payment) => payment.planId === acme.plans[0]?.id),
      "An invoice is not on its plan.",
    );

    const beta = await byName(token, "Beta");
    assert.equal(beta.id, before.beta);
    assert.equal(beta.stripeCustomerId, "cus_B");
    assert.deepEqual(beta.plans, []);
    assert.deepEqual(
      (await payments(token, beta.id)).map((payment) => payment.label),
      ["B-0001"],
    );
    assert.ok(
      (await activity(token, beta.id)).some((item) => item.kind === "customer-linked" && item.actor.kind === "source"),
    );

    const cobalt = await byName(token, "Cobalt");
    assert.equal(cobalt.currency, "USD");
    assert.equal(cobalt.statusId, "lead");
    assert.equal(cobalt.method, "stripe");
    assert.equal(cobalt.contactEmail, "c@cobalt.example");
    const delta = await byName(token, "Delta");
    assert.equal(delta.currency, "EUR");

    const iceland = await byName(token, "Iceland ehf");
    assert.equal(iceland.currency, "ISK");
    assert.deepEqual(
      iceland.plans.map((plan) => [plan.name, plan.amountMinor, plan.every]),
      [["Hosting", 12_000, "year"]],
    );
    assert.deepEqual(
      (await payments(token, iceland.id)).map((payment) => payment.amountMinor),
      [12_000],
    );

    const calls = since(mark);
    assert.ok(
      calls.every((request) => request.method === "GET"),
      "A request to Stripe was not a GET.",
    );
    assert.ok(
      calls.every((request) => request.version === STRIPE_VERSION),
      "A request had another Stripe-Version.",
    );
    assert.ok(
      calls.every((request) => request.keyMatches),
      "A request did not carry the connected key.",
    );
    return { sourceId, customers: all.length, skipped: source.skipped, requests: calls.length };
  });

  await step("next sync: a paid invoice marks the payment paid, a voided one goes away", async () => {
    const acme = await byName(token, "Acme");
    const paidAt = NOW - 60;
    change(invoices, "in_A2", { status: "paid", amount_paid: 4900, status_transitions: { paid_at: paidAt } });
    change(invoices, "in_C1", { status: "void" });

    const mark = stripe.requests.length;
    const source = await settled(token, async () => {
      await ok(CRM_ROUTES.sourceSync, token, { sourceId: first.sourceId }, decodeRemoteCrmApplyResult);
    });
    assert.equal(source.state, "ok");
    const calls = since(mark);
    assert.ok(
      calls.some((request) => request.path === "/v1/invoices/in_C1"),
      "The sync did not read the open payment that the listing no longer has.",
    );
    assert.ok(!calls.some((request) => request.path.startsWith("/v1/events")), "The sync read events.");

    const after = await payments(token, acme.id);
    const a2 = after.find((payment) => payment.label === "A-0002");
    assert.equal(a2?.paidAt, new Date(paidAt * 1000).toISOString());
    assert.equal(after.filter((payment) => payment.paidAt === null).length, 0, JSON.stringify(after));
    assert.ok(
      (await activity(token, acme.id)).some(
        (item) => item.kind === "payment-paid" && item.actor.kind === "source" && item.actor.id === "stripe",
      ),
    );
    const cobalt = await byName(token, "Cobalt");
    assert.deepEqual(await payments(token, cobalt.id), []);
    return { requests: calls.map((request) => request.path), acmePayments: after.length };
  });

  await step("ownership: people and agents cannot change Stripe rows; the customer stays editable", async () => {
    const beta = await byName(token, "Beta");
    const [b1] = await payments(token, beta.id);
    assert.ok(b1);
    const acme = await byName(token, "Acme");
    const plan = acme.plans[0];
    assert.ok(plan);
    const markPaid = await refused(
      CRM_ROUTES.apply,
      token,
      { kind: "payment-paid", paymentIds: [b1.id], paidAt: new Date().toISOString() },
      400,
      sourceText("error.crm.sourceOwned"),
    );
    const planUpdate = await refused(
      CRM_ROUTES.apply,
      token,
      { kind: "plan-update", planId: plan.id, patch: { amountMinor: 100 } },
      400,
      sourceText("error.crm.sourceOwned"),
    );
    const idChange = await refused(
      CRM_ROUTES.apply,
      token,
      {
        kind: "customer-update",
        customerId: beta.id,
        patch: { stripeCustomerId: "cus_X" },
        baseRevision: beta.revision,
      },
      400,
      sourceText("error.crm.sourceOwned"),
    );
    await applied(token, {
      kind: "customer-update",
      customerId: beta.id,
      patch: { contactName: "Bea" },
      baseRevision: beta.revision,
    });
    assert.equal((await byName(token, "Beta")).contactName, "Bea");

    const agentRefusal = await Effect.runPromise(
      current()
        .crm.agentPropose(before.agentId, {
          change: { kind: "payment-paid", paymentIds: [b1.id], paidAt: new Date().toISOString() },
          reason: "The customer says they paid.",
          threadId: null,
        })
        .pipe(Effect.flip),
    );
    assert.ok(agentRefusal instanceof CrmError);
    assert.equal(agentRefusal.message, sourceText("error.crm.sourceOwned"));

    const approve = await refused(
      CRM_ROUTES.apply,
      token,
      { kind: "proposal-decide", proposalId: before.proposalId, approve: true },
      400,
      sourceText("error.crm.sourceOwned"),
    );
    assert.deepEqual((await overview(token)).proposals, []);
    assert.ok((await activity(token, beta.id)).some((item) => item.kind === "proposal-rejected"));
    assert.equal((await byName(token, "Beta")).stripeCustomerId, "cus_B");
    return { markPaid, planUpdate, idChange, approve, agent: "refused" };
  });

  await step("delete: a deleted linked customer is not imported again", async () => {
    const delta = await byName(token, "Delta");
    await applied(token, { kind: "customer-delete", customerId: delta.id });
    change(customers, "cus_D", { name: "Delta Renamed" });
    const source = await settled(token, async () => {
      await ok(CRM_ROUTES.sourceSync, token, { sourceId: first.sourceId }, decodeRemoteCrmApplyResult);
    });
    assert.equal(source.state, "ok");
    const names = (await allCustomers(token)).map((customer) => customer.name).sort();
    assert.deepEqual(names, ["Acme", "Beta", "Cobalt", "Iceland ehf"]);
    return { customers: names.length };
  });

  await step("rate limit: a 429 sets the error state, and the next sync clears it", async () => {
    stripe.rateLimited = true;
    const failed = await settled(token, async () => {
      await ok(CRM_ROUTES.sourceSync, token, { sourceId: first.sourceId }, decodeRemoteCrmApplyResult);
    });
    assert.equal(failed.state, "error");
    assert.equal(failed.errorCode, "rate-limited");
    stripe.rateLimited = false;
    const recovered = await settled(token, async () => {
      await ok(CRM_ROUTES.sourceSync, token, { sourceId: first.sourceId }, decodeRemoteCrmApplyResult);
    });
    assert.equal(recovered.state, "ok");
    assert.equal(recovered.errorCode, null);
    return { failed: failed.errorCode, recovered: recovered.state };
  });

  await step("disconnect: the key goes, the rows stay and become editable; a reconnect links them again", async () => {
    const counts = async () => {
      const all = await allCustomers(token);
      let paymentCount = 0;
      for (const customer of all) paymentCount += (await payments(token, customer.id)).length;
      return {
        customers: all.length,
        plans: all.reduce((sum, customer) => sum + customer.plans.length, 0),
        payments: paymentCount,
      };
    };
    const connected = await counts();
    const again = await refused(
      CRM_ROUTES.sourceConnect,
      token,
      { kind: "stripe", key: GOOD_KEY },
      400,
      sourceText("error.crm.sourceConnected"),
    );

    await ok(CRM_ROUTES.sourceDisconnect, token, { sourceId: first.sourceId }, decodeRemoteCrmApplyResult);
    assert.deepEqual((await overview(token)).sources, []);
    assert.equal(savedKeys.size, 0, "Disconnect kept the key.");
    const beta = await byName(token, "Beta");
    assert.equal(beta.source, null);
    const [b1] = await payments(token, beta.id);
    assert.ok(b1 && b1.source === null);
    await applied(token, { kind: "payment-update", paymentId: b1.id, patch: { label: "Edited by hand" } });

    const source = await settled(token, async () => {
      await ok(CRM_ROUTES.sourceConnect, token, { kind: "stripe", key: GOOD_KEY }, decodeRemoteCrmApplyResult);
    });
    assert.equal(source.state, "ok");
    const reconnected = await counts();
    assert.deepEqual(reconnected, connected, "The reconnect made or lost rows.");
    const [relinked] = await payments(token, beta.id);
    assert.equal(relinked?.id, b1.id);
    assert.equal(relinked?.source, "stripe");
    assert.equal(relinked?.label, "B-0001");
    return { again, connected, reconnected };
  });

  await step("secrets: no response and no log line has a key, and the log redaction hides it", async () => {
    for (const key of KEYS) {
      assert.ok(!responses.some((body) => body.includes(key)), "A response carried a key.");
      assert.ok(!logged.some((line) => line.includes(key)), "A log line carried a key.");
    }
    assert.ok(!redactText(`key=${GOOD_KEY}`).includes(GOOD_KEY), "The redaction does not hide a restricted key.");
    return { responses: responses.length, logLines: logged.length };
  });

  report.passed = true;
} finally {
  await stopHost();
  await new Promise<void>((resolveClose) => stripeServer.close(() => resolveClose()));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${join(OUT, "report.json")}\n`);
}
