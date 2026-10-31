import type { MarketplaceAgentSummary } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/solid-router";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { MarketplaceAgentListing, MarketplaceSkillView } from "../../lib/marketplace";
// The site's stylesheet, loaded only when a site story opens. See `ArticleMedia.stories.tsx`.
import "../../styles.css";
import { MarketplaceIndexPage, type MarketplaceIndexPageProps } from "./MarketplaceIndexPage";
import { MarketplaceAgentPage, MarketplaceSkillPage } from "./MarketplaceListingPage";
import { MarketplaceMissingPage } from "./MarketplaceMissingPage";
import { marketplaceMissingText } from "./marketplace-page-text";
import {
  isVerifiedAgent,
  PROTOTYPE_AGENT_DETAILS,
  PROTOTYPE_AGENTS,
  PROTOTYPE_PENDING_AGENT,
  PROTOTYPE_SKILLS,
} from "./marketplace-prototype-fixtures";

/*
 * The real route tree carries Worker-only modules, so each story opens a small stand-in tree at the
 * page's address. The tab and category links then show which one is current. The routers are built at
 * module level: creating a router writes reactive state, which Solid refuses inside a component.
 */
const STUB_PATHS = [
  "/",
  "/news",
  "/guides",
  "/compare",
  "/download",
  "/teams",
  "/pricing",
  "/plugins/$slug",
  "/marketplace",
  "/marketplace/skills",
  "/marketplace/apps",
  "/marketplace/agents/$agentId",
  "/marketplace/skills/$slug",
] as const;

function stubRouter(address: string) {
  const rootRoute = createRootRoute();
  rootRoute.addChildren(STUB_PATHS.map((path) => createRoute({ getParentRoute: () => rootRoute, path })));
  return createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: [address] }) });
}

const ROUTERS = {
  agents: stubRouter("/marketplace"),
  coding: stubRouter("/marketplace?category=coding"),
  skills: stubRouter("/marketplace/skills"),
  apps: stubRouter("/marketplace/apps"),
  listing: stubRouter("/marketplace/agents/00000000-0000-4000-8000-000000000001"),
};
type Address = keyof typeof ROUTERS;

function AtAddress(props: { address: Address; children: () => JSX.Element }) {
  return <RouterContextProvider router={ROUTERS[props.address]}>{props.children}</RouterContextProvider>;
}

/** The catalog as the Worker sends it: reviewed agents only, each with its own `verified` flag. */
const AGENTS: MarketplaceAgentSummary[] = PROTOTYPE_AGENTS.map((agent) => ({
  ...agent,
  verified: isVerifiedAgent(agent),
}));

function agentListing(id: string): MarketplaceAgentListing {
  const detail = PROTOTYPE_AGENT_DETAILS[id];
  if (!detail) throw new Error(`No prototype agent ${id}.`);
  const skillIds = new Set(detail.skills.map((skill) => skill.skillId));
  return {
    agent: {
      ...detail,
      verified: isVerifiedAgent(detail),
      pending: detail.id === PROTOTYPE_PENDING_AGENT.id,
      cardUrl: null,
      // The listing page never receives a routine's instruction.
      routines: detail.routines.map(({ instruction: _instruction, ...routine }) => routine),
    },
    skills: PROTOTYPE_SKILLS.filter((skill) => skillIds.has(skill.id)),
  };
}

function skillView(slug: string): MarketplaceSkillView {
  const skill = PROTOTYPE_SKILLS.find((item) => item.slug === slug);
  if (!skill) throw new Error(`No prototype skill ${slug}.`);
  return { ...skill, cardUrl: null };
}

const VERIFIED_AGENT = "00000000-0000-4000-8000-000000000001";
const PUBLIC_AGENT = "00000000-0000-4000-8000-000000000011";

const MISSING = { lang: "en", text: marketplaceMissingText(translateFor("en")) };

function ignoreQuery(_query: string) {}

