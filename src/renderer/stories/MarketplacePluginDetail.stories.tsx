import { MarketplacePluginDetail } from "@openbot/ui/features/settings/MarketplacePluginDetail";
import type { MarketplacePluginDetail as PluginDetail } from "@openbot/ui/features/settings/marketplace-plugins";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_MARKETPLACE_PLUGIN_AAVE as aave, STORY_AGENT_SUMMARIES } from "../src/preview/fixtures";

/** The install target list, as the modal passes it: the agents on this computer. */
const storyAgents = STORY_AGENT_SUMMARIES.map((agent) => ({ id: agent.id, name: agent.name }));

/**
 * The page is a plain component over its data, so the stories pass fixtures rather than a mocked
 * `window.openbot`: there is no plugin endpoint to mock yet.
 */
function PluginDetailStory(props: {
  plugin?: PluginDetail;
  installed?: boolean;
  removable?: boolean;
  busy?: boolean;
  readOnly?: boolean;
  onInstall?: () => void;
  onUninstall?: () => void;
  onCopyLink?: () => void;
  onRunPrompt?: (prompt: { id: string; text: string }) => void;
  /** No agent chosen yet, so the story can show the install button waiting for a target. */
  noAgents?: boolean;
}) {
  const agents = () => (props.noAgents ? [] : storyAgents);
  const [target, setTarget] = createSignal(storyAgents[0]?.id ?? "");
  return (
    /* The feature stylesheet paints the listing inside the marketplace dialog, so the stage carries
       that class and the page is reviewed on the surface it really sits on. */
    <main class="foundation-story skills-marketplace">
      <MarketplacePluginDetail
        plugin={props.plugin ?? aave}
        agents={agents()}
        targetAgentId={props.noAgents ? "" : target()}
        onTargetChange={setTarget}
        installed={props.installed}
        removable={props.removable}
        busy={props.busy}
        onInstall={props.onInstall ?? fn()}
        onUninstall={props.onUninstall ?? fn()}
        onCopyLink={props.onCopyLink ?? fn()}
        onRunPrompt={props.readOnly ? undefined : (props.onRunPrompt ?? fn())}
        onOpenUrl={fn()}
      />
    </main>
  );
}

const meta = {
  title: "Settings/MarketplacePluginDetail",
  component: MarketplacePluginDetail,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        marketplaceDesktop: { name: "Marketplace — 1280 × 880", styles: { width: "1280px", height: "880px" } },
        marketplaceNarrow: { name: "Marketplace — 560 × 880", styles: { width: "560px", height: "880px" } },
      },
    },
  },
  globals: { viewport: { value: "marketplaceDesktop", isRotated: false } },
} satisfies Meta<typeof MarketplacePluginDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <PluginDetailStory />,
};

/** No agent on this computer yet: the target reads "No local agents" and the install waits. */
export const NoAgents: Story = {
  render: () => <PluginDetailStory noAgents />,
};

/** Already on this computer: the one control offers the way back out instead of the install. */
export const Installed: Story = {
  render: () => <PluginDetailStory installed />,
};

/**
 * Half of it is here: one app saved before a later one failed, or one removal that failed. The
 * install can still finish the job, and what is already here can still go.
 */
export const PartlyInstalled: Story = {
  render: () => <PluginDetailStory removable />,
};

export const Installing: Story = {
  render: () => <PluginDetailStory busy />,
};

/** Without somewhere to send an example, the arrows are off and the card is a showcase only. */
export const ReadOnlyPrompts: Story = {
  render: () => <PluginDetailStory readOnly />,
};

/** A plugin with one skill, no examples, no apps and no links: every section must drop cleanly. */
export const Minimal: Story = {
  render: () => (
    <PluginDetailStory
      plugin={{
        ...aave,
        name: "Ledger check",
        tagline: "One skill, nothing else.",
        description: "A plugin that publishes a single skill and no app.",
        iconUrl: null,
        prompts: [],
        apps: [],
        skills: aave.skills.slice(0, 1),
        websiteUrl: null,
        privacyPolicyUrl: null,
        termsUrl: null,
      }}
    />
  ),
};

/** Long copy everywhere, to check wrapping in the examples and truncation in the rows. */
export const LongContent: Story = {
  render: () => (
    <PluginDetailStory
      plugin={{
        ...aave,
        tagline: `${aave.tagline} for lending, borrowing, governance and transaction preparation across every supported chain`,
        description: aave.description.repeat(3),
        prompts: aave.prompts.map((prompt) => ({ ...prompt, text: `${prompt.text} ${prompt.text}` })),
        skills: aave.skills.map((skill) => ({ ...skill, description: skill.description.repeat(2) })),
      }}
    />
  ),
};

export const Narrow: Story = {
  ...Default,
  globals: { viewport: { value: "marketplaceNarrow", isRotated: false } },
};
