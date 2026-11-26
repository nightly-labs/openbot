import { X_AGENT_LISTING_ID } from "@openbot/contracts/browser-extension-x";
import {
  AVATAR_HUES,
  type ClientAgentSummary,
  DEFAULT_MCP_SERVER_ACCESS,
  type InstalledSkill,
  type MarketplaceAgentDetail,
  type MarketplaceAgentSummary,
  type MarketplaceSkillQuery,
  type MarketplaceSkillSummary,
  type McpServerAccess,
  type McpServerConfig,
  type McpSignInApp,
  type McpSignInState,
  type SkillCategory,
} from "@openbot/contracts/ipc";
import type { McpConnectFlow } from "@openbot/contracts/mcp-connect-flows";
import { sourceText } from "@openbot/i18n";
import { CONNECTOR_LISTINGS } from "@openbot/ui/features/connectors/connector-catalog";
import { Marketplace } from "@openbot/ui/features/marketplace/Marketplace";
import { AgentsDialog } from "@openbot/ui/features/marketplace/MarketplaceAgentsDialog";
import {
  type MarketplaceAgent,
  type MarketplaceApp,
  type MarketplaceAppAccount,
  type MarketplaceAppConnection,
  type MarketplaceAppsBlock,
  type MarketplaceModel,
  X_APP_ID,
} from "@openbot/ui/features/marketplace/marketplace-model";
import {
  createMarketplaceNavigation,
  type MarketplaceNavigation,
} from "@openbot/ui/features/marketplace/marketplace-view";
import { McpConnectDialog } from "@openbot/ui/features/settings/McpConnectDialog";
import type { McpConnectSubject } from "@openbot/ui/features/settings/McpConnectShell";
import type { MarketplacePluginApp } from "@openbot/ui/features/settings/marketplace-plugins";
import { currentText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, createStore, onSettled, Show, untrack } from "solid-js";
import { fn } from "storybook/test";
import { McpServerControls } from "../src/features/servers/McpServerControls";
import { McpServerForm } from "../src/features/servers/McpServerForm";
import type { McpPanelSignInApp } from "../src/features/servers/McpSignInAppSection";
import type { McpServerTools } from "../src/features/servers/mcp-server-tools";
import { MARKETPLACE_PLUGINS } from "../src/features/settings/marketplace-plugin-catalog";
import {
  STORY_AGENT_SUMMARIES,
  STORY_MARKETPLACE_AGENT_DETAILS,
  STORY_MARKETPLACE_AGENTS,
  STORY_MARKETPLACE_PLUGINS,
  STORY_MARKETPLACE_SKILL_DETAILS,
  STORY_MARKETPLACE_SKILLS,
  STORY_MCP_SERVERS,
} from "../src/preview/fixtures";
import { CONNECTED_CONNECTOR_DETAILS, STORY_CONNECTOR_DETAILS, storyConnectorSet } from "./connector-fixtures";
import { type ConnectOutcome, connectAs, subjectFor } from "./mcp-connect-stage";

type ConnectFlows = readonly [McpConnectFlow, ...McpConnectFlow[]];

function connectFlows(entry: MarketplacePluginApp): ConnectFlows | null {
  const [first, ...rest] = entry.server.auth ?? [];
  return first ? [first, ...rest] : null;
}

function page<T extends { name: string; description: string; category?: string | undefined }>(
  items: readonly T[],
  query: MarketplaceSkillQuery,
) {
  const text = query.query?.toLowerCase() ?? "";
  return {
    items: items.filter(
      (item) =>
        (!query.category || (item.category ?? "other") === query.category) &&
        (!text || item.name.toLowerCase().includes(text) || item.description.toLowerCase().includes(text)),
    ),
    nextCursor: null,
  };
}

function skillPage(items: readonly MarketplaceSkillSummary[], query: MarketplaceSkillQuery) {
  const found = page(items, query).items.filter(
    (item) =>
      (query.verified === undefined || (item.verified === true) === query.verified) &&
      (query.featured !== true || item.featured),
  );
  const sort = query.sort ?? "installs";
  found.sort((left, right) => {
    if (sort === "name") return left.name.localeCompare(right.name);
    if (sort === "updated") return right.updatedAt.localeCompare(left.updatedAt);
    return right.installs - left.installs;
  });
  const start = Number(query.cursor ?? 0);
  const end = start + (query.limit ?? 50);
  return { items: found.slice(start, end), nextCursor: end < found.length ? String(end) : null };
}