type StoryPage =
  | ({ page: "index"; address: Address } & Pick<MarketplaceIndexPageProps, "tab" | "query" | "category">)
  | { page: "agent"; id: string }
  | { page: "skill"; slug: string }
  | { page: "missing" };

function IndexStory(props: Extract<StoryPage, { page: "index" }>) {
  const agents = () => (props.tab === "agents" ? AGENTS : []);
  const skills = () => (props.tab === "skills" ? PROTOTYPE_SKILLS : []);
  return (
    <AtAddress address={props.address}>
      {() => (
        <MarketplaceIndexPage
          tab={props.tab}
          lang="en"
          locale="en"
          agents={agents()}
          skills={skills()}
          query={props.query}
          category={props.category}
          onQuery={ignoreQuery}
        />
      )}
    </AtAddress>
  );
}

function MarketplaceStory(props: StoryPage): JSX.Element {
  switch (props.page) {
    case "index":
      return <IndexStory {...props} />;
    case "agent":
      return (
        <AtAddress address="listing">
          {() => <MarketplaceAgentPage lang="en" locale="en" listing={agentListing(props.id)} />}
        </AtAddress>
      );
    case "skill":
      return (
        <AtAddress address="listing">
          {() => <MarketplaceSkillPage lang="en" locale="en" skill={skillView(props.slug)} />}
        </AtAddress>
      );
    case "missing":
      return <AtAddress address="listing">{() => <MarketplaceMissingPage data={MISSING} />}</AtAddress>;
  }
}

const meta = {
  title: "Site/Marketplace",
  component: MarketplaceStory,
  args: { page: "index", address: "agents", tab: "agents", query: undefined, category: undefined },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        sitePhone: { name: "Phone — 390 × 844", styles: { width: "390px", height: "844px" } },
      },
    },
  },
} satisfies Meta<typeof MarketplaceStory>;

export default meta;
type Story = StoryObj<typeof meta>;

const PHONE = { viewport: "sitePhone" } as const;

/** `openbot.run/marketplace`: Featured, then each category as rows. */
export const Agents: Story = {};
export const AgentsPhone: Story = { globals: PHONE };

/** `openbot.run/marketplace?category=coding`: one category, every agent in it. */
export const AgentsCategory: Story = { args: { address: "coding", category: "coding" } };

/** A search with no result. */
export const AgentsNoMatch: Story = { args: { query: "kubernetes" } };

/** `openbot.run/marketplace/skills`. */
export const Skills: Story = { args: { address: "skills", tab: "skills" } };
export const SkillsPhone: Story = { args: { address: "skills", tab: "skills" }, globals: PHONE };

/** `openbot.run/marketplace/apps`: the plugins that `/plugins` showed. */
export const Apps: Story = { args: { address: "apps", tab: "apps" } };

/** A verified agent. "Add to OpenBot" opens the app; "Copy link" copies this page's address. */
export const AgentVerified: Story = { args: { page: "agent", id: VERIFIED_AGENT } };
export const AgentVerifiedPhone: Story = { args: { page: "agent", id: VERIFIED_AGENT }, globals: PHONE };

/** An agent by another user: the line before Add says that OpenBot reviewed it before it went live. */
export const AgentPublic: Story = { args: { page: "agent", id: PUBLIC_AGENT } };
export const AgentPublicPhone: Story = { args: { page: "agent", id: PUBLIC_AGENT }, globals: PHONE };

/** An agent that waits for review, opened from the link its creator shared. No list shows it. */
export const AgentPending: Story = { args: { page: "agent", id: PROTOTYPE_PENDING_AGENT.id } };
export const AgentPendingPhone: Story = { args: { page: "agent", id: PROTOTYPE_PENDING_AGENT.id }, globals: PHONE };

/** A skill. */
export const Skill: Story = { args: { page: "skill", slug: "sql-review" } };
export const SkillPhone: Story = { args: { page: "skill", slug: "sql-review" }, globals: PHONE };

/** A removed or rejected listing, or a wrong link. */
export const Missing: Story = { args: { page: "missing" } };
