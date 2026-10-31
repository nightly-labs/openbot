/**
 * The channel chat as the app shows it: the conversation view with a channel source. The source
 * is written out here rather than built from the channels store, which needs the account, server and
 * turns contexts and a channel-aware `window.openbot` behind it. `ChannelConversation.stories.tsx`
 * builds its variants on it, and the diagram workspace story shows it when a channel is open.
 */

import { Button } from "@openbot/ui";
import type { AgentMessage } from "@openbot/ui/data";
import type { ChannelWorker } from "@openbot/ui/features/channels/ChannelActivityIndicator";
import { ChannelAvatar } from "@openbot/ui/features/channels/ChannelAvatar";
import { ChannelStoppedTasks } from "@openbot/ui/features/channels/ChannelStoppedTasks";
import type { AwaitingReplyItem } from "@openbot/ui/features/conversation/AwaitingReplies";
import { fn } from "storybook/test";
import type { ConversationChannelSource } from "../src/features/conversation/conversation-types";
import { StoryConversation } from "./conversation-story-support";
import { requireFixture, STORY_AGENTS } from "./fixtures";

export const CHANNEL_STORY_CHIEF = requireFixture(STORY_AGENTS[0], "Story agent 0");
export const CHANNEL_STORY_RESEARCH = requireFixture(STORY_AGENTS[1], "Story agent 1");
export const CHANNEL_STORY_SALES = requireFixture(STORY_AGENTS[2], "Story agent 2");

const members = [CHANNEL_STORY_CHIEF, CHANNEL_STORY_RESEARCH, CHANNEL_STORY_SALES].map((agent) => ({
  agentId: agent.id,
}));

/** A message time of the story day as the stored timestamp, so that a run of one author groups. */
function storyCreatedAt(time: string) {
  return `2026-09-01T${time}:00`;
}

export function channelStoryAgentMessage(
  id: string,
  agentId: string,
  body: string,
  time: string,
  streaming = false,
): AgentMessage {
  return {
    id,
    author: "agent",
    senderAgentId: agentId,
    body,
    time,
    createdAt: storyCreatedAt(time),
    streaming,
    kind: "text",
  };
}

export function channelStoryMemberMessage(
  id: string,
  body: string,
  time: string,
  memberId = "member-self",
): AgentMessage {
  return {
    id,
    author: "you",
    senderMember: { id: memberId, name: memberId === "member-self" ? "You" : "Avery" },
    body,
    time,
    createdAt: storyCreatedAt(time),
    kind: "text",
  };
}

export const CHANNEL_STORY_MESSAGES: AgentMessage[] = [
  channelStoryAgentMessage(
    "m1",
    CHANNEL_STORY_CHIEF.id,
    "I read the brief. I will split it into three tasks.",
    "11:12",
  ),
  channelStoryAgentMessage(
    "m2",
    CHANNEL_STORY_CHIEF.id,
    "Sales Outbound takes the first, I take the other two.",
    "11:13",
  ),
  channelStoryMemberMessage("m3", "Good. Start with the numbers.", "12:59"),
  channelStoryAgentMessage(
    "m4",
    CHANNEL_STORY_SALES.id,
    "Last quarter closed 12% over plan. The detail is in the sheet.",
    "13:04",
  ),
  channelStoryMemberMessage("m5", "Can you add the regional split?", "13:05", "member-avery"),
  channelStoryAgentMessage("m6", CHANNEL_STORY_RESEARCH.id, "I am checking the source of the 12%…", "13:05", true),
];

export interface ChannelStoryProps {
  name?: string;
  messages?: AgentMessage[];
  workers?: ChannelWorker[];
  awaiting?: AwaitingReplyItem[];
  stopped?: { id: string; ownerAgentId: string; error: string }[];
  archived?: boolean;
  activeTurnId?: string | null;
  unreadCount?: number;
  firstUnreadMessageId?: string | null;
}

/** The channel chat on a mocked bridge, for a story that shows a channel or composes screens. */
export function StoryChannelConversation(props: ChannelStoryProps) {
  const name = () => props.name ?? "Project room";
  const agentName = (id: string | null) => STORY_AGENTS.find((agent) => agent.id === id)?.name ?? "Unassigned";
  const source: ConversationChannelSource = {
    id: "story-channel",
    name,
    readOnly: () => props.archived === true,
    author: (message) => {
      const agent = STORY_AGENTS.find((candidate) => candidate.id === message.senderAgentId);
      return { kind: "agent", name: agent?.name ?? "Former member", agent, avatarSeed: message.senderAgentId };
    },
    workers: () => props.workers ?? [],
    workingTurns: () => [],
    interactionAgentName: () => undefined,
    awaitingReplies: () => props.awaiting ?? [],
    HeaderTitle: () => (
      <Button variant="ghost" size="sm" class="conversation-title channel-title no-drag" aria-label="Channel settings">
        <ChannelAvatar members={members} agents={STORY_AGENTS} />
        <span class="channel-header-copy">
          <h1>{name()}</h1>
          <span class="channel-header-title">Quarterly launch</span>
        </span>
      </Button>
    ),
    SettingsPane: () => null,
    AboveComposer: () => (
      <ChannelStoppedTasks
        tasks={props.stopped ?? []}
        members={members}
        name={agentName}
        onResume={fn()}
        onCancel={fn()}
      />
    ),
    EmptyState: () => (
      <div class="channel-empty">
        <ChannelAvatar members={members} agents={STORY_AGENTS} />
        <h2>{name()}</h2>
        <p class="channel-empty-title">Quarterly launch</p>
        <p>Plan the launch post and check every number before it goes out.</p>
      </div>
    ),
  };
  return (
    <StoryConversation
      channel={source}
      agent={undefined}
      modelOptions={[]}
      mentionAgents={STORY_AGENTS.slice(0, 3)}
      messages={props.messages ?? CHANNEL_STORY_MESSAGES}
      activeTurnId={props.activeTurnId ?? null}
      unreadCount={props.unreadCount ?? 0}
      firstUnreadMessageId={props.firstUnreadMessageId ?? null}
    />
  );
}
