import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { onSettled } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { MockOpenBotOptions } from "../src/preview/mock-openbot";
import { AGENT_ID, TABS_KEY, THREAD_OPTIONS, THREAD_QUEUE_OPTIONS, UNREAD_OPTIONS } from "./agent-threads-fixtures";
import { createAppDom, openChat, PrototypeApp } from "./prototype-support";
import "./agent-threads-story.css";

function AgentThreadsApp(props: { open: string[]; active: string | null; options?: MockOpenBotOptions }) {
  const options = props.options ?? THREAD_OPTIONS;
  localStorage.setItem(
    TABS_KEY,
    JSON.stringify({ [LOCAL_SERVER_ID]: { [AGENT_ID]: { open: props.open, active: props.active } } }),
  );
  const app = createAppDom();
  onSettled(() => {
    const root = app.dom.root;
    if (!root) return;
    const observer = new MutationObserver(() => {
      if (openChat(root, AGENT_ID)) observer.disconnect();
    });
    observer.observe(root, { subtree: true, childList: true });
    return () => observer.disconnect();
  });
  return (
    <div class="agent-threads-story" ref={app.attach}>
      <PrototypeApp options={options} />
    </div>
  );
}

const meta = {
  title: "Conversation/Agent threads",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tabs: Story = {
  render: () => <AgentThreadsApp open={["pricing", "competitors", "release", "links"]} active={null} />,
};

export const UnreadThreads: Story = {
  render: () => (
    <AgentThreadsApp open={["pricing", "competitors", "release", "links"]} active={null} options={UNREAD_OPTIONS} />
  ),
};

export const SideThread: Story = {
  render: () => <AgentThreadsApp open={["pricing", "competitors"]} active="pricing" />,
};

export const ThreadWithQueue: Story = {
  render: () => <AgentThreadsApp open={["competitors"]} active="competitors" options={THREAD_QUEUE_OPTIONS} />,
};

export const QueuedThread: Story = {
  render: () => <AgentThreadsApp open={["links"]} active="links" />,
};

export const Branch: Story = {
  render: () => <AgentThreadsApp open={["pricing", "pricing-short"]} active="pricing-short" />,
};

export const BranchOfDeletedThread: Story = {
  render: () => <AgentThreadsApp open={["pricing-orphan"]} active="pricing-orphan" />,
};

export const NoTabs: Story = { render: () => <AgentThreadsApp open={[]} active={null} /> };
