import type { AgentProviderStatus, AgentStatus } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_TASKS_CAPABILITY, AGENT_TASKS_ROUTES } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import { AGENT_THREADS_CAPABILITY, AGENT_THREADS_ROUTES } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import { PROVIDERS_RUNTIMES_V2_ROUTES } from "@openbot/contracts/team-protocol/providers-v2";
import { PROVIDERS_SIGN_IN_V3_ROUTES } from "@openbot/contracts/team-protocol/providers-v3";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Toaster } from "@openbot/ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { WebWorkspace } from "../src/features/web-client/WebWorkspace";
import type { WebRuntimeFactory } from "../src/features/web-client/web-client-context";
import { WebHostOtherTabError } from "../src/features/web-client/web-host-lock";
import { WebHostIncompatibleError } from "../src/features/web-client/web-runtime";
import { createBenchWebRuntime } from "../src/preview/bench-web-runtime";
import { mockAccountCatalogFetch } from "../src/preview/mock-account-catalog";
import { MOCK_HOSTED_SERVER_CATALOG } from "../src/preview/mock-hosted-servers";
import { createMockOpenBot } from "../src/preview/mock-openbot";
import { createMockWebRuntime, mockWebRuntimeFor } from "../src/preview/mock-web-runtime";
import { AGENT_ID, TABS_KEY, THREAD_OPTIONS } from "./agent-threads-fixtures";
import "../src/features/web-client/web-client.css";

/** The account service: the marketplace catalog is a mock, and other routes go to the network. */
const accountFetch = mockAccountCatalogFetch();

const meta = {
  title: "Web/Workspace",
  component: WebWorkspace,
  parameters: { layout: "fullscreen" },
  args: {
    accountId: "preview-account",
    accountEmail: "you@example.com",
    accountName: "Preview User",
    accountFetch,
    onSessionCheck: async () => {},
    onLogout: async () => {},
    createRuntime: createMockWebRuntime,
    language: "system",
    onChangeLanguage: () => {},
  },
  render: (args) => (
    <div class="web-app">
      <Toaster />
      <WebWorkspace {...args} />
    </div>
  ),
} satisfies Meta<typeof WebWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {};

/** The Marketplace page, opened on an app by a `/app?plugin=<slug>` link. */
export const MarketplaceApp: Story = {
  args: { pluginSlug: "linear" },
};

/** A long conversation. `bun run perf:web` streams replies into it and counts the host requests. */
export const LongConversation: Story = {
  args: { createRuntime: createBenchWebRuntime },
};

const noHostRuntime: WebRuntimeFactory = (...args) => ({
  ...createMockWebRuntime(...args),
  listHosts: async () => [],
});

const failedHostsRuntime: WebRuntimeFactory = (...args) => ({
  ...createMockWebRuntime(...args),
  listHosts: async () => {
    throw new Error("Host directory unavailable.");
  },
});

/** Another tab has the host open until "Use here" takes it. */
const otherTabRuntime: WebRuntimeFactory = (...args) => {
  const runtime = createMockWebRuntime(...args);
  return {
    ...runtime,
    connect: async (host, options) => {
      if (!options?.takeOver) throw new WebHostOtherTabError();
      return runtime.connect(host, options);
    },
  };
};

const incompatibleRuntime: WebRuntimeFactory = (...args) => ({
  ...createMockWebRuntime(...args),
  connect: async () => {
    throw new WebHostIncompatibleError(
      { appVersion: "0.40.0", protocol: { minimum: 1, maximum: 2 }, capabilities: [] },
      "host_update_required",
    );
  },
});

export const NoHost: Story = {
  args: { accountEmail: "you@example.com", createRuntime: noHostRuntime },
};

export const HostsFailed: Story = {
  args: { accountEmail: "you@example.com", createRuntime: failedHostsRuntime },
};

export const OpenInAnotherTab: Story = {
  args: { accountEmail: "you@example.com", createRuntime: otherTabRuntime },
};

export const Incompatible: Story = {
  args: { accountEmail: "you@example.com", createRuntime: incompatibleRuntime },
};

const NEW_SERVER_ID = "cloud-server";

/**
 * A server the user just bought or set up, next to the preview computer: no agents, and no provider
 * signed in on the host. The host serves the provider routes, so an owner sees the provider step
 * before the agent form. Claude signs in with a pasted code; any code connects it.
 */
