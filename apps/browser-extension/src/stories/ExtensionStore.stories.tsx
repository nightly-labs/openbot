import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  StoreArticleChatPanel,
  StoreChannelPanel,
  StoreHomePanel,
  StorePriceWatchPanel,
  StoreTravelPanel,
} from "./store-panels";
import { PanelFrame } from "./story-frame";

// Full panels with realistic content, for the Chrome Web Store screenshots. Each story fills the
// panel; take the screenshot of the panel frame. "Extension/Store scenes" shows the same panels in
// a browser window.

const meta = {
  title: "Extension/Store screenshots",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** 1. The home: pinned agents and a channel, and every chat with its news. */
export const Home: Story = {
  render: () => (
    <PanelFrame>
      <StoreHomePanel />
    </PanelFrame>
  ),
};

/** 2. Chat beside the page: Chief reads the article in the tab and answers for the user's plan. */
export const ChatAboutThePage: Story = {
  render: () => (
    <PanelFrame>
      <StoreArticleChatPanel />
    </PanelFrame>
  ),
};

/** 3. Agents act in the user's tabs: Travel compared the open tabs, and asks before it acts on a new site. */
export const AgentUsesYourTabs: Story = {
  render: () => (
    <PanelFrame>
      <StoreTravelPanel />
    </PanelFrame>
  ),
};

/** 4. Price Watch watched the product and put it in the cart when the price dropped. */
export const PriceWatch: Story = {
  render: () => (
    <PanelFrame>
      <StorePriceWatchPanel />
    </PanelFrame>
  ),
};

/** 5. A channel: the user and several agents work on one launch; Builder and Research work now. */
export const TeamChannel: Story = {
  render: () => (
    <PanelFrame>
      <StoreChannelPanel />
    </PanelFrame>
  ),
};
