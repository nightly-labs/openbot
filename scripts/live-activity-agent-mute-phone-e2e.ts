// Checks that the iOS Live Activity follows the agent mutes that the user chose on a server for all
// of their devices (#3583): an agent with a level of "nothing" in `agent-notification-levels-v1`
// leaves the island and the unread list of its server at once, the other agents stay, an unmute
// shows the agent again, and the push registration of the shown server stays.
//
// It renders the real mobile hook (`useLiveActivity`) with React, with the real settings stores, the
// synced agent levels (`useSyncedNotificationLevels`), the Dynamic Island coordinator, the Live
// Activity view, and `LiveActivitySync`. Only the boundaries that need a phone are replaced: the
// ActivityKit module that `agentLiveActivity()` returns, the keychain, the phone analytics, and the
// host requests. It sends nothing. The app modules need Expo at run time, so the plugin of this
// script replaces each Expo module that the chain reaches and sets `__DEV__` before the first
// import; no Expo package runs. Run it with `bun scripts/live-activity-agent-mute-phone-e2e.ts`.
// Writes .openbot-build/live-activity-agent-mute-phone-e2e/report.json.
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentEvent, AgentSummary } from "@openbot/contracts/ipc";
import { LIVE_ACTIVITY_PUSH_ROUTES } from "@openbot/contracts/team-protocol/live-activity-push-v1";
import { createOpenBotLogger } from "@openbot/logging";
import { plugin } from "bun";

const OUT = resolve(import.meta.dirname, "../.openbot-build/live-activity-agent-mute-phone-e2e");
const MOBILE_SRC = resolve(import.meta.dirname, "../apps/mobile/src");
const WAIT_TIMEOUT_MS = 10_000;
const PUSH_TOKEN = "e2e-agent-mute-push-token";
const SERVER_A = "server-a";
const SERVER_B = "server-b";
const AGENT_A = "agent-a";
const AGENT_B = "agent-b";
const logger = createOpenBotLogger("live-activity-agent-mute-phone-e2e");
const require = createRequire(import.meta.url);

// --- The ActivityKit module of the iOS build, as the hook uses it. ---

interface ActivityRecord {
  id: number;
  starts: string[];
  updates: string[];
  ended: boolean;
}

const activities: ActivityRecord[] = [];

function createActivity(props: unknown) {
  const record: ActivityRecord = {
    id: activities.length + 1,
    starts: [JSON.stringify(props)],
    updates: [],
    ended: false,
  };
  activities.push(record);
  return {
    startedAt: Date.now(),
    isActive: () => !record.ended,
    async update(next: unknown) {
      if (record.ended) throw new Error("The activity ended.");
      record.updates.push(JSON.stringify(next));
    },
    async end() {
      record.ended = true;
    },
    watchPushToken(receive: (token: string) => void) {
      receive(PUSH_TOKEN);
      return () => undefined;
    },
  };
}

const native = {
  starter: {
    start: createActivity,
    // The case starts with no activity from an earlier launch.
    getInstances: () => [],
  },
  setSealKeys: () => undefined,
  saveAvatar: (name: string) => name,
  hasAvatar: () => true,
  renderBloub: () => null,
  removeAvatars: () => undefined,
};

/** The content that the running activity shows, or `null` when none runs. */
function shownContent(): string | null {
  const running = activities.filter((activity) => !activity.ended);
  assert.ok(running.length <= 1, "More than one Live Activity runs.");
  const activity = running[0];
  if (!activity) return null;
  return activity.updates.at(-1) ?? activity.starts[0] ?? null;
}

// --- The phone modules that have no Bun build. The hook reaches them only through these names. ---