const SKILL_WORDS: readonly (readonly [SkillCategory, readonly string[], readonly string[]])[] = [
  [
    "coding",
    ["Review", "Test", "Lint", "Document", "Profile", "Refactor"],
    ["pull requests", "SQL queries", "React components", "Go services", "shell scripts"],
  ],
  ["documents", ["Summarize", "Translate", "Proofread"], ["contracts", "meeting notes", "reports", "proposals"]],
  ["design", ["Audit", "Critique"], ["color palettes", "landing pages", "forms"]],
];

const MORE_SKILLS: readonly MarketplaceSkillSummary[] = SKILL_WORDS.flatMap(([category, verbs, things]) =>
  verbs.flatMap((verb) => things.map((thing) => ({ category, name: `${verb} ${thing}` }))),
).map(({ category, name }, index): MarketplaceSkillSummary => {
  const slug = name.toLowerCase().replaceAll(" ", "-");
  return {
    id: `skill-${slug}`,
    slug,
    name,
    description: `${name.replace(/^\S+/, (verb) => `${verb}s`)} and reports what it found, one line for each.`,
    category,
    creatorName: index % 3 === 0 ? "OpenBot" : "Priya Raman",
    version: 1 + (index % 4),
    installs: 900 - index * 17,
    featured: index % 9 === 0,
    verified: index % 3 === 0,
    iconUrl: null,
    updatedAt: `2026-08-${String(1 + (index % 28)).padStart(2, "0")}T09:00:00.000Z`,
  };
});

const CATALOG: readonly MarketplaceSkillSummary[] = [...STORY_MARKETPLACE_SKILLS, ...MORE_SKILLS];

const MORE_AGENTS = [
  "Support Triage|Support lead",
  "Billing|Billing assistant",
  "Recruiting|Recruiter",
  "Onboarding|Onboarding guide",
  "Legal Review|Contract reviewer",
  "Finance Close|Month-end accountant",
  "Data Pipeline|Data engineer",
  "QA|Test engineer",
  "Release Manager|Release coordinator",
  "Docs Writer|Technical writer",
  "Design Review|Design critic",
  "Security Audit|Security reviewer",
  "Social Media|Social media manager",
  "Newsletter|Newsletter editor",
  "SEO|Search specialist",
  "Customer Success|Account manager",
  "Partnerships|Partner manager",
  "Procurement|Buyer",
  "Payroll|Payroll assistant",
  "IT Helpdesk|IT support",
  "Infra On-call|Site reliability engineer",
  "Mobile QA|Mobile tester",
  "Web QA|Web tester",
  "Growth Analytics|Growth analyst",
  "Pricing|Pricing analyst",
  "Investor Updates|Investor relations",
  "Board Prep|Chief of staff deputy",
  "Hiring Pipeline|Hiring coordinator",
  "Interview Notes|Interview scribe",
  "Translation DE|German translator",
  "Translation JA|Japanese translator",
  "Translation ES|Spanish translator",
  "Community|Community manager",
  "Discord Moderator|Moderator",
  "Events|Event planner",
  "Travel|Travel planner",
  "Inbox Zero|Inbox assistant",
  "Calendar|Scheduler",
  "Meeting Notes|Note taker",
  "Competitor Watch|Market watcher",
  "Market Research|Market researcher",
  "Grant Writing|Grant writer",
  "Contracts|Contract manager",
  "Compliance|Compliance officer",
  "Vendor Review|Vendor analyst",
  "Incident Review|Postmortem writer",
  "Code Review|Reviewer",
];

const STORY_ROLES = [
  { id: "role-engineering", name: "Engineering" },
  { id: "role-support", name: "Support" },
];

export const MANY_AGENTS: readonly ClientAgentSummary[] = [
  ...STORY_AGENT_SUMMARIES,
  ...MORE_AGENTS.flatMap((entry, index): ClientAgentSummary[] => {
    const [name = "", title = ""] = entry.split("|");
    const base = STORY_AGENT_SUMMARIES[index % STORY_AGENT_SUMMARIES.length];
    const id = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
    if (!base) return [];
    return [
      {
        ...base,
        id,
        name,
        title,
        threadId: `thread-${id}`,
        avatarSeed: id,
        avatarHue: AVATAR_HUES[index % AVATAR_HUES.length] ?? null,
      },
    ];
  }),
];

