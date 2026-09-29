import type { AgentProviderStatus, AgentStatus } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import { PROVIDERS_RUNTIMES_V2_ROUTES } from "@openbot/contracts/team-protocol/providers-v2";
import { PROVIDERS_SIGN_IN_V3_ROUTES } from "@openbot/contracts/team-protocol/providers-v3";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Toaster } from "@openbot/ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { WebWorkspace } from "../src/features/web-client/WebWorkspace";
import type { WebRuntimeFactory } from "../src/features/web-client/web-client-context";
import { WebHostIncompatibleError } from "../src/features/web-client/web-runtime";
import { MOCK_HOSTED_SERVER_CATALOG } from "../src/preview/mock-hosted-servers";
import { createMockOpenBot } from "../src/preview/mock-openbot";
import { createMockWebRuntime } from "../src/preview/mock-web-runtime";
import "../src/features/web-client/web-client.css";

const meta = {
  title: "Web/Workspace",
  component: WebWorkspace,
  parameters: { layout: "fullscreen" },
  args: {
    accountId: "preview-account",
    accountEmail: "you@example.com",
    accountName: "Preview User",
    accountFetch: fetch,
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

const otherTabRuntime: WebRuntimeFactory = (...args) => ({
  ...createMockWebRuntime(...args),
  connect: async () => {
    throw new Error("This host is open in another tab. Close that connection before trying again.");
  },
});

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

export const Disconnected: Story = {
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
  return body ? Response.json(body) : fetch(input);
};

/** The return from Stripe Checkout: the add server dialog opens on the new server's setup. */
export const CheckoutReturn: Story = {
  args: {
    createRuntime: newServerRuntime,
    accountFetch: checkoutFetch,
    hostingReturn: { serverId: NEW_SERVER_ID, paid: true },
  },
};