const keychain = new Map<string, string>();
plugin({
  name: "live-activity-agent-mute-phone-boundaries",
  setup(build) {
    build.module("react-native", () => ({
      loader: "object",
      exports: {
        Alert: { alert: () => undefined },
        AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
      },
    }));
    build.module("expo-secure-store", () => ({
      loader: "object",
      exports: {
        getItemAsync: async (key: string) => keychain.get(key) ?? null,
        setItemAsync: async (key: string, value: string) => {
          keychain.set(key, value);
        },
        deleteItemAsync: async (key: string) => {
          keychain.delete(key);
        },
      },
    }));
    build.module("expo-crypto", () => ({
      loader: "object",
      exports: { getRandomBytes: (count: number) => webcrypto.getRandomValues(new Uint8Array(count)) },
    }));
    // The app aliases `@/` to `apps/mobile/src`.
    build.onResolve({ filter: /^@\// }, ({ path }) => ({ path: require.resolve(join(MOBILE_SRC, path.slice(2))) }));
    build.onLoad({ filter: /live-activity[/\\]agent-live-activity\.tsx$/ }, () => ({
      loader: "object",
      exports: { agentLiveActivity: () => native },
    }));
    // The language comes from the phone. The test uses English.
    build.onLoad({ filter: /shared[/\\]lib[/\\]text\.ts$/ }, async () => {
      const { textFor }: { textFor: (locale: "en") => unknown } = await import(mobileUrl("shared/lib/text-value.ts"));
      return { loader: "object", exports: { currentText: () => textFor("en"), currentLocale: () => "en" } };
    });
    // The phone analytics need Expo modules that the plugin does not give: they stay out.
    build.onLoad({ filter: /analytics[/\\]mobile-analytics\.ts$/ }, () => ({
      loader: "object",
      exports: { mobileAnalytics: { track: () => undefined, error: () => undefined } },
    }));
    build.onLoad({ filter: /analytics[/\\]failure-reports\.ts$/ }, () => ({
      loader: "object",
      exports: { showFailureAlert: () => undefined, mobileReportQueue: { push: () => undefined } },
    }));
    build.onLoad({ filter: /shared[/\\]lib[/\\]push-environment\.ts$/ }, () => ({
      loader: "object",
      exports: { usePushEnvironment: () => "development" },
    }));
    build.onLoad({ filter: /agents[/\\]model[/\\]bloub-activity\.ts$/ }, () => ({
      loader: "object",
      exports: { getBloubAvatarColor: () => "#5E5CE6" },
    }));
  },
});

/** The mobile modules load at run time, so the Node typecheck does not read the app sources. */
function mobileUrl(path: string): string {
  return pathToFileURL(join(MOBILE_SRC, path)).href;
}

// React is a dependency of the mobile app, so it loads from there, as the hook does.
interface Root {
  render: (element: unknown) => void;
  unmount: () => void;
}
const mobileRequire = createRequire(join(MOBILE_SRC, "../package.json"));
const { createElement }: { createElement: (component: () => null) => unknown } = mobileRequire("react");
const { createRoot }: { createRoot: (container: Element) => Root } = mobileRequire("react-dom/client");

// React DOM reads the global window. The hook renders nothing.
const { JSDOM }: { JSDOM: new (html: string) => { window: Window & typeof globalThis } } = require("jsdom");
const dom = new JSDOM("<!doctype html><div></div>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document });

// Expo reads this at run time. No module of the chain reaches it after the plugin above.
Object.assign(globalThis, { __DEV__: false });

// --- The real mobile modules. ---

type ServerState = "online" | "offline";
interface Server {
  id: string;
  state: ServerState;
}
interface Agent {
  id: string;
  serverId: string;
  name: string;
  title: string;
  description: string;
  preview: string;
  updatedLabel: string;
  avatarUrl: null;
  avatarSeed: string;
  avatarHue: null;
  notifications: boolean;
}
type Post = (serverId: string, path: string, body: unknown) => Promise<void>;
interface LiveActivityInput {
  servers: readonly Server[];
  activeServerId: string | null;
  agents: readonly Agent[];
  liveState: { get(): { unreadAgentIds: string[]; unreadCounts: Record<string, number> }; subscribe(): () => void };
  foreground: boolean;
  post: Post;
  loadAgentAvatar: () => Promise<string>;
  supportsPush: () => boolean;
  sideThreadOfTurn: () => string | null;
}
interface ServerNotificationSetting {
  level: "all" | "needs-me" | "nothing";
  mute: { until: number | null } | null;
}
interface PreferenceStore<State> {
  getState(): State;
  setState(state: Partial<State>): void;
}

const {
  useLiveActivity,
}: { useLiveActivity: (input: LiveActivityInput) => (serverId: string, event: AgentEvent) => void } = await import(
  mobileUrl("features/live-activity/use-live-activity.ts")
);
const notifications: {
  usePushNotificationPreference: PreferenceStore<{
    ready: boolean;
    saving: boolean;
    servers: Record<string, ServerNotificationSetting>;
  }>;
  saveServerNotificationSetting: (serverId: string, change: Partial<ServerNotificationSetting>) => Promise<void>;
} = await import(mobileUrl("features/settings/model/push-notifications.ts"));
const liveActivities: { useLiveActivitiesPreference: PreferenceStore<{ enabled: boolean; ready: boolean }> } =
  await import(mobileUrl("features/settings/model/live-activities.ts"));
const {
  setSyncedNotificationLevels,
}: {
  setSyncedNotificationLevels: (
    serverId: string,
    snapshot: {
      server: "all" | "needs-me" | "nothing" | null;
      agents: Array<{ agentId: string; level: "all" | "needs-me" | "nothing" }>;
    },
  ) => void;
} = await import(mobileUrl("features/settings/model/notification-levels.ts"));

// --- The harness. ---

const requests: { serverId: string; path: string; token?: string }[] = [];
const post: Post = async (serverId, path, body) => {
  const token = typeof body === "object" && body !== null && "token" in body ? String(body.token) : undefined;
  requests.push({ serverId, path, ...(token === undefined ? {} : { token }) });
};
/** The unread replies of the phone, as the workspace store reports them. The case changes it. */
const unread: { agentIds: string[]; counts: Record<string, number> } = {
  agentIds: [AGENT_A, AGENT_B],
  counts: { [AGENT_A]: 1, [AGENT_B]: 1 },
};
const liveState = {
  get: () => ({ unreadAgentIds: unread.agentIds, unreadCounts: unread.counts }),
  subscribe: () => () => undefined,
};

function agent(id: string, serverId: string, name: string): Agent {
  return {
    id,
    serverId,
    name,
    title: "",
    description: "",
    preview: "",
    updatedLabel: "",
    avatarUrl: null,
    avatarSeed: id,
    avatarHue: null,
    notifications: true,
  };
}

const AGENT_FIXTURES: [Agent, Agent] = [agent(AGENT_A, SERVER_A, "Agent A"), agent(AGENT_B, SERVER_B, "Agent B")];

function summary(fixture: Agent): AgentSummary {
  return {
    id: fixture.id,
    name: fixture.name,
    title: fixture.title,
    description: fixture.description,
    notifications: true,
    provider: "codex",
    model: "gpt-5.5",
    reasoningEffort: "low",
    threadId: `thread-${fixture.id}`,
    workspacePath: "/tmp",
    preview: "",
    updatedAt: null,
    avatarSeed: fixture.avatarSeed,
    avatarHue: null,
    avatarUrl: null,
  };
}

/** Waits for a state of the activity or the host requests that the hook reaches on its own. */
async function waitFor(label: string, probe: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!probe()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting until ${label}.`);
    await new Promise((done) => setImmediate(done));
  }
}

interface Session {
  apply: (serverId: string, event: AgentEvent) => void;
  root: Root;
}

async function startSession(): Promise<Session> {
  activities.length = 0;
  requests.length = 0;
  keychain.clear();
  unread.agentIds = [AGENT_A, AGENT_B];
  unread.counts = { [AGENT_A]: 1, [AGENT_B]: 1 };
  liveActivities.useLiveActivitiesPreference.setState({ enabled: true, ready: true });
  notifications.usePushNotificationPreference.setState({ ready: true, saving: false, servers: {} });
  setSyncedNotificationLevels(SERVER_A, { server: null, agents: [] });
  setSyncedNotificationLevels(SERVER_B, { server: null, agents: [] });
  const servers: Server[] = [
    { id: SERVER_A, state: "online" },
    { id: SERVER_B, state: "online" },
  ];
  const session: Partial<Session> = {};
  function Harness() {
    session.apply = useLiveActivity({
      servers,
      activeServerId: SERVER_A,
      agents: AGENT_FIXTURES,
      liveState,
      foreground: true,
      post,
      loadAgentAvatar: async () => "",
      supportsPush: () => true,
      sideThreadOfTurn: () => null,
    });
    return null;
  }
  const root = createRoot(dom.window.document.createElement("div"));
  root.render(createElement(Harness));
  await waitFor("the hook renders", () => session.apply !== undefined);
  const apply = session.apply;
  assert.ok(apply);
  // Each agent runs a turn, so the activity shows both as working.
  for (const fixture of AGENT_FIXTURES) {
    apply(fixture.serverId, { type: "agents-changed", agents: [summary(fixture)] });
    apply(fixture.serverId, {
      type: "conversation",
      snapshot: {
        agentId: fixture.id,
        threadId: `thread-${fixture.id}`,
        activeTurnId: "turn-1",
        revision: 1,
        messages: [],
      },
    });
  }
  return { apply, root };
}

function shows(agentName: string): boolean {
  return shownContent()?.includes(agentName) ?? false;
}

function registeredWith(serverId: string): boolean {
  const last = requests.filter((request) => request.serverId === serverId).at(-1);
  return last?.path === LIVE_ACTIVITY_PUSH_ROUTES.register && last.token === PUSH_TOKEN;
}

function removedFrom(serverId: string): boolean {
  return requests.filter((request) => request.serverId === serverId).at(-1)?.path === LIVE_ACTIVITY_PUSH_ROUTES.remove;
}

interface CaseResult {
  name: string;
  passed: boolean;
  checks: Record<string, boolean>;
  error?: string;
}

/** The agent answers and its turn ends, so the island moves to the unread replies. */
function completeTurn(apply: Session["apply"], fixture: Agent) {
  apply(fixture.serverId, {
    type: "conversation",
    snapshot: {
      agentId: fixture.id,
      threadId: `thread-${fixture.id}`,
      activeTurnId: null,
      revision: 2,
      messages: [
        {
          id: `message-${fixture.id}`,
          author: "agent",
          text: `The answer of ${fixture.name}.`,
          createdAt: "2026-11-17T00:00:00.000Z",
          status: "completed",
        },
      ],
    },
  });
}

const cases: [string, () => Promise<CaseResult>][] = [
  [
    "baseline: the agents of the active server show and the active server has the token",
    async () => {
      const { root } = await startSession();
      await waitFor("the island shows agent A", () => shows("Agent A"));
      await waitFor("server A has the push token", () => registeredWith(SERVER_A));
      // The island shows one server at a time. The agent of the other server shows while the muted
      // one is away: the mute case checks that.
      root.unmount();
      return {
        name: "baseline",
        passed: true,
        checks: { activeServerAgentShown: true, tokenForActiveServer: true },
      };
    },
  ],
  [
    "a muted agent leaves the island and the unread list, and the registration stays",
    async () => {
      const { apply, root } = await startSession();
      await waitFor("the island shows agent A", () => shows("Agent A"));
      await waitFor("server A has the push token", () => registeredWith(SERVER_A));
      setSyncedNotificationLevels(SERVER_A, { server: null, agents: [{ agentId: AGENT_A, level: "nothing" }] });
      await waitFor("the island hides agent A", () => !shows("Agent A"));
      const checks: Record<string, boolean> = {
        mutedAgentHidden: !shows("Agent A"),
        controlAgentShown: shows("Agent B"),
        registrationStays: registeredWith(SERVER_A),
        noRemoveRequest: !removedFrom(SERVER_A),
      };
      // The unread list follows the same mute: with the turns over, the island shows the replies
      // that stay, and the muted agent is not among them. The island then moves to server B, whose
      // agent is not muted.
      completeTurn(apply, AGENT_FIXTURES[0]);
      completeTurn(apply, AGENT_FIXTURES[1]);
      await waitFor("the island shows the reply of agent B", () => shows("Agent B"));
      await waitFor("the island stays without agent A", () => !shows("Agent A"));
      checks.unreadListWithoutMutedAgent = !shows("Agent A") && shows("Agent B");
      checks.otherServerShown = shows("Agent B");
      root.unmount();
      return { name: "agent mute", passed: Object.values(checks).every(Boolean), checks };
    },
  ],
  [
    "an unmute shows the agent again and keeps the token",
    async () => {
      const { root } = await startSession();
      await waitFor("the island shows agent A", () => shows("Agent A"));
      await waitFor("server A has the push token", () => registeredWith(SERVER_A));
      setSyncedNotificationLevels(SERVER_A, { server: null, agents: [{ agentId: AGENT_A, level: "nothing" }] });
      await waitFor("the island hides agent A", () => !shows("Agent A"));
      setSyncedNotificationLevels(SERVER_A, { server: null, agents: [] });
      await waitFor("the island shows agent A again", () => shows("Agent A"));
      const checks: Record<string, boolean> = {
        unmutedAgentShown: shows("Agent A"),
        tokenStays: registeredWith(SERVER_A),
        noRemoveRequest: !removedFrom(SERVER_A),
      };
      root.unmount();
      return { name: "unmute", passed: Object.values(checks).every(Boolean), checks };
    },
  ],
  [
    "the agent of the other server keeps its own updates while the agent of the active server is muted",
    async () => {
      const { apply, root } = await startSession();
      await waitFor("the island shows agent A", () => shows("Agent A"));
      setSyncedNotificationLevels(SERVER_A, { server: null, agents: [{ agentId: AGENT_A, level: "nothing" }] });
      await waitFor("the island moves to agent B", () => shows("Agent B"));
      const checks: Record<string, boolean> = {
        otherServerShown: shows("Agent B"),
        mutedAgentHidden: !shows("Agent A"),
      };
      // Later updates of the other server still show its agent, and the muted one stays out.
      completeTurn(apply, AGENT_FIXTURES[1]);
      await waitFor("the island updates agent B again", () => shows("Agent B"));
      checks.otherServerUpdated = shows("Agent B") && !shows("Agent A");
      root.unmount();
      return { name: "other server unaffected", passed: Object.values(checks).every(Boolean), checks };
    },
  ],
];

mkdirSync(OUT, { recursive: true });
const results: CaseResult[] = [];
for (const [name, run] of cases) {
  logger.info(`Case: ${name}.`);
  try {
    results.push(await run());
  } catch (error) {
    results.push({ name, passed: false, checks: {}, error: error instanceof Error ? error.message : String(error) });
  }
}
const passed = results.every((result) => result.passed);
writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ passed, results }, null, 2)}\n`);
logger.info(`Checked ${results.length} cases. Wrote ${join(OUT, "report.json")}.`);
if (!passed) {
  for (const result of results.filter((candidate) => !candidate.passed)) {
    logger.error(`${result.name}: ${result.error ?? JSON.stringify(result.checks)}`);
  }
  process.exit(1);
}
process.exit(0);
