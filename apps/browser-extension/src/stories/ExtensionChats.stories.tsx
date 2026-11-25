import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ChannelScreen } from "../ChannelScreen";
import { ChatScreen } from "../ChatScreen";
import { WithWorkspace } from "./story-frame";
import {
  agent,
  channelMessage,
  MEMBER_ID,
  STORY_AGENTS,
  STORY_CHANNEL,
  STORY_CHIEF_MESSAGES,
  type StoryServerOptions,
} from "./story-server";

const meta = {
  title: "Extension/Chats",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function AgentChat(props: { options?: StoryServerOptions; agentId?: string }) {
  return (
    <WithWorkspace options={props.options} setup={(workspace) => workspace.openChat(props.agentId ?? "chief", null)}>
      {(workspace) => (
        <ChatScreen
          workspace={workspace}
          onBack={() => undefined}
          onOpen={() => undefined}
          onOpenSettings={() => undefined}
        />
      )}
    </WithWorkspace>
  );
}

export const Conversation: Story = {
  render: () => <AgentChat options={{ chats: { chief: STORY_CHIEF_MESSAGES } }} />,
};

export const Answering: Story = {
  render: () => <AgentChat options={{ chats: { chief: STORY_CHIEF_MESSAGES.slice(0, 1) }, answering: "chief" }} />,
};

export const EmptyChat: Story = { render: () => <AgentChat /> };

export const WithDictation: Story = {
  render: () => <AgentChat options={{ chats: { chief: STORY_CHIEF_MESSAGES.slice(0, 2) }, dictation: true }} />,
};

export const ErrorOverComposer: Story = { render: () => <AgentChat options={{ failChat: true }} /> };

function ChannelChat(props: { options?: StoryServerOptions }) {
  return (
    <WithWorkspace
      options={{ channels: [STORY_CHANNEL], ...props.options }}
      setup={(workspace) => workspace.openChannel(STORY_CHANNEL.id)}
    >
      {(workspace) => <ChannelScreen workspace={workspace} onBack={() => undefined} onOpenAgent={() => undefined} />}
    </WithWorkspace>
  );
}

export const Channel: Story = { render: () => <ChannelChat /> };

export const ChannelWorking: Story = {
  render: () => (
    <ChannelChat
      options={{ channels: [{ ...STORY_CHANNEL, activeTasks: 2 }], channelWorkers: ["builder", "research"] }}
    />
  ),
};

export const ChannelEmpty: Story = { render: () => <ChannelChat options={{ channelMessages: [] }} /> };

const LONG_AGENTS = [
  ...STORY_AGENTS,
  agent({ id: "long-one", name: "Quarterly Revenue Forecasting Specialist", avatarHue: 185 }),
  agent({ id: "long-two", name: "International Compliance Reviewer", avatarHue: 55 }),
];

export const ChannelLongContent: Story = {
  render: () => (
    <ChannelChat
      options={{
        agents: LONG_AGENTS,
        channels: [
          {
            ...STORY_CHANNEL,
            name: "Quarterly planning and international launch coordination room",
            members: [...STORY_CHANNEL.members, { agentId: "long-one" }, { agentId: "long-two" }],
            activeTasks: 3,
          },
        ],
        channelWorkers: ["long-one", "long-two", "research"],
        channelMessages: [
          channelMessage(
            1,
            { kind: "member", id: MEMBER_ID, name: "You" },
            "Check https://example.com/reports/2026/q4/international-launch/compliance-review-final-version-3.pdf?download=true&ref=launch-room",
          ),
          channelMessage(
            2,
            { kind: "agent", id: "long-one", name: "Quarterly Revenue Forecasting Specialist" },
            "Supercalifragilisticexpialidociouslylongidentifierwithoutanybreaks_2026_Q4_forecast_v3 is the file name.",
          ),
          channelMessage(
            3,
            { kind: "agent", id: "long-two", name: "International Compliance Reviewer" },
            "| Region | Status | Owner | Due | Notes |\n| --- | --- | --- | --- | --- |\n| European Union | Blocked | Compliance | Friday | Needs the data processing agreement |\n| United States | Ready | Legal | Monday | None |\n\n```\nnpm run release -- --region=eu-west-1 --channel=stable --skip-preflight=false\n```",
          ),
        ],
      }}
    />
  ),
};