export const LOCAL_SKILL: InstalledSkill = {
  skillId: "local-weekly-report",
  slug: "weekly-report",
  name: "Weekly report",
  installedVersion: 1,
  availableVersion: 1,
  state: "installed",
  enabled: true,
  origin: "local",
  description: "Writes the Friday report from this week's closed tasks.",
};

function installed(skill: MarketplaceSkillSummary, change: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    skillId: skill.id,
    slug: skill.slug,
    name: skill.name,
    installedVersion: skill.version,
    availableVersion: skill.version,
    state: "installed",
    enabled: true,
    origin: "marketplace",
    description: skill.description,
    ...change,
  };
}

function startSkills(agents: readonly ClientAgentSummary[]): Record<string, InstalledSkill[]> {
  const [releaseNotes, sqlReview, designAudit] = STORY_MARKETPLACE_SKILLS;
  if (!releaseNotes || !sqlReview || !designAudit) return {};
  const skills: Record<string, InstalledSkill[]> = {
    chief: [
      installed(releaseNotes, { installedVersion: releaseNotes.version - 1, state: "update-available" }),
      installed(sqlReview),
      LOCAL_SKILL,
    ],
    research: [installed(releaseNotes), installed(designAudit, { enabled: false })],
  };
  for (const agent of agents.slice(3, 13)) skills[agent.id] = [installed(releaseNotes)];
  const third = agents[2];
  if (third) skills[third.id] = [installed(sqlReview, { state: "modified" })];
  return skills;
}

type HeldState = "connected" | "signInNeeded";

const STORY_SIGN_IN_CALLBACK = "http://127.0.0.1:47823/mcp/callback";

export interface StoryProps {
  member?: boolean;
  blocked?: MarketplaceAppsBlock;
  empty?: boolean;
  outcome?: ConnectOutcome;
  start?: (nav: MarketplaceNavigation) => void;
  held?: Readonly<Record<string, HeldState>>;
  accounts?: Readonly<Record<string, readonly MarketplaceAppAccount[]>>;
  connected?: boolean;
  macOS?: boolean;
  catalog?: readonly string[];
  manyAgents?: boolean;
  noSkills?: boolean;
  signInAppNeeded?: boolean;
  dialogSkill?: string;
  agentStates?: Readonly<Record<string, "added" | "update">>;
  xAgent?: boolean;
  children?: (context: { model: MarketplaceModel; nav: MarketplaceNavigation }) => JSX.Element;
}

const X_LISTING: MarketplaceAgentDetail = {
  id: X_AGENT_LISTING_ID,
  category: "research",
  name: "X",
  title: "Does what you ask in an X reply that mentions @openbot_",
  description: "Does what you ask in an X reply that mentions @openbot_.",
  creatorName: "OpenBot",
  version: 1,
  installs: 412,
  featured: false,
  verified: true,
  avatarSeed: "x-desk",
  avatarHue: 280,
  avatarUrl: null,
  skillCount: 1,
  routineCount: 0,
  activeRoutineCount: 0,
  updatedAt: "2026-11-20T09:00:00.000Z",
  versionId: "x-desk-v1",
  skills: [],
  routines: [],
};

const X_AGENT: MarketplaceAgent = {
  id: "agent-x",
  name: X_LISTING.name,
  title: X_LISTING.title,
  avatarSeed: X_LISTING.avatarSeed,
  avatarHue: X_LISTING.avatarHue,
  avatarUrl: null,
};

function storyXApp(agent: MarketplaceAgent | null): MarketplaceApp {
  const { t } = currentText();
  return {
    kind: "x",
    id: X_APP_ID,
    name: t("marketplace.xApp.title"),
    tagline: t("marketplace.xApp.tagline"),
    category: "productivity",
    status: agent ? "connected" : "idle",
    agent,
    extensionUrl: "https://chromewebstore.google.com/detail/openbot/eggdpikcggoicfcfdpdihfkinajchpfj",
  };
}

const APPLE_APPS = MARKETPLACE_PLUGINS.filter((plugin) => plugin.slug === "apple-apps");

const FIRST_HELD: Readonly<Record<string, HeldState>> = { [STORY_MARKETPLACE_PLUGINS[0]?.slug ?? ""]: "connected" };

