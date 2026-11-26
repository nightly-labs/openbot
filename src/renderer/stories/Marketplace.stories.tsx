import { X_APP_ID } from "@openbot/ui/features/marketplace/marketplace-model";
import type { MarketplaceNavigation } from "@openbot/ui/features/marketplace/marketplace-view";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  STORY_MARKETPLACE_AGENTS,
  STORY_MARKETPLACE_PLUGINS,
  STORY_MARKETPLACE_SKILLS,
  STORY_MCP_SERVERS,
} from "../src/preview/fixtures";
import { LOCAL_SKILL, MarketplaceStory, type StoryProps } from "./marketplace-story-support";
import { CONNECT_OUTCOMES } from "./mcp-connect-stage";

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

export const PluginKey = at(plugin("resend"), { held: { resend: "connected" } });

export const PluginSignInNeeded = at(plugin("notion"), { held: { notion: "signInNeeded" } });

export const PluginAccounts = at(plugin("notion"), {
  accounts: {
    notion: [
      { id: "notion-work", name: "Notion Work", signInNeeded: false, signedIn: true, renamable: true },
      { id: "notion-personal", name: "Notion Personal", signInNeeded: false, signedIn: true, renamable: true },
      { id: "notion-client", name: "Notion Acme", signInNeeded: true, signedIn: true, renamable: true },
    ],
  },
});

export const PluginComposio = at(plugin("composio"), { catalog: ["composio"], held: {} });

export const PluginDesktop = at(plugin("figma"), { held: { figma: "connected" } });

export const PluginAppleApps = at(plugin("apple-apps"), { macOS: true });

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

export const CustomServerSignInApp = at(
  (nav) => {
    nav.go({ kind: "app", id: `custom:${STORY_MCP_SERVERS[1]?.id ?? ""}` });
  },
  { signInAppNeeded: true },
);

export const CustomServerAdd = at((nav) => {
  nav.go({ kind: "server", id: null });
});

export const CustomServerEdit = at((nav) => {
  nav.go({ kind: "server", id: STORY_MCP_SERVERS[0]?.id ?? "" });
});

export const Skills = at(tab("skills"));

export const SkillsFirstUse = at(tab("skills"), { noSkills: true });

export const SkillGroup = at((nav) => {
  tab("skills")(nav);
  nav.go({ kind: "skillGroup", group: "coding" });
});

const firstSkillPage = (nav: MarketplaceNavigation) => {
  const listing = STORY_MARKETPLACE_SKILLS[0];
  tab("skills")(nav);
  if (listing) nav.go({ kind: "skill", listing });
};

export const SkillPage = at(firstSkillPage, { manyAgents: true });

export const LocalSkillPage = at((nav) => {
  tab("skills")(nav);
  nav.go({ kind: "localSkill", skillId: LOCAL_SKILL.skillId });
});

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

export const Member: Story = { args: { member: true } };

export const MemberPluginApp = at(plugin("cloudflare"), {
  catalog: ["cloudflare"],
  member: true,
  held: {},
  blocked: { reason: "member", host: "Studio" },
});

export const PluginAppChecking = at(plugin("cloudflare"), {
  catalog: ["cloudflare"],
  member: true,
  held: {},
  blocked: { reason: "checking" },
});

const connector = (id: string) => at((nav) => nav.go({ kind: "app", id }), { connected: true });

export const XApp = at((nav) => nav.go({ kind: "app", id: X_APP_ID }));

export const XAppSetup = at((nav) => nav.go({ kind: "app", id: X_APP_ID, setup: true }));

export const XAppAdded = at((nav) => nav.go({ kind: "app", id: X_APP_ID }), { xAgent: true });

export const SlackConnected = connector("slack");

export const TelegramConnected = connector("telegram");

export const OnePasswordConnected = connector("onepassword");

export const BitwardenConnected = connector("bitwarden");
