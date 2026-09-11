import { onSettled } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import BrowserPreviewSidebar from "../src/features/conversation/BrowserPreviewSidebar";
import browserPreviewUrl from "./assets/browser-takeover-preview.svg";
import { createMockOpenBot } from "./mock-openbot";

const tabs = [
  {
    id: "docs",
    title: "OpenBot documentation",
    url: "https://openbot.run/docs",
    loading: false,
    ownerThreadId: "chief",
    ownerAgentId: "chief",
  },
  {
    id: "settings",
    title: "Workspace settings",
    url: "https://example.com/settings",
    loading: false,
    ownerThreadId: "chief",
    ownerAgentId: "chief",
  },
];

const meta = {
  title: "Conversation/BrowserPreviewSidebar",
  component: BrowserPreviewSidebar,
  args: {
    tabs,
    hidden: false,
    suspended: false,
    contextKey: "local:chief",
    defaultWidth: () => 320,
    maxWidth: () => 640,
    onWidthChange: fn(),
    onOpenTab: fn(),
    onCloseTab: fn(),
    onNewTab: fn(),
    onCollapse: fn(),
  },
  decorators: [
    (Story) => {
      const previous = window.openbot;
      window.openbot = createMockOpenBot({
        browserPreviews: {
          docs: { dataUrl: browserPreviewUrl, width: 960, height: 600 },
          settings: null,
        },
      }).api;
      onSettled(() => () => {
        window.openbot = previous;
      });
      return (
        <div style="--browser-panel-width: 320px">
          <Story />
        </div>
      );
    },
  ],
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof BrowserPreviewSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MultipleCards: Story = {};
export const Loading: Story = { args: { suspended: true } };
export const FailedCapture: Story = { args: { tabs: [tabs[1]] } };
export const Empty: Story = { args: { tabs: [] } };
