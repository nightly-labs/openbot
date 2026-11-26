import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  StoreArticleChatPanel,
  StoreChannelPanel,
  StoreHomePanel,
  StorePriceWatchPanel,
  StoreTravelPanel,
} from "./store-panels";
import { PanelFrame } from "./story-frame";

const meta = {
  title: "Extension/Store screenshots",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Home: Story = {
  render: () => (
    <PanelFrame>
      <StoreHomePanel />
    </PanelFrame>
  ),
};

export const ChatAboutThePage: Story = {
  render: () => (
    <PanelFrame>
      <StoreArticleChatPanel />
    </PanelFrame>
  ),
};

export const AgentUsesYourTabs: Story = {
  render: () => (
    <PanelFrame>
      <StoreTravelPanel />
    </PanelFrame>
  ),
};

export const PriceWatch: Story = {
  render: () => (
    <PanelFrame>
      <StorePriceWatchPanel />
    </PanelFrame>
  ),
};

export const TeamChannel: Story = {
  render: () => (
    <PanelFrame>
      <StoreChannelPanel />
    </PanelFrame>
  ),
};
