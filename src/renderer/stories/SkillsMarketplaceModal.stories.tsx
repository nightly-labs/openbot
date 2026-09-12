import type { AgentSummary } from "@openbot/contracts/ipc";
import { createSignal, onCleanup, untrack } from "solid-js";
import { expect, fn, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button, Heading, Text, Toaster, toast } from "../src/components/ui";
import { SkillsMarketplaceModal } from "../src/features/settings/SkillsMarketplaceModal";
import { STORY_AGENT_SUMMARIES } from "../src/preview/fixtures";
import { createMockOpenBot } from "./mock-openbot";

const storyAgents: Array<Pick<AgentSummary, "id" | "name" | "marketplaceSource">> = STORY_AGENT_SUMMARIES.map(
  (agent) => ({ id: agent.id, name: agent.name }),
);

function SkillsMarketplaceModalStory(props: {
  initialOpen: boolean;
  detailState?: "fallback" | "long";
  catalogState?: "empty" | "loading" | "loading-transition" | "missing-images" | "four-featured";
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
  } else if (catalogState === "missing-images" || catalogState === "four-featured") {
    const list = mock.api.skills.list;
    mock.api.skills.list = async (query) => {
      const page = await list(catalogState === "four-featured" && query?.featured ? { limit: 4 } : query);
      return {
        ...page,
        skills: page.skills.map((skill) =>
          catalogState === "missing-images"
            ? { ...skill, iconUrl: "/missing-marketplace-icon.png", creatorAvatarUrl: "/missing-creator-photo.png" }
            : skill,
        ),
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

export const SkillDetail: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "Skills" }));
    await userEvent.click(await body.findByRole("button", { name: "View Release notes details" }));
    await expect(await body.findByRole("region", { name: "Release notes details" })).toBeVisible();
  },
};

export const MySubmissions: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "Skills" }));
    await userEvent.click(await body.findByRole("button", { name: "Marketplace menu" }));
    await userEvent.click(await body.findByRole("menuitem", { name: "My submissions" }));
    await expect(await body.findByText("Standup digest")).toBeVisible();
  },
};

export const AgentMarketplace: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "Agents" }));
    await expect(await body.findByRole("button", { name: "View Release Manager details" })).toBeVisible();
  },
};

export const AgentDetail: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "Agents" }));
    await userEvent.click(await body.findByRole("button", { name: "View Release Manager details" }));
    await expect(await body.findByRole("region", { name: "Release Manager details" })).toBeVisible();
  },
};

export const NarrowAgentDetail: Story = {
  ...AgentDetail,
  globals: { viewport: { value: "marketplaceNarrow", isRotated: false } },
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
  play: async ({ userEvent }) => {
    await userEvent.click(await within(document.body).findByRole("button", { name: "Skills" }));
  },
};
export const FourFeatured: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen catalogState="four-featured" />,
  play: async ({ userEvent }) => {
    await userEvent.click(await within(document.body).findByRole("button", { name: "Skills" }));
  },
};

export const FallbackSkillDetail: Story = {
  ...SkillDetail,
  render: () => <SkillsMarketplaceModalStory initialOpen detailState="fallback" />,
};
export const LongSkillDetail: Story = {
  ...SkillDetail,
  render: () => <SkillsMarketplaceModalStory initialOpen detailState="long" />,
};