const newServerRuntime: WebRuntimeFactory = (accountId, events, accountFetch) => {
  const base = createMockWebRuntime(accountId, events, accountFetch);
  const team = createMockOpenBot();
  let status: AgentStatus = {
    phase: "blocked",
    cliVersion: null,
    auth: { kind: "unknown" },
    providers: [
      { id: "codex", state: "sign-in-required", version: "0.149.1", message: null },
      { id: "claude", state: "sign-in-required", version: "2.1.263", message: null },
      { id: "grok", state: "sign-in-required", version: "1.0.22", message: null },
    ],
    capabilities: { chat: "unavailable", browser: "ready", computerUse: "unavailable" },
    message: null,
    fullAccess: true,
  };
  const setClaude = (row: AgentProviderStatus) => {
    status = {
      ...status,
      providers: (status.providers ?? []).map((current) => (current.id === "claude" ? row : current)),
    };
  };
  const ready = (version: string) => ({ phase: "ready", progress: 100, message: null, version });
  const none = { phase: "not-downloaded", progress: null, message: null, version: null };
  const answers: Record<string, (body: unknown) => unknown> = {
    [PROVIDERS_RUNTIMES_V2_ROUTES.runtimesStatus]: () => ({
      revision: 1,
      providers: {
        codex: ready("0.149.1"),
        claude: ready("2.1.263"),
        grok: ready("1.0.22"),
        opencode: none,
        antigravity: none,
      },
      toolRuntimes: { bun: none },
    }),
    [PROVIDERS_ADMIN_ROUTES.customList]: () => [],
    [PROVIDERS_ADMIN_ROUTES.apiKeyState]: () => ({ status: "missing" }),
    [PROVIDERS_SIGN_IN_V3_ROUTES.codeLoginStart]: () => ({
      kind: "paste",
      verificationUrl: "https://claude.com/cai/oauth/authorize?code=true",
      expiresAt: Date.now() + 600_000,
    }),
    // The host checks the code for a moment, then Claude is signed in.
    [PROVIDERS_SIGN_IN_V3_ROUTES.codeLoginSubmit]: () => {
      const claude = { id: "claude", version: "2.1.263", message: null } as const;
      setClaude({ ...claude, state: "sign-in-required", connectionState: "connecting" });
      window.setTimeout(() => {
        status = { ...status, phase: "ready" };
        setClaude({ ...claude, state: "available", email: "you@example.com" });
        events.event(NEW_SERVER_ID, { type: "status", status });
      }, 1500);
      return {};
    },
    [PROVIDERS_SIGN_IN_V3_ROUTES.codeLoginCancel]: () => ({}),
    [TEAM_API_ROUTES.agents.status]: () => status,
  };
  const request: TeamApiRequest = async (_method, path, decode, body) => {
    const answer = answers[path];
    if (!answer) throw new Error(`No preview answer for ${path}.`);
    return decode(answer(body));
  };
  let connected = NEW_SERVER_ID;
  const onNewServer = () => connected === NEW_SERVER_ID;
  return {
    ...base,
    listHosts: async () => {
      const [computer] = await base.listHosts();
      return computer ? [{ ...computer, hostId: NEW_SERVER_ID, name: "Cloud server" }, computer] : [];
    },
    connect: async (host) => {
      connected = host.hostId;
      const capabilities = await base.connect(host);
      events.connection({ hostId: host.hostId, state: "online", message: null });
      return onNewServer() ? [...capabilities, "providers-v1", "providers-v2", "providers-v3"] : capabilities;
    },
    listAgents: async () => (onNewServer() ? [] : base.listAgents()),
    status: async () => (onNewServer() ? status : base.status()),
    admin: { request, team: team.api.host },
    dispose: async () => {
      team.dispose();
      await base.dispose();
    },
  };
};

export const NewServer: Story = {
  args: { createRuntime: newServerRuntime },
};

