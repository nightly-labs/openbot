import type { AgentSummary } from "@openbot/contracts/ipc";
import { Button, Heading, Text, Toaster, toast } from "@openbot/ui";
import { createSignal, onCleanup, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SkillsMarketplaceModal } from "../src/features/settings/SkillsMarketplaceModal";
import { STORY_AGENT_SUMMARIES, STORY_MARKETPLACE_PLUGINS } from "../src/preview/fixtures";
import { createMockOpenBot } from "./mock-openbot";

const storyAgents: Array<Pick<AgentSummary, "id" | "name" | "marketplaceSource">> = STORY_AGENT_SUMMARIES.map(
  (agent) => ({ id: agent.id, name: agent.name }),
);

function SkillsMarketplaceModalStory(props: {
  initialOpen: boolean;
  plugins?: boolean;
  detailState?: "fallback" | "long";
  catalogState?: "empty" | "loading" | "loading-transition" | "missing-images";
}) {
  const catalogState = untrack(() => props.catalogState);
  const previousApi = window.openbot;
  const mock = createMockOpenBot();
  if (catalogState === "empty") {
    mock.api.skills.list = async () => ({ skills: [], nextCursor: null });
    mock.api.marketplaceAgents.list = async () => ({ agents: [], nextCursor: null });
  } else if (catalogState === "loading") {
    mock.api.skills.list = () => new Promise(() => undefined);
    mock.api.marketplaceAgents.list = () => new Promise(() => undefined);
  } else if (catalogState === "loading-transition") {
    const skillsList = mock.api.skills.list;
    const agentsList = mock.api.marketplaceAgents.list;
    const skillDetail = mock.api.skills.get;
    // Simulated network latency makes the loading-to-content transition reviewable.
    const responseDelay = () => new Promise<void>((resolve) => setTimeout(resolve, 800));
    mock.api.skills.list = async (query) => {
      await responseDelay();
      return skillsList(query);
    };
    mock.api.marketplaceAgents.list = async (query) => {
      await responseDelay();
      return agentsList(query);
    };
    mock.api.skills.get = async (id) => {
      await responseDelay();
      return skillDetail(id);
    };
  } else if (catalogState === "missing-images") {
    const list = mock.api.skills.list;
    mock.api.skills.list = async (query) => {
      const page = await list(query);
      return {
        ...page,
        skills: page.skills.map((skill) => ({
          ...skill,
          iconUrl: "/missing-marketplace-icon.png",
          creatorAvatarUrl: "/missing-creator-photo.png",
        })),
      };
    };
  }
  const getDetail = mock.api.skills.get;
  mock.api.skills.get = async (id) => {
    const detail = await getDetail(id);
    if (props.detailState === "fallback") return { ...detail, examplePrompt: undefined };
    if (props.detailState === "long")
      return {
        ...detail,
        examplePrompt: "Review the latest commits and explain the impact of each change. ".repeat(10),
        instructions: `## What it does\n\n${"- Check the commits and linked issues.\n".repeat(20)}`,
      };
    return detail;
  };
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    toast.dismiss();
    window.openbot = previousApi;
  });
  const [open, setOpen] = createSignal(props.initialOpen);

  return (
    <>
      <main class="foundation-story foundation-interaction-stage">
        <Heading as="h1" size="lg">
          Marketplace
        </Heading>
        <Text tone="secondary">Browse skills and agents, install them, and track your own submissions.</Text>
        <Button variant="outline" type="button" onClick={() => setOpen(true)}>
          Open marketplace
        </Button>
        <SkillsMarketplaceModal
          open={open()}
          onOpenChange={setOpen}
          agents={storyAgents}
          activeAgentId={storyAgents[0]?.id ?? ""}
          plugins={props.plugins ? STORY_MARKETPLACE_PLUGINS : undefined}
          onTrySkill={fn()}
          onAgentInstalled={fn()}
        />
      </main>
      <Toaster />
    </>
  );
}

const meta = {
  title: "Settings/SkillsMarketplaceModal",
  component: SkillsMarketplaceModal,
  args: {
    open: false,
    onOpenChange: fn(),
    agents: storyAgents,
    activeAgentId: storyAgents[0]?.id ?? "",
  },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        marketplaceDesktop: {
          name: "Marketplace — 1280 × 880",
          styles: { width: "1280px", height: "880px" },
        },
        marketplaceNarrow: {
          name: "Marketplace — 720 × 780",
          styles: { width: "720px", height: "780px" },
        },
      },
    },
  },
} satisfies Meta<typeof SkillsMarketplaceModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Discover: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen />,
};

export const Narrow: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen />,
  parameters: { viewport: { defaultViewport: "marketplaceNarrow" } },
};

export const EmptyCatalog: Story = { render: () => <SkillsMarketplaceModalStory initialOpen catalogState="empty" /> };
export const LoadingCatalog: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen catalogState="loading" />,
};
export const LoadingTransition: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen catalogState="loading-transition" />,
};
export const MissingImages: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen catalogState="missing-images" />,
};

/** The plugin listing under design, on the surface it will really sit on. */
export const PluginCatalog: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen plugins />,
};

export const FallbackSkillDetail: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen detailState="fallback" />,
};
export const LongSkillDetail: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen detailState="long" />,
};
