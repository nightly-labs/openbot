import type {
  GitHubConnectorStatus,
  InstalledSkill,
  MarketplaceAgentSummary,
  MarketplaceSkillQuery,
  MarketplaceSkillSummary,
} from "@openbot/contracts/ipc";
import { Marketplace } from "@openbot/ui/features/marketplace/Marketplace";
import type { MarketplaceApp, MarketplaceModel } from "@openbot/ui/features/marketplace/marketplace-model";
import {
  createMarketplaceNavigation,
  type MarketplaceNavigation,
} from "@openbot/ui/features/marketplace/marketplace-view";
import { createSignal, createStore, onSettled, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  STORY_AGENT_SUMMARIES,
  STORY_MARKETPLACE_AGENT_DETAILS,
  STORY_MARKETPLACE_AGENTS,
  STORY_MARKETPLACE_PLUGINS,
  STORY_MARKETPLACE_SKILL_DETAILS,
  STORY_MARKETPLACE_SKILLS,
  STORY_MCP_SERVERS,
} from "../src/preview/fixtures";

const GITHUB: GitHubConnectorStatus = {
  available: true,
  state: "connected",
  login: "octocat",
  avatarUrl: null,
  userCode: null,
  verificationUri: null,
  error: null,
};

const REPOSITORIES = {
  repositories: [
    { fullName: "octocat/hello-world", private: false },
    { fullName: "octocat/private-notes", private: true },
  ],
  total: 2,
};

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

function installed(skill: MarketplaceSkillSummary): InstalledSkill {
  return {
    skillId: skill.id,
    slug: skill.slug,
    name: skill.name,
    installedVersion: skill.version,
    availableVersion: skill.version,
    state: "installed",
    enabled: true,
  };
}

interface StoryProps {
  /** A member of a joined server browses and adds nothing. */
  member?: boolean;
  empty?: boolean;
  /** Opens the window on this page, as a link or a click would. */
  start?: (nav: MarketplaceNavigation) => void;
}

/** The real window on fixtures. Each action changes the fixture state, so the states can be tried. */
function MarketplaceStory(props: StoryProps) {
  const { member, empty, start } = untrack(() => ({ ...props }));
  const agents = empty ? [] : STORY_MARKETPLACE_AGENTS;
  const skills = empty ? [] : STORY_MARKETPLACE_SKILLS;
  const firstSkill = STORY_MARKETPLACE_SKILLS[0];
  const [state, setState] = createStore<{
    added: Record<string, true>;
    installed: Record<string, InstalledSkill[]>;
    apps: MarketplaceApp[];
    busy: Record<string, true>;
    notice: string;
  }>({
    added: { [STORY_MARKETPLACE_AGENTS[1]?.id ?? ""]: true },
    installed: { chief: firstSkill ? [installed(firstSkill)] : [] },
    apps: [
      {
        kind: "github",
        id: "github",
        name: "GitHub",
        tagline: "Repositories and pull requests",
        status: "connected",
        category: "coding",
      },
      ...STORY_MARKETPLACE_PLUGINS.map(
        (plugin, index): MarketplaceApp => ({
          kind: "plugin",
          id: plugin.slug,
          name: plugin.name,
          tagline: plugin.tagline,
          status: index === 0 ? "connected" : "idle",
          category: plugin.category,
          plugin,
        }),
      ),
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
  const setApp = (id: string, status: MarketplaceApp["status"]) =>
    setState((draft) => {
      const app = draft.apps.find((entry) => entry.id === id);
      if (app) app.status = status;
    });

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

    listSkills: async (query) => page<MarketplaceSkillSummary>(skills, query),
    loadSkill: async (id) => STORY_MARKETPLACE_SKILL_DETAILS[id],
    agents: () => (member ? [] : STORY_AGENT_SUMMARIES),
    activeAgentId: () => STORY_AGENT_SUMMARIES[0]?.id ?? "",
    readSkills: () => undefined,
    skillRead: () => "loaded",
    installedSkill: (agentId, skillId) => state.installed[agentId]?.find((skill) => skill.skillId === skillId),
    skillBusy: () => false,
    setSkill: async (skill, agentIds, on) =>
      setState((draft) => {
        for (const agentId of agentIds) {
          const list = (draft.installed[agentId] ?? []).filter((entry) => entry.skillId !== skill.id);
          draft.installed[agentId] = on ? [...list, installed(skill)] : list;
        }
      }),
    trySkill: fn(),

    apps: () => state.apps,
    canConnectApps: () => !member,
    appBusy: () => false,
    connectApp: async (app) => {
      setApp(app.id, "connected");
      return true;
    },
    disconnectApp: (app) => setApp(app.id, "idle"),
    removeServer: async (id) => {
      setState((draft) => {
        draft.apps = draft.apps.filter((app) => app.id !== id && !(app.kind === "custom" && app.server.id === id));
      });
      return true;
    },
    runPrompt: fn(),
    copyLink: fn(),
    openUrl: fn(),
    github: () => ({
      status: GITHUB,
      busy: false,
      repositories: REPOSITORIES,
      repositoriesError: null,
      onConnect: fn(),
      onCancel: fn(),
      onDisconnect: fn(),
      onOpenVerification: fn(),
      onOpenInstall: fn(),
    }),

    error,
    clearError: () => setError(null),
    notice: () => state.notice,
  };
  const nav = createMarketplaceNavigation();
  // A write in the component body is refused, so the start page opens once the window is up.
  onSettled(() => start?.(nav));
  return <Marketplace model={model} nav={nav} open={open()} onOpenChange={setOpen} />;
}

const meta = {
  title: "Settings/Marketplace",
  component: MarketplaceStory,
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

const tab = (value: "apps" | "skills") => (nav: MarketplaceNavigation) =>
  nav.set((draft) => {
    draft.tab = value;
  });

/** A story that opens the window on the page `start` goes to. */
const at = (start: (nav: MarketplaceNavigation) => void, props: Omit<StoryProps, "start"> = {}): Story => ({
  render: () => <MarketplaceStory {...props} start={start} />,
});

export const Agents: Story = {};

export const Narrow: Story = { parameters: { viewport: { defaultViewport: "marketplaceNarrow" } } };

export const Apps = at(tab("apps"));

export const PluginApp = at((nav) => {
  tab("apps")(nav);
  nav.go({ kind: "app", id: STORY_MARKETPLACE_PLUGINS[0]?.slug ?? "" });
});

export const GitHub = at((nav) => {
  tab("apps")(nav);
  nav.go({ kind: "app", id: "github" });
});

export const CustomServer = at((nav) => {
  tab("apps")(nav);
  nav.go({ kind: "app", id: `custom:${STORY_MCP_SERVERS[0]?.id ?? ""}` });
});

export const Skills = at(tab("skills"));

export const SkillPage = at((nav) => {
  const listing = STORY_MARKETPLACE_SKILLS[0];
  tab("skills")(nav);
  if (listing) nav.go({ kind: "skill", listing });
});

export const AgentPage = at((nav) => {
  const listing = STORY_MARKETPLACE_AGENTS[0];
  if (listing) nav.go({ kind: "agent", listing });
});

export const NoMatch = at((nav) =>
  nav.set((draft) => {
    draft.query = "no listing has this name";
  }),
);

export const EmptyCatalog: Story = { args: { empty: true } };

/** A member of a joined server: no Add, no install menu and no Connect. */
export const Member: Story = { args: { member: true } };
