import type { AgentSummary } from "@openbot/contracts/ipc";
import { createSignal, onCleanup } from "solid-js";
import { expect, fn, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button, Heading, Text, Toaster, toast } from "../src/components/ui";
import { SkillsMarketplaceModal } from "../src/features/settings/SkillsMarketplaceModal";
import { STORY_AGENT_SUMMARIES } from "../src/preview/fixtures";
import { createMockOpenBot } from "./mock-openbot";

const storyAgents: Array<Pick<AgentSummary, "id" | "name" | "marketplaceSource">> = STORY_AGENT_SUMMARIES.map(
  (agent) => ({ id: agent.id, name: agent.name }),
);

function SkillsMarketplaceModalStory(props: { initialOpen: boolean }) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot();
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
    await userEvent.click(await body.findByRole("button", { name: "View Release notes details" }));
    await expect(await body.findByRole("region", { name: "Release notes details" })).toBeVisible();
  },
};

export const InstalledSkills: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "Installed" }));
    await expect(await body.findByText("Inbox triage")).toBeVisible();
  },
};

export const MySubmissions: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "My submissions" }));
    await expect(await body.findByText("Standup digest")).toBeVisible();
  },
};

export const AgentMarketplace: Story = {
  render: () => <SkillsMarketplaceModalStory initialOpen />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "Agents" }));
    await expect(await body.findByText("Release Manager")).toBeVisible();
  },
};
