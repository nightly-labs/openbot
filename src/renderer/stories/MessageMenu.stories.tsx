import type { MessageReaction } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { MessageActions, MessageMenu } from "@openbot/ui/features/conversation/MessageRendering";
import { createStore } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS } from "./fixtures";

const agentMessage: AgentMessage = {
  id: "message-menu-agent",
  author: "agent",
  body: "The launch brief is ready. I tightened the milestones, assigned owners, and kept the rollout reversible.",
  time: "10:02",
  kind: "text",
  reaction: "👍",
};

const ownMessage: AgentMessage = {
  id: "message-menu-user",
  author: "you",
  body: "Great — turn that into a checklist for the team.",
  time: "10:03",
  kind: "text",
};

const rowCallbacks = {
  onSelectAgent: fn(),
  onOpenLink: fn(),
  onPreview: fn(),
  onAttachmentAction: fn(),
};
const onReply = fn();
const onCopy = fn();
const onMarkUnread = fn();
const onBranch = fn();

/** A message row with the action row and the right-click menu, as the timeline draws it. */
function MenuRow(props: { message: AgentMessage; channel?: boolean; busy?: boolean }) {
  const [state, setState] = createStore<{
    reaction: MessageReaction | undefined;
    reading: boolean;
    pickerOpen: boolean;
  }>({
    reaction: props.message.reaction ?? undefined,
    reading: false,
    pickerOpen: false,
  });
  const message = (): AgentMessage => ({ ...props.message, reaction: state.reaction });
  const own = () => props.message.author === "you";
  const actions = {
    onReact: (emoji: MessageReaction | null) =>
      setState((draft) => {
        draft.reaction = emoji ?? undefined;
        draft.pickerOpen = false;
      }),
    onReply,
    onCopy,
  };
  /** Only the last answer of a turn in an agent chat branches. */
  const branch = () => (own() || props.channel ? undefined : onBranch);
  const readAloud = () =>
    own()
      ? undefined
      : {
          reading: state.reading,
          onToggle: () =>
            setState((draft) => {
              draft.reading = !draft.reading;
            }),
        };
  return (
    <ChatMessageRow
      message={message()}
      author={own() ? { kind: "you", name: "You" } : { kind: "agent", name: "Chief", agent: STORY_AGENTS[0] }}
      agents={STORY_AGENTS}
      reactions={state.reaction && !props.channel ? [{ emoji: state.reaction, actor: { kind: "user" } }] : undefined}
      onRemoveReaction={() => actions.onReact(null)}
      {...rowCallbacks}
      actions={
        <MessageActions
          message={message()}
          reactions={!props.channel}
          pickerOpen={state.pickerOpen}
          expandedEmoji={false}
          copied={false}
          onTogglePicker={() =>
            setState((draft) => {
              draft.pickerOpen = !draft.pickerOpen;
            })
          }
          onExpandEmoji={fn()}
          readAloud={readAloud()}
          onBranch={branch()}
          branchDisabled={props.busy}
          {...actions}
        />
      }
      menu={() => (
        <MessageMenu
          message={message()}
          reactions={!props.channel}
          readAloud={readAloud()}
          onMarkUnread={own() || props.channel ? undefined : onMarkUnread}
          onBranch={branch()}
          branchDisabled={props.busy}
          {...actions}
        />
      )}
    />
  );
}

const meta = {
  title: "Conversation/MessageMenu",
  parameters: { layout: "padded", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Right-click a message, or press Shift+F10 in its action row. React opens a submenu. The last
 * answer of a turn also has Branch from here, and an agent message has Mark unread.
 */
export const AgentChat: Story = {
  render: () => (
    <main class="foundation-story">
      <MenuRow message={agentMessage} />
      <MenuRow message={ownMessage} />
    </main>
  ),
};

/** While a turn runs, Branch shows but is disabled. */
export const TurnRuns: Story = {
  render: () => (
    <main class="foundation-story">
      <MenuRow message={agentMessage} busy />
    </main>
  ),
};

/** A channel message has no reactions and no branch, so the menu leaves them out. */
export const Channel: Story = {
  render: () => (
    <main class="foundation-story">
      <MenuRow message={agentMessage} channel />
    </main>
  ),
};
