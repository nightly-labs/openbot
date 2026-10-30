import {
  AVATAR_HUES,
  type ClientAgentSummary,
  type InstalledSkill,
  type MarketplaceAgentSummary,
  type MarketplaceSkillQuery,
  type MarketplaceSkillSummary,
  type McpServerConfig,
  type SkillCategory,
} from "@openbot/contracts/ipc";
import type { McpConnectFlow } from "@openbot/contracts/mcp-connect-flows";
import { CONNECTOR_LISTINGS } from "@openbot/ui/features/connectors/connector-catalog";
import { Marketplace } from "@openbot/ui/features/marketplace/Marketplace";
import { AgentsDialog } from "@openbot/ui/features/marketplace/MarketplaceAgentsDialog";
import type { MarketplaceApp, MarketplaceModel } from "@openbot/ui/features/marketplace/marketplace-model";
import {
  createMarketplaceNavigation,
  type MarketplaceNavigation,
} from "@openbot/ui/features/marketplace/marketplace-view";
import { McpConnectDialog } from "@openbot/ui/features/settings/McpConnectDialog";
import type { McpConnectSubject } from "@openbot/ui/features/settings/McpConnectShell";
import { currentText } from "@openbot/ui/text";
import { createSignal, createStore, onSettled, Show, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
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
import { CONNECT_OUTCOMES, type ConnectOutcome, connectAs, subjectFor } from "./mcp-connect-stage";

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

/** The skill catalog: filters, sort and pages of `limit`, as the catalog server answers. */
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

/** More catalog skills, so that a group holds more than the 6 rows that the Skills tab shows. */
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

/** The 47 agents after the fixture agents: 50 in all, as a user with a large team has. */
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

const MANY_AGENTS: readonly ClientAgentSummary[] = [
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

/** A skill that the user made on this computer: no catalog listing. */
const LOCAL_SKILL: InstalledSkill = {
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

/** What the agents have: an update, a skill that is off, one that the user changed, and a local skill. */
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
  // With many agents, the first skill is on 12 of them, so its page has a search.
  for (const agent of agents.slice(3, 13)) skills[agent.id] = [installed(releaseNotes)];
  const third = agents[2];
  if (third) skills[third.id] = [installed(sqlReview, { state: "modified" })];
  return skills;
}

/** What the host holds for a plugin's apps: a working row, or a row whose sign-in the server refused. */
type HeldState = "connected" | "signInNeeded";

interface StoryProps {
  /** A member of a joined server browses and adds nothing. */
  member?: boolean;
  empty?: boolean;
  /** What the app's server answers when Connect opens its dialog. */
  outcome?: ConnectOutcome;
  /** Opens the window on this page, as a link or a click would. */
  start?: (nav: MarketplaceNavigation) => void;
  /** The plugins the host holds rows for, by slug. By default, only the first plugin is connected. */
  held?: Readonly<Record<string, HeldState>>;
  /** Every connector app is set up, so its page shows its rows and its Danger zone. */
  connected?: boolean;
  /** The window runs on a Mac, so the Apple apps listing can ask macOS for access. */
  macOS?: boolean;
  /** 50 agents, as a user with a large team has. */
  manyAgents?: boolean;
  /** No agent has a skill yet. */
  noSkills?: boolean;
  /** The agents dialog of this skill is open over the window. */
  dialogSkill?: string;
}

/** The Apple apps listing, which only a Mac asks macOS about. */
const APPLE_APPS = MARKETPLACE_PLUGINS.filter((plugin) => plugin.slug === "apple-apps");

const FIRST_HELD: Readonly<Record<string, HeldState>> = { [STORY_MARKETPLACE_PLUGINS[0]?.slug ?? ""]: "connected" };

function pluginStatus(held: HeldState | undefined): MarketplaceApp["status"] {
  if (held === "signInNeeded") return "attention";
  return held ? "connected" : "idle";
}

/** The real window on fixtures. Each action changes the fixture state, so the states can be tried. */
function MarketplaceStory(props: StoryProps) {
  const {
    member,
    empty,
    start,
    held = FIRST_HELD,
    connected,
    macOS,
    manyAgents,
    noSkills,
    dialogSkill,
  } = untrack(() => ({ ...props }));
  const details = connected ? CONNECTED_CONNECTOR_DETAILS : STORY_CONNECTOR_DETAILS;
  const agents = empty ? [] : STORY_MARKETPLACE_AGENTS;
  const skills = empty ? [] : CATALOG;
  const userAgents = manyAgents ? MANY_AGENTS : STORY_AGENT_SUMMARIES;
  const connectors = storyConnectorSet(details);
  // The story fixes the names once, in the language it opens with.
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
    added: Record<string, true>;
    installed: Record<string, InstalledSkill[]>;
    apps: MarketplaceApp[];
    busy: Record<string, true>;
    notice: string;
  }>({
    added: { [STORY_MARKETPLACE_AGENTS[1]?.id ?? ""]: true },
    installed: noSkills ? {} : startSkills(userAgents),
    apps: [
      ...connectorApps,
      ...[...STORY_MARKETPLACE_PLUGINS, ...(macOS ? APPLE_APPS : [])].map((plugin): MarketplaceApp => {
        const state = held[plugin.slug];
        return {
          kind: "plugin",
          id: plugin.slug,
          name: plugin.name,
          tagline: plugin.tagline,
          status: pluginStatus(state),
          category: plugin.category,
          plugin,
          connections: Object.fromEntries(
            plugin.apps.map((entry) => [entry.id, { held: Boolean(state), signInNeeded: state === "signInNeeded" }]),
          ),
        };
      }),
      ...STORY_MCP_SERVERS.slice(0, 1).map(
        (server): MarketplaceApp => ({
          kind: "custom",
          id: `custom:${server.id}`,
          name: server.name,
          tagline: server.command,
          status: "connected",
          server,
        }),
      ),
    ],
    busy: {},
    notice: "",
  });
  const [error, setError] = createSignal<string | null>(null);
  const [open, setOpen] = createSignal(true);
  const [askOnInstall, setAskOnInstall] = createSignal(true);
  /** The connect dialog on screen, as the Marketplace window opens it for an app's way in. */
  const [pending, setPending] = createSignal<{
    subject: McpConnectSubject;
    flow: McpConnectFlow;
    settle: (config: McpServerConfig | null) => void;
  } | null>(null);
  const connectStep = (subject: McpConnectSubject, flow: McpConnectFlow) =>
    new Promise<McpServerConfig | null>((resolve) =>
      setPending({
        subject,
        flow,
        settle: (config) => {
          setPending(null);
          resolve(config);
        },
      }),
    );
  /** The server the dialog talks to. A sign-in waits a moment, as a browser round trip does. */
  const server = (name: string) => connectAs(props.outcome ?? "connects", name);
  const signIn = (name: string) => async (config: McpServerConfig) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return server(name)(config);
  };
  /** Marks the plugin's apps as held or not, and sets the status that follows from them. */
  const setHeld = (id: string, appIds: readonly string[], on: boolean) =>
    setState((draft) => {
      const app = draft.apps.find((entry) => entry.id === id);
      if (app?.kind !== "plugin") return;
      for (const appId of appIds) app.connections = { ...app.connections, [appId]: { held: on, signInNeeded: false } };
      const connections = Object.values(app.connections);
      if (connections.some((connection) => connection.signInNeeded)) app.status = "attention";
      else app.status = connections.some((connection) => connection.held) ? "connected" : "idle";
    });

  const setBusy = (id: string, on: boolean) => {
    setState((draft) => {
      if (on) draft.busy[id] = true;
      else delete draft.busy[id];
    });
  };

  /** A catalog skill, or a copy of the skill that another agent has: a local skill has no listing. */
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
  /** A generated listing has no details in the fixtures: its page shows its summary and a short SKILL.md. */
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

  const model: MarketplaceModel = {
    listAgents: async (query) => page<MarketplaceAgentSummary>(agents, query),
    loadAgent: async (id) => STORY_MARKETPLACE_AGENT_DETAILS[id],
    agentState: (listing) => (member ? null : state.added[listing.id] ? "added" : "add"),
    agentBusy: (id) => Boolean(state.busy[id]),
    addAgent: async (listing) => {
      setState((draft) => {
        draft.added[listing.id] = true;
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
    appBusy: (id) => Boolean(state.busy[id]),
    connectApp: async (app) => {
      setBusy(app.id, true);
      for (const entry of app.plugin.apps) {
        const flow = (entry.server.auth ?? [])[0];
        // Closing the dialog is a decision, not a failure: the app stays as it was.
        if (flow && !(await connectStep(subjectFor(entry), flow))) {
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
    reconnectApp: async (app, appId) => {
      const entry = app.plugin.apps.find((one) => one.id === appId);
      const flow = entry?.server.auth?.[0];
      if (!entry || !flow) return false;
      setBusy(app.id, true);
      const config = await connectStep(subjectFor(entry), flow);
      setBusy(app.id, false);
      if (config) setHeld(app.id, [appId], true);
      return Boolean(config);
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
    addServer: member ? undefined : fn(),
    runPrompt: fn(),
    copyLink: fn(),
    openUrl: fn(),
    connector: (id) => connectors[id],
    // The preview has no Apple apps, so every app answers as allowed.
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
  // A write in the component body is refused, so the start page opens once the window is up.
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
            flow={step.flow}
            onTest={server(step.subject.name)}
            onSignIn={signIn(step.subject.name)}
            onConnected={(config) => step.settle(config)}
            onCancel={() => step.settle(null)}
            onOpenUrl={fn()}
          />
        )}
      </Show>
    </>
  );
}

const meta = {
  title: "Settings/Marketplace",
  component: MarketplaceStory,
  args: { outcome: "connects" },
  argTypes: { outcome: { control: "select", options: CONNECT_OUTCOMES } },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        marketplaceDesktop: { name: "Marketplace — 1280 × 880", styles: { width: "1280px", height: "880px" } },
        marketplaceNarrow: { name: "Marketplace — 720 × 780", styles: { width: "720px", height: "780px" } },
      },
    },
  },
} satisfies Meta<typeof MarketplaceStory>;

export default meta;
type Story = StoryObj<typeof meta>;

const tab = (value: "agents" | "skills") => (nav: MarketplaceNavigation) =>
  nav.set((draft) => {
    draft.tab = value;
  });

/** A story that opens the window on the page `start` goes to. */
const at = (start: (nav: MarketplaceNavigation) => void, props: Omit<StoryProps, "start"> = {}): Story => ({
  render: (args) => <MarketplaceStory {...props} outcome={args.outcome} start={start} />,
});

export const Apps: Story = {};

export const Narrow: Story = { parameters: { viewport: { defaultViewport: "marketplaceNarrow" } } };

export const Agents = at(tab("agents"));

export const PluginApp = at((nav) => {
  nav.go({ kind: "app", id: STORY_MARKETPLACE_PLUGINS[0]?.slug ?? "" });
});

const plugin = (slug: string) => (nav: MarketplaceNavigation) => nav.go({ kind: "app", id: slug });

/** A key app: the page says which key the host saved, and never shows the key. */
export const PluginKey = at(plugin("resend"), { held: { resend: "connected" } });

/** The server refused the saved sign-in, so the page asks the user to sign in again. */
export const PluginSignInNeeded = at(plugin("notion"), { held: { notion: "signInNeeded" } });

/** A desktop app: the server runs in an app on this computer, at a local address. */
export const PluginDesktop = at(plugin("figma"), { held: { figma: "connected" } });

/** Before the install on a Mac: the switch says whether the install asks macOS for each Apple app. */
export const PluginAppleApps = at(plugin("apple-apps"), { macOS: true });

/** After the install on a Mac: the button asks macOS again. */
export const PluginAppleAppsConnected = at(plugin("apple-apps"), {
  macOS: true,
  held: { "apple-apps": "connected" },
});

export const OnePassword = at((nav) => {
  nav.go({ kind: "app", id: "onepassword" });
});

export const GitHub = at((nav) => {
  nav.go({ kind: "app", id: "github" });
});

export const CustomServer = at((nav) => {
  nav.go({ kind: "app", id: `custom:${STORY_MCP_SERVERS[0]?.id ?? ""}` });
});

/** The Skills tab: "Your skills" on top, then 6 rows of each catalog group. */
export const Skills = at(tab("skills"));

/** No agent has a skill yet: "Your skills" says what a skill is and how to get one. */
export const SkillsFirstUse = at(tab("skills"), { noSkills: true });

/** A group page: three featured skills, then the group in two columns, with a sort and Load more. */
export const SkillGroup = at((nav) => {
  tab("skills")(nav);
  nav.go({ kind: "skillGroup", group: "coding" });
});

const firstSkillPage = (nav: MarketplaceNavigation) => {
  const listing = STORY_MARKETPLACE_SKILLS[0];
  tab("skills")(nav);
  if (listing) nav.go({ kind: "skill", listing });
};

/** A skill on 12 of 50 agents: the agents section has a search, a switch, Update and Remove for each agent. */
export const SkillPage = at(firstSkillPage, { manyAgents: true });

/** A skill made on this computer: no listing, but the same agents section and dialog. */
export const LocalSkillPage = at((nav) => {
  tab("skills")(nav);
  nav.go({ kind: "localSkill", skillId: LOCAL_SKILL.skillId });
});

/** The agents dialog with 50 agents: a search, "All 50 agents", and one row for each agent. */
export const SkillAgentsDialog = at(firstSkillPage, {
  manyAgents: true,
  dialogSkill: STORY_MARKETPLACE_SKILLS[0]?.id ?? "",
});

export const AgentPage = at((nav) => {
  const listing = STORY_MARKETPLACE_AGENTS[0];
  tab("agents")(nav);
  if (listing) nav.go({ kind: "agent", listing });
});

export const NoMatch = at((nav) =>
  nav.set((draft) => {
    draft.query = "no listing has this name";
  }),
);

export const EmptyCatalog = at(tab("agents"), { empty: true });

/** A member of a joined server: no Add, no Add custom, no install menu and no Connect. */
export const Member: Story = { args: { member: true } };

const connector = (id: string) => at((nav) => nav.go({ kind: "app", id }), { connected: true });

/** A chat channel: one connected Slack workspace. */
export const SlackConnected = connector("slack");

/** A chat channel: a group and a direct chat. */
export const TelegramConnected = connector("telegram");

/** A password vault, connected. */
export const OnePasswordConnected = connector("onepassword");

export const BitwardenConnected = connector("bitwarden");