/** A host with side threads: the agent-tasks routes, and rename and delete through `agent-threads-v1`. */
const threadsRuntime: WebRuntimeFactory = (_accountId, events) => {
  const mock = createMockOpenBot(THREAD_OPTIONS);
  const base = mockWebRuntimeFor(mock, events);
  const agent = mock.api.agent;
  const answers: Record<string, (body: Record<string, string>) => Promise<unknown>> = {
    [AGENT_TASKS_ROUTES.list]: (body) => agent.listTasks(body.agentId ?? ""),
    [AGENT_TASKS_ROUTES.read]: (body) => agent.readTask({ agentId: body.agentId ?? "", taskId: body.taskId ?? "" }),
    [AGENT_TASKS_ROUTES.start]: (body) =>
      agent.startTask({
        agentId: body.agentId ?? "",
        text: body.text ?? "",
        clientMessageId: body.clientMessageId ?? "",
      }),
    [AGENT_TASKS_ROUTES.send]: (body) =>
      agent.sendMessage({
        agentId: body.agentId ?? "",
        taskId: body.taskId ?? "",
        text: body.text ?? "",
        clientMessageId: body.clientMessageId ?? "",
      }),
    [AGENT_TASKS_ROUTES.stop]: (body) => agent.stopTask({ agentId: body.agentId ?? "", taskId: body.taskId ?? "" }),
    [AGENT_TASKS_ROUTES.close]: (body) => agent.closeTask({ agentId: body.agentId ?? "", taskId: body.taskId ?? "" }),
    [AGENT_TASKS_ROUTES.reopen]: (body) => agent.reopenTask({ agentId: body.agentId ?? "", taskId: body.taskId ?? "" }),
    [AGENT_THREADS_ROUTES.rename]: (body) =>
      agent.renameTask({ agentId: body.agentId ?? "", taskId: body.taskId ?? "", title: body.title ?? "" }),
    [AGENT_THREADS_ROUTES.delete]: (body) =>
      agent.deleteTask({ agentId: body.agentId ?? "", taskId: body.taskId ?? "" }),
  };
  const request: TeamApiRequest = async (_method, path, decode, body) => {
    const answer = answers[path];
    if (!answer) throw new Error(`No preview answer for ${path}.`);
    const fields: Record<string, string> = {};
    if (body && typeof body === "object")
      for (const [key, value] of Object.entries(body)) if (typeof value === "string") fields[key] = value;
    return decode((await answer(fields)) ?? {});
  };
  return {
    ...base,
    connect: async (host) => [...(await base.connect(host)), AGENT_TASKS_CAPABILITY, AGENT_THREADS_CAPABILITY],
    admin: { request, team: mock.api.host },
  };
};

/** Side threads in the browser: Chief has two open thread tabs. Open Chief to see them. */
export const Threads: Story = {
  args: { createRuntime: threadsRuntime },
  render: (args) => {
    localStorage.setItem(
      TABS_KEY,
      JSON.stringify({ "preview-host": { [AGENT_ID]: { open: ["pricing", "competitors"], active: "pricing" } } }),
    );
    return (
      <div class="web-app">
        <Toaster />
        <WebWorkspace {...args} />
      </div>
    );
  },
};

/** The account server's hosted server list, with the server that Checkout paid for already running. */
const checkoutFetch: typeof fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  const body = url.endsWith("/hosting/plans")
    ? MOCK_HOSTED_SERVER_CATALOG
    : url.endsWith("/hosting/servers")
      ? {
          available: true,
          servers: [
            {
              serverId: NEW_SERVER_ID,
              name: "Cloud server",
              size: "default",
              plan: "standard",
              interval: "month",
              currency: "eur",
              state: "running",
              error: null,
              createdAt: "2026-09-29T09:30:00.000Z",
              updatedAt: "2026-09-29T09:34:00.000Z",
            },
          ],
        }
      : null;
  return body ? Response.json(body) : accountFetch(input);
};

/** The return from Stripe Checkout: the add server dialog opens on the new server's setup. */
export const CheckoutReturn: Story = {
  args: {
    createRuntime: newServerRuntime,
    accountFetch: checkoutFetch,
    hostingReturn: { serverId: NEW_SERVER_ID, paid: true },
  },
};

/** A hosted server that stopped because nobody used it. A key press or a click wakes it. */
const sleepingRuntime: WebRuntimeFactory = (...args) => ({
  ...createMockWebRuntime(...args),
  connect: async () => {
    throw new Error("The host is not available.");
  },
});

const sleepingFetch: typeof fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/preview-host/status"))
    return Response.json({ serverId: "preview-host", state: "stopped", error: null, sleeping: true });
  if (url.endsWith("/preview-host/wake"))
    return Response.json({
      serverId: "preview-host",
      name: "Preview computer",
      size: "small",
      plan: "starter",
      interval: "month",
      currency: "eur",
      state: "waking",
      error: null,
      createdAt: "2026-09-29T09:30:00.000Z",
      updatedAt: "2026-09-29T09:34:00.000Z",
    });
  return accountFetch(input, init);
};

export const HostedServerAsleep: Story = {
  args: { createRuntime: sleepingRuntime, accountFetch: sleepingFetch },
};

/** Another tab has the cloud server open. The server rail opens the other server. */
const otherTabServersRuntime: WebRuntimeFactory = (...args) => {
  const runtime = createMockWebRuntime(...args);
  return {
    ...runtime,
    listHosts: async () => {
      const [computer] = await runtime.listHosts();
      return computer ? [{ ...computer, hostId: NEW_SERVER_ID, name: "Cloud server" }, computer] : [];
    },
    connect: async (host, options) => {
      if (host.hostId === NEW_SERVER_ID && !options?.takeOver) throw new WebHostOtherTabError();
      return runtime.connect(host, options);
    },
  };
};

export const OpenInAnotherTabWithServers: Story = {
  args: { accountEmail: "you@example.com", createRuntime: otherTabServersRuntime },
};
