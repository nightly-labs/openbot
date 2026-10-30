import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { onSettled } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AGENT_ID, TABS_KEY, THREAD_OPTIONS } from "./agent-threads-fixtures";
import { createAppDom, openChat, PrototypeApp } from "./prototype-support";
import "./agent-threads-story.css";

/** The real app on Chief, with the open tabs that this device stored. */
function AgentThreadsApp(props: { open: string[]; active: string | null }) {
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
      <PrototypeApp options={THREAD_OPTIONS} />
    </div>
  );
}

const meta = {
  title: "Conversation/Agent threads",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The agent's own chat, with four open side threads as tabs: done, working, failed and queued. */
export const Tabs: Story = {
  render: () => <AgentThreadsApp open={["pricing", "competitors", "release", "links"]} active={null} />,
};

/** A side thread in the place of the chat, with its context meter. */
export const SideThread: Story = {
  render: () => <AgentThreadsApp open={["pricing", "competitors"]} active="pricing" />,
};

/** A thread that the agent started, held by the limit of parallel threads. */
export const QueuedThread: Story = {
  render: () => <AgentThreadsApp open={["links"]} active="links" />,
};

/** No side thread is open: the header shows only "New thread" and the menu. */
export const NoTabs: Story = { render: () => <AgentThreadsApp open={[]} active={null} /> };
