import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { onSettled } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { MockOpenBotOptions } from "../src/preview/mock-openbot";
import { AGENT_ID, TABS_KEY, THREAD_OPTIONS, THREAD_QUEUE_OPTIONS, UNREAD_OPTIONS } from "./agent-threads-fixtures";
import { createAppDom, openChat, PrototypeApp } from "./prototype-support";
import "./agent-threads-story.css";

/** The real app on Chief, with the open tabs that this device stored. */
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

/** The agent's own chat, with four open side threads as tabs: done, working, failed and queued. */
export const Tabs: Story = {
  render: () => <AgentThreadsApp open={["pricing", "competitors", "release", "links"]} active={null} />,
};

/**
 * Unread agent messages in three side threads: a blue dot on their tabs and menu rows, and the count on
 * Chief's sidebar row. A state badge outranks the dot. Open a thread to read it.
 */
export const UnreadThreads: Story = {
  render: () => (
    <AgentThreadsApp open={["pricing", "competitors", "release", "links"]} active={null} options={UNREAD_OPTIONS} />
  ),
};

/** A side thread in the place of the chat, with its context meter. */
export const SideThread: Story = {
  render: () => <AgentThreadsApp open={["pricing", "competitors"]} active="pricing" />,
};

/**
 * A thread that works, with two messages in its queue above the input. Reply to a message: the reply
 * card comes out from behind the input, under the queue.
 */
export const ThreadWithQueue: Story = {
  render: () => <AgentThreadsApp open={["competitors"]} active="competitors" options={THREAD_QUEUE_OPTIONS} />,
};

/** A thread that the agent started, held by the limit of parallel threads. */
export const QueuedThread: Story = {
  render: () => <AgentThreadsApp open={["links"]} active="links" />,
};

/**
 * A branch of "Pricing page copy". The line after the copied messages opens the source at the
 * answer that the branch came from. Open the thread menu: each branch shows under its source.
 * Hover the last answer of a turn for "Branch in new thread", or right-click it for "Branch from here".
 */
export const Branch: Story = {
  render: () => <AgentThreadsApp open={["pricing", "pricing-short"]} active="pricing-short" />,
};

/** A branch whose source thread was deleted: the line has no link. */
export const BranchOfDeletedThread: Story = {
  render: () => <AgentThreadsApp open={["pricing-orphan"]} active="pricing-orphan" />,
};

/** No side thread is open: the header shows only "New thread" and the menu. */
export const NoTabs: Story = { render: () => <AgentThreadsApp open={[]} active={null} /> };
