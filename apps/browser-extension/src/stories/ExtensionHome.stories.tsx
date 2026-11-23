import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { HomeScreen } from "../HomeScreen";
import type { Workspace } from "../workspace";
import { OUTBOX_KEY } from "../x-outbox";
import { WithWorkspace } from "./story-frame";
import { installStoryChrome, STORY_CHANNEL, type StoryServerOptions } from "./story-server";

const meta = {
  title: "Extension/Home",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const HOSTS: RemoteTeamHost[] = [host("host-home", "Home server"), host("host-studio", "Studio VPS")];

function host(hostId: string, name: string): RemoteTeamHost {
  return {
    hostId,
    name,
    logoKey: null,
    devicePublicKey: "story-key",
    membershipId: `membership-${hostId}`,
    role: "owner",
  };
}

function Home(props: {
  options?: StoryServerOptions;
  offline?: boolean;
  setup?: (workspace: Workspace) => void;
  sharing?: { tabs: number; supported: boolean };
}) {
  return (
    <WithWorkspace options={props.options} setup={props.setup}>
      {(workspace) => (
        <HomeScreen
          workspace={workspace}
          serverName="Home server"
          hosts={HOSTS}
          hostId="host-home"
          offline={props.offline ?? false}
          onOpenAgent={() => undefined}
          onOpenChannel={() => undefined}
          onCreate={() => undefined}
          onStartThread={() => undefined}
          onSelectHost={() => undefined}
          onSignOut={() => undefined}
          sharing={props.sharing ?? null}
          canShare
          onShareTabs={() => undefined}
          onManageSharing={() => undefined}
        />
      )}
    </WithWorkspace>
  );
}

export const Chats: Story = { render: () => <Home options={{ unread: { "x-desk": 3, research: 1 } }} /> };

export const Pinned: Story = {
  render: () => (
    <Home
      options={{
        folders: true,
        channels: [STORY_CHANNEL],
        unread: { research: 3 },
        pins: [
          { kind: "agent", id: "chief" },
          { kind: "channel", id: STORY_CHANNEL.id },
          { kind: "agent", id: "research" },
        ],
      }}
    />
  ),
};

export const FoldersAndChannels: Story = {
  render: () => <Home options={{ folders: true, channels: [STORY_CHANNEL], unread: { chief: 2 } }} />,
};

export const ChannelWorking: Story = {
  render: () => <Home options={{ channels: [{ ...STORY_CHANNEL, activeTasks: 2, unreadCount: 0 }] }} />,
};

export const NoAgents: Story = { render: () => <Home options={{ agents: [] }} /> };

export const Offline: Story = { render: () => <Home offline /> };

function waitingPost(id: string, handle: string, text: string, minutesAgo: number, message = "") {
  return {
    id,
    payload: {
      message,
      pageUrl: `https://x.com/${handle.slice(1)}/status/${id}`,
      replyTo: 0,
      posts: [
        {
          authorName: handle.slice(1),
          handle,
          time: "2026-11-19T10:05:00.000Z",
          url: `https://x.com/${handle.slice(1)}/status/${id}`,
          text,
          article: "",
          media: [],
        },
      ],
    },
    createdAt: Date.now() - minutesAgo * 60_000,
    attempts: 3,
    nextAt: Date.now() + 42_000,
    error: "The server is offline.",
    reachedAt: null,
  };
}

export const PostsFromXWait: Story = {
  render: () => {
    installStoryChrome({
      [OUTBOX_KEY]: [
        waitingPost("2", "@bob", "Studies show two eggs a day cut heart risk by 40%.", 6, "Is this true?"),
        waitingPost("4", "@alice", "Eggs are a superfood. Thoughts?", 2),
      ],
    });
    return <Home />;
  },
};

export const ManyPostsFromXWait: Story = {
  render: () => {
    const handles = ["@bob", "@alice", "@carol", "@dmitri", "@erin", "@farah", "@gus", "@hana", "@ivo", "@jun"];
    installStoryChrome({
      [OUTBOX_KEY]: handles.map((handle, index) =>
        waitingPost(
          String(index + 10),
          handle,
          `Post ${index + 1}: a claim about the launch numbers that the X agent should check before I answer.`,
          (index + 1) * 95,
        ),
      ),
    });
    return <Home />;
  },
};
