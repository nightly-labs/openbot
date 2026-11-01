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

/** The user's own Telegram account, connected, with sending off. */
export const TelegramAccountConnected = connector("telegram-account");

/** The user's own WhatsApp account, linked, with sending off. */
export const WhatsAppAccountConnected = connector("whatsapp-account");
