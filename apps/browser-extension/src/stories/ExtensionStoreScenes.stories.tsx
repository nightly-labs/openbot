import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  StoreArticleChatPanel,
  StoreChannelPanel,
  StoreHomePanel,
  StorePriceWatchPanel,
  StoreTravelPanel,
} from "./store-panels";
import { ArticlePage, BrowserScene, DocsPage, FlightsPage, MailPage, ShopPage } from "./store-scene";

const meta = {
  title: "Extension/Store scenes",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const AgentsBesideYourMail: Story = {
  render: () => (
    <BrowserScene
      url="mail.example.com/inbox"
      tabs={[
        { title: "Inbox (3)", mark: "M", color: "#d93025", active: true },
        { title: "Launch plan", mark: "D", color: "#1a73e8" },
        { title: "Team calendar", mark: "C", color: "#188038" },
      ]}
      page={<MailPage />}
      panel={<StoreHomePanel />}
    />
  ),
};

export const AskAboutThePage: Story = {
  render: () => (
    <BrowserScene
      url="news.example.com/work-ai/support-teams-agents"
      tabs={[
        { title: "Support teams will hand 40%…", mark: "L", color: "#1f2328", active: true },
        { title: "Q1 plan", mark: "D", color: "#1a73e8" },
      ]}
      page={<ArticlePage />}
      panel={<StoreArticleChatPanel />}
    />
  ),
};

export const AgentsUseYourTabs: Story = {
  render: () => (
    <BrowserScene
      url="flights.example.com/ber-lis/2026-12-12"
      tabs={[
        { title: "BER → LIS · Dec 12", mark: "S", color: "#0b57d0", active: true, shared: true },
        { title: "Lisbon hotels", mark: "H", color: "#e8710a", shared: true },
        { title: "Airport transfer", mark: "T", color: "#9334e6", shared: true },
        { title: "Inbox (3)", mark: "M", color: "#d93025" },
      ]}
      page={<FlightsPage />}
      panel={<StoreTravelPanel />}
    />
  ),
};

export const WatchAPrice: Story = {
  render: () => (
    <BrowserScene
      url="shop.example.com/aurora-2-wireless"
      tabs={[
        { title: "Aurora 2 Wireless Headphones", mark: "N", color: "#1f2328", active: true, shared: true },
        { title: "Inbox (3)", mark: "M", color: "#d93025" },
      ]}
      page={<ShopPage />}
      panel={<StorePriceWatchPanel />}
    />
  ),
};

export const TeamInAChannel: Story = {
  render: () => (
    <BrowserScene
      url="docs.example.com/launch-plan"
      tabs={[
        { title: "Launch plan · Thursday", mark: "D", color: "#1a73e8", active: true },
        { title: "Pricing", mark: "P", color: "#188038" },
        { title: "Press note", mark: "N", color: "#e8710a" },
      ]}
      page={<DocsPage />}
      panel={<StoreChannelPanel />}
    />
  ),
};