function storyConnection(
  name: string,
  held: HeldState | undefined,
  accounts: readonly MarketplaceAppAccount[] | undefined,
): MarketplaceAppConnection {
  if (accounts && accounts.length > 0)
    return {
      held: true,
      signInNeeded: accounts.some((account) => account.signInNeeded),
      accounts: [...accounts],
      multipleAccounts: true,
    };
  const signInNeeded = held === "signInNeeded";
  return {
    held: Boolean(held),
    signInNeeded,
    accounts: held ? [{ id: `${name}-row`, name, signInNeeded, signedIn: true, renamable: false }] : [],
    multipleAccounts: false,
  };
}

function pluginStatus(held: HeldState | undefined): MarketplaceApp["status"] {
  if (held === "signInNeeded") return "attention";
  return held ? "connected" : "idle";
}

export function MarketplaceStory(props: StoryProps) {
  const {
    member,
    blocked,
    empty,
    start,
    held = FIRST_HELD,
    accounts,
    connected,
    macOS,
    catalog = [],
    manyAgents,
    noSkills,
    signInAppNeeded,
    dialogSkill,
    agentStates,
    xAgent,
    children,
  } = untrack(() => ({ ...props }));
  const details = connected ? CONNECTED_CONNECTOR_DETAILS : STORY_CONNECTOR_DETAILS;
  const agents = empty ? [] : STORY_MARKETPLACE_AGENTS;
  const skills = empty ? [] : CATALOG;
  const userAgents = manyAgents ? MANY_AGENTS : STORY_AGENT_SUMMARIES;
  const connectors = storyConnectorSet(details);
  const connectorApps = untrack(() =>
    details.map(({ id }): MarketplaceApp => {
      const listing = CONNECTOR_LISTINGS[id];
      return {
        kind: "connector",
        id,
        connector: id,
        name: currentText().t(listing.title),
        tagline: currentText().t(listing.tagline),
        status: connected || id === "github" ? "connected" : "idle",
        category: listing.category,
      };
    }),
  );
  const [state, setState] = createStore<{
    added: Record<string, "added" | "update">;
    installed: Record<string, InstalledSkill[]>;
    apps: MarketplaceApp[];
    busy: Record<string, true>;
    notice: string;
  }>({
    added: { ...(agentStates ?? { [STORY_MARKETPLACE_AGENTS[1]?.id ?? ""]: "added" }) },
    installed: noSkills ? {} : startSkills(userAgents),
    apps: [
      ...connectorApps,
      storyXApp(xAgent ? X_AGENT : null),
      ...[
        ...STORY_MARKETPLACE_PLUGINS,
        ...(macOS ? APPLE_APPS : []),
        ...MARKETPLACE_PLUGINS.filter((plugin) => catalog.includes(plugin.slug)),
      ].map((plugin): MarketplaceApp => {
        const listed = accounts?.[plugin.slug];
        const state = held[plugin.slug] ?? (listed ? "connected" : undefined);
        return {
          kind: "plugin",
          id: plugin.slug,
          name: plugin.name,
          tagline: plugin.tagline,
          status: listed?.some((account) => account.signInNeeded) ? "attention" : pluginStatus(state),
          category: plugin.category,
          plugin,
          connections: Object.fromEntries(
            plugin.apps.map((entry) => [entry.id, storyConnection(entry.server.name, state, listed)]),
          ),
        };
      }),
      ...STORY_MCP_SERVERS.slice(signInAppNeeded ? 1 : 0, signInAppNeeded ? 2 : 1).map(
        (server): MarketplaceApp => ({
          kind: "custom",
          id: `custom:${server.id}`,
          name: server.name,
          tagline: server.transport === "stdio" ? server.command : server.url,
          status: "connected",
          server,
        }),
      ),
    ],
    busy: {},
    notice: "",
  });
  const [error, setError] = createSignal<string | null>(null);
  const [access, setAccess] = createSignal<Record<string, McpServerAccess>>({});
  const [open, setOpen] = createSignal(true);
  const [askOnInstall, setAskOnInstall] = createSignal(true);
  const [pending, setPending] = createSignal<{
    subject: McpConnectSubject;
    flows: ConnectFlows;
    settle: (config: McpServerConfig | null) => void;
  } | null>(null);
  const connectStep = (subject: McpConnectSubject, flows: ConnectFlows) =>
    new Promise<McpServerConfig | null>((resolve) =>
      setPending({
        subject,
        flows,
        settle: (config) => {
          setPending(null);
          resolve(config);
        },
      }),
    );
  const server = (name: string) => connectAs(props.outcome ?? "connects", name);
  const signIn = (name: string) => async (config: McpServerConfig) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return server(name)(config);
  };
  const setHeld = (id: string, appIds: readonly string[], on: boolean) =>
    setState((draft) => {
      const app = draft.apps.find((entry) => entry.id === id);
      if (app?.kind !== "plugin") return;
      for (const appId of appIds) {
        const entry = app.plugin.apps.find((one) => one.id === appId);
        const current = app.connections[appId];
        const listed = on ? current?.accounts.map((account) => ({ ...account, signInNeeded: false })) : undefined;
        const kept = current?.multipleAccounts ? listed : undefined;
        app.connections = {
          ...app.connections,
          [appId]: storyConnection(entry?.server.name ?? appId, on ? "connected" : undefined, kept),
        };
      }
      settleStatus(app);
    });
  const settleStatus = (app: Extract<MarketplaceApp, { kind: "plugin" }>) => {
    const connections = Object.values(app.connections);
    if (connections.some((connection) => connection.signInNeeded)) app.status = "attention";
    else app.status = connections.some((connection) => connection.held) ? "connected" : "idle";
  };
  const changeAccounts = (
    id: string,
    match: (appId: string, connection: MarketplaceAppConnection) => boolean,
    change: (accounts: MarketplaceAppAccount[]) => MarketplaceAppAccount[],
  ) =>
    setState((draft) => {
      const app = draft.apps.find((entry) => entry.id === id);
      if (app?.kind !== "plugin") return;
      for (const [appId, connection] of Object.entries(app.connections)) {
        if (!match(appId, connection)) continue;
        const accounts = change([...connection.accounts]);
        app.connections = {
          ...app.connections,
          [appId]: { ...connection, accounts, signInNeeded: accounts.some((account) => account.signInNeeded) },
        };
      }
      settleStatus(app);
    });
  const holds = (accountId: string) => (_appId: string, connection: MarketplaceAppConnection) =>
    connection.accounts.some((account) => account.id === accountId);

  const setBusy = (id: string, on: boolean) => {
    setState((draft) => {
      if (on) draft.busy[id] = true;
      else delete draft.busy[id];
    });
  };

  const skillFor = (skillId: string): InstalledSkill | undefined => {
    const listing = CATALOG.find((entry) => entry.id === skillId);
    if (listing) return installed(listing);
    const copy = Object.values(state.installed)
      .flat()
      .find((entry) => entry.skillId === skillId);
    return copy && { ...copy, enabled: true };
  };
  const changeSkill = (skillId: string, change: { add: readonly string[]; remove: readonly string[] }) => {
    const skill = skillFor(skillId);
    setState((draft) => {
      for (const agentId of change.remove)
        draft.installed[agentId] = (draft.installed[agentId] ?? []).filter((entry) => entry.skillId !== skillId);
      for (const agentId of change.add)
        if (skill) draft.installed[agentId] = [...(draft.installed[agentId] ?? []), skill];
    });
  };
  const skillDetail = (id: string) => {
    const listing = CATALOG.find((entry) => entry.id === id);
    return (
      listing && {
        ...listing,
        versionId: `${listing.id}-v${listing.version}`,
        bundleSha256: "0".repeat(64),
        files: ["SKILL.md"],
        instructions: `# ${listing.name}\n\n${listing.description}`,
      }
    );
  };
  const dialogListing = CATALOG.find((entry) => entry.id === dialogSkill);
  const [dialogOpen, setDialogOpen] = createSignal(true);

  const [signIns, setSignIns] = createSignal<Record<string, McpSignInState>>({});
  const [savedSignInApp, setSavedSignInApp] = createSignal<McpSignInApp | null>(null);
  const storySignInAppState = () => ({ redirectUrl: STORY_SIGN_IN_CALLBACK, app: savedSignInApp() });
  const storySignInApp: McpPanelSignInApp | undefined = signInAppNeeded
    ? {
        load: async () => storySignInAppState(),
        save: async (input) => {
          setSavedSignInApp({
            clientId: input.clientId,
            secretSaved:
              input.clientSecret === null ? (savedSignInApp()?.secretSaved ?? false) : input.clientSecret !== "",
            scope: input.scope,
          });
          return storySignInAppState();
        },
        remove: async () => {
          setSavedSignInApp(null);
          return storySignInAppState();
        },
      }
    : undefined;
  const customServers = () => state.apps.flatMap((app) => (app.kind === "custom" ? [app.server] : []));
  const putServer = (server: McpServerConfig) =>
    setState((draft) => {
      const app: MarketplaceApp = {
        kind: "custom",
        id: `custom:${server.id}`,
        name: server.name,
        tagline: server.transport === "stdio" ? server.command : server.url,
        status: "connected",
        server,
      };
      const index = draft.apps.findIndex((entry) => entry.id === app.id);
      if (index === -1) draft.apps.push(app);
      else draft.apps[index] = app;
    });
  const serverTools: McpServerTools = {
    servers: customServers,
    signIns,
    save: async (config) => {
      const saved = { ...config, id: config.id || `story-${config.name.toLocaleLowerCase().replace(/\W+/g, "-")}` };
      putServer(saved);
      return saved;
    },
    test: async () => ({
      toolCount: 3,
      error: signInAppNeeded ? sourceText("error.backend.mcpSignInAppNeeded") : null,
    }),
    setEnabled: async (id, enabled) => {
      const server = customServers().find((candidate) => candidate.id === id);
      if (server) putServer({ ...server, enabled });
    },
    toolRuntimeNote: () => null,
    signIn: () => ({
      start: async (config) => {
        setSignIns((held) => ({ ...held, [config.id]: { mcpServerId: config.id, signedIn: true } }));
        return { toolCount: 3, error: null };
      },
      cancel: async () => {},
      signOut: async (id) => {
        setSignIns((held) => ({ ...held, [id]: { mcpServerId: id, signedIn: false } }));
      },
      app: storySignInApp,
    }),
    signInRequest: () => null,
    endSignInRequest: () => {},
  };
  const model: MarketplaceModel = {
    listAgents: async (query) => page<MarketplaceAgentSummary>(agents, query),
    loadAgent: async (id) => (id === X_AGENT_LISTING_ID ? X_LISTING : STORY_MARKETPLACE_AGENT_DETAILS[id]),
    agentState: (listing) => (member ? null : (state.added[listing.id] ?? "add")),
    agentBusy: (id) => Boolean(state.busy[id]),
    addAgent: async (listing) => {
      setState((draft) => {
        if (listing.id === X_AGENT_LISTING_ID)
          draft.apps = draft.apps.map((app) => (app.kind === "x" ? storyXApp(X_AGENT) : app));
        draft.added[listing.id] = "added";
        draft.notice = `${listing.name} added.`;
      });
      return true;
    },
    openChat: () => setOpen(false),

    listSkills: async (query) => skillPage(skills, query),
    loadSkill: async (id) => STORY_MARKETPLACE_SKILL_DETAILS[id] ?? skillDetail(id),
    skillListing: async (id) => skills.find((skill) => skill.id === id),
    agents: () => (member ? [] : userAgents),
    activeAgentId: () => userAgents[0]?.id ?? "",
    readSkills: () => undefined,
    skillRead: () => "loaded",
    installedSkill: (agentId, skillId) => state.installed[agentId]?.find((skill) => skill.skillId === skillId),
    installedSkills: (agentId) => state.installed[agentId] ?? [],
    skillBusy: () => false,
    changeSkill: async (skill, change) => changeSkill(skill.id, change),
    setSkillEnabled: async (agentId, skillId, on) =>
      setState((draft) => {
        const skill = draft.installed[agentId]?.find((entry) => entry.skillId === skillId);
        if (skill) skill.enabled = on;
      }),
    updateSkill: async (skill, agentIds) =>
      setState((draft) => {
        for (const agentId of agentIds) {
          const entry = draft.installed[agentId]?.find((one) => one.skillId === skill.id);
          if (!entry) continue;
          entry.installedVersion = entry.availableVersion;
          entry.state = "installed";
        }
      }),
    createSkill: member ? undefined : fn(),
    trySkill: fn(),

    apps: () => state.apps,
    canConnectApps: () => !member,
    appsBlocked: () => (member ? blocked : undefined),
    appBusy: (id) => Boolean(state.busy[id]),
    connectApp: async (app) => {
      setBusy(app.id, true);
      for (const entry of app.plugin.apps) {
        const flows = connectFlows(entry);
        if (flows && !(await connectStep(subjectFor(entry), flows))) {
          setBusy(app.id, false);
          return false;
        }
      }
      setBusy(app.id, false);
      setHeld(
        app.id,
        app.plugin.apps.map((entry) => entry.id),
        true,
      );
      return true;
    },
    reconnectApp: async (app, appId, accountId) => {
      const entry = app.plugin.apps.find((one) => one.id === appId);
      const flows = entry && connectFlows(entry);
      if (!entry || !flows) return false;
      setBusy(app.id, true);
      const config = await connectStep(subjectFor(entry), flows);
      setBusy(app.id, false);
      const target =
        accountId ?? app.connections[appId]?.accounts.find((account) => account.signInNeeded)?.id ?? undefined;
      if (config && target && app.connections[appId]?.multipleAccounts)
        changeAccounts(app.id, holds(target), (list) =>
          list.map((account) => (account.id === target ? { ...account, signInNeeded: false } : account)),
        );
      else if (config) setHeld(app.id, [appId], true);
      return Boolean(config);
    },
    addAccount: async (app, appId) => {
      const entry = app.plugin.apps.find((one) => one.id === appId);
      const flows = entry && connectFlows(entry);
      if (!entry || !flows) return false;
      setBusy(app.id, true);
      const config = await connectStep(subjectFor(entry), flows);
      setBusy(app.id, false);
      if (!config) return false;
      changeAccounts(
        app.id,
        (id) => id === appId,
        (list) => {
          const taken = new Set(list.map((account) => account.name.toLocaleLowerCase()));
          let count = 2;
          while (taken.has(`${entry.name} ${count}`.toLocaleLowerCase())) count += 1;
          return [
            ...list,
            {
              id: `${appId}-${Date.now()}`,
              name: `${entry.name} ${count}`,
              signInNeeded: false,
              signedIn: true,
              renamable: true,
            },
          ];
        },
      );
      return true;
    },
    renameAccount: async (app, accountId, name) => {
      changeAccounts(app.id, holds(accountId), (list) =>
        list.map((account) => (account.id === accountId ? { ...account, name } : account)),
      );
      return true;
    },
    removeAccount: async (app, accountId) => {
      changeAccounts(app.id, holds(accountId), (list) => list.filter((account) => account.id !== accountId));
      return true;
    },
    disconnectApp: (app) =>
      setHeld(
        app.id,
        app.plugin.apps.map((entry) => entry.id),
        false,
      ),
    removeServer: async (id) => {
      setState((draft) => {
        draft.apps = draft.apps.filter((app) => app.id !== id && !(app.kind === "custom" && app.server.id === id));
      });
      return true;
    },
    mcpAccess: member
      ? undefined
      : {
          entry: (id) => access()[id] ?? DEFAULT_MCP_SERVER_ACCESS,
          roles: () => STORY_ROLES,
          busy: () => false,
          set: async (changes) => {
            setAccess((held) => ({
              ...held,
              ...Object.fromEntries(changes.map((change) => [change.mcpServerId, change.access])),
            }));
            return true;
          },
        },
    servers: member
      ? undefined
      : {
          form: (form) => <McpServerForm tools={serverTools} id={form.id} onClose={form.onClose} />,
          controls: (controls) => <McpServerControls tools={serverTools} id={controls.id} />,
        },
    runPrompt: fn(),
    copyLink: fn(),
    copyListingLink: fn(),
    openUrl: fn(),
    connector: (id) => connectors[id],
    macAutomation: macOS
      ? {
          askOnInstall,
          setAskOnInstall,
          request: async () => {
            setState((draft) => {
              draft.notice = currentText().t("marketplace.app.automation.allowed");
            });
          },
        }
      : undefined,

    error,
    clearError: () => setError(null),
    notice: () => state.notice,
  };
  const nav = createMarketplaceNavigation();
  onSettled(() => start?.(nav));
  return (
    <>
      <Marketplace model={model} nav={nav} open={open()} onOpenChange={setOpen} />
      <Show when={dialogOpen() && dialogListing}>
        {(skill) => <AgentsDialog model={model} skill={skill()} onClose={() => setDialogOpen(false)} />}
      </Show>
      <Show when={pending()} keyed>
        {(step) => (
          <McpConnectDialog
            subject={step.subject}
            flows={step.flows}
            onTest={server(step.subject.name)}
            onSignIn={signIn(step.subject.name)}
            onConnected={(config) => step.settle(config)}
            onCancel={() => step.settle(null)}
            onOpenUrl={fn()}
          />
        )}
      </Show>
      {children?.({ model, nav })}
    </>
  );
}
