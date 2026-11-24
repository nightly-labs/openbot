import type { ClientAgentSummary } from "@openbot/contracts/ipc";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";
import { BrowserAsks } from "../BrowserSharing";
import { ChannelScreen } from "../ChannelScreen";
import { ChatScreen } from "../ChatScreen";
import { ASKS_KEY } from "../client-browser-messages";
import { HomeScreen } from "../HomeScreen";
import { LoadWorkspace } from "./story-frame";
import {
  agent,
  channelMessage,
  installStoryChrome,
  MEMBER_ID,
  message,
  STORY_CHANNEL,
  STORY_FILES,
  type StoryServerOptions,
} from "./story-server";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const AGENTS: ClientAgentSummary[] = [
  agent({
    id: "chief",
    name: "Chief",
    title: "Chief of staff",
    preview: "Here are the three points that matter for your Q1 plan.",
    updatedAt: ago(1),
    avatarHue: 245,
  }),
  agent({
    id: "research",
    name: "Research",
    title: "Research partner",
    preview: "I checked 14 sources. Two of them disagree on the date.",
    updatedAt: ago(4),
    avatarHue: 150,
  }),
  agent({
    id: "support",
    name: "Support",
    title: "Customer support",
    preview: "I answered 12 tickets. One customer asks for a refund.",
    updatedAt: ago(9),
    avatarHue: 245,
  }),
  agent({
    id: "travel",
    name: "Travel",
    title: "Trips and bookings",
    preview: "The 9:40 flight to Lisbon is the cheapest. Book it?",
    updatedAt: ago(18),
    avatarHue: 185,
  }),
  agent({
    id: "inbox",
    name: "Inbox",
    title: "Email triage",
    preview: "3 emails need you today. I drafted answers to the rest.",
    updatedAt: ago(36),
    avatarHue: 0,
  }),
  agent({
    id: "writer",
    name: "Writer",
    title: "Copy and posts",
    preview: "Two versions of the launch post are ready for you.",
    updatedAt: ago(70),
    avatarHue: 320,
  }),
  agent({
    id: "builder",
    name: "Builder",
    title: "Engineer",
    preview: "The fix is merged. All checks pass.",
    updatedAt: ago(140),
    avatarHue: 30,
  }),
  agent({
    id: "launch",
    name: "Launch",
    title: "Launch manager",
    preview: "Thursday is on track. One item is still open.",
    updatedAt: ago(260),
    avatarHue: 55,
  }),
  agent({
    id: "shopper",
    name: "Price Watch",
    title: "Deals and prices",
    preview: "The headphones you saved dropped to $189.",
    updatedAt: ago(600),
    avatarHue: 100,
  }),
  agent({
    id: "finance",
    name: "Finance",
    title: "Budgets and invoices",
    preview: "November spend is 8% under budget.",
    updatedAt: ago(1_500),
    avatarHue: 215,
  }),
  agent({
    id: "calendar",
    name: "Calendar",
    title: "Schedule",
    preview: "Your Friday call moved to 4 PM. I told the team.",
    updatedAt: ago(3_000),
    avatarHue: 280,
  }),
];

const LAUNCH_ROOM = {
  ...STORY_CHANNEL,
  name: "Launch room",
  members: [...STORY_CHANNEL.members, { agentId: "writer" }],
  unreadCount: 0,
  lastMessage: { authorName: "Builder", author: { kind: "agent" as const, id: "builder" }, text: "Done.", at: ago(6) },
};

const HOST: RemoteTeamHost = {
  hostId: "host-home",
  name: "My Mac",
  logoKey: null,
  devicePublicKey: "story-key",
  membershipId: "membership-host-home",
  role: "owner",
};

const SERVER: StoryServerOptions = {
  agents: AGENTS,
  channels: [LAUNCH_ROOM],
  pins: [
    { kind: "agent", id: "chief" },
    { kind: "channel", id: LAUNCH_ROOM.id },
    { kind: "agent", id: "research" },
  ],
  unread: { travel: 2, inbox: 3 },
  dictation: true,
};

export function StoreHomePanel() {
  installStoryChrome();
  return (
    <LoadWorkspace options={SERVER}>
      {(workspace) => (
        <HomeScreen
          workspace={workspace}
          serverName={HOST.name}
          hosts={[HOST]}
          hostId={HOST.hostId}
          offline={false}
          onOpenAgent={() => undefined}
          onOpenChannel={() => undefined}
          onCreate={() => undefined}
          onStartThread={() => undefined}
          onSelectHost={() => undefined}
          onSignOut={() => undefined}
          onOpenSettings={() => undefined}
          sharing={false}
          canShare
          onManageSharing={() => undefined}
        />
      )}
    </LoadWorkspace>
  );
}

function Chat(props: { agentId: string; options: StoryServerOptions; asks?: boolean }) {
  return (
    <LoadWorkspace options={props.options} setup={(workspace) => workspace.openChat(props.agentId, null)}>
      {(workspace) => (
        <>
          <ChatScreen
            workspace={workspace}
            onBack={() => undefined}
            onOpen={() => undefined}
            onOpenSettings={() => undefined}
          />
          {props.asks ? <BrowserAsks /> : null}
        </>
      )}
    </LoadWorkspace>
  );
}

export function StoreArticleChatPanel() {
  installStoryChrome();
  return (
    <Chat
      agentId="chief"
      options={{
        ...SERVER,
        chats: {
          chief: [
            message("s1", "user", "What does this article mean for our Q1?", { createdAt: ago(3) }),
            message(
              "s2",
              "assistant",
              "Two points matter for your Q1 plan:\n\n1. **Hiring** — start the two support roles in April.\n2. **Budget** — move $12k to agent tools.\n\n| Change | Saves |\n| --- | --- |\n| Later hires | $18k |\n| Agent tools | $6k |",
              { createdAt: ago(2) },
            ),
            message("s3", "user", "Good. Put it in a one-page brief for Monday.", { createdAt: ago(2) }),
            message("s4", "assistant", "Done. I added the brief to Monday's agenda too.", {
              createdAt: ago(1),
              attachments: STORY_FILES.slice(1, 2).map((file) => ({ ...file, name: "Q1 brief.pdf" })),
            }),
          ],
        },
      }}
    />
  );
}

export function StoreTravelPanel() {
  installStoryChrome({
    [ASKS_KEY]: [
      {
        id: "store-ask",
        agentName: "Travel",
        site: "https://flights.example.com",
        kind: "site",
        action: "click",
        detail: 'button "Select 9:40 · $142"',
      },
    ],
  });
  return (
    <Chat
      agentId="travel"
      asks
      options={{
        ...SERVER,
        answering: "travel",
        chats: {
          travel: [
            message("t1", "user", "Compare the Lisbon flights in my shared tabs for Dec 12.", { createdAt: ago(5) }),
            message(
              "t2",
              "assistant",
              "I read your 3 shared tabs. The cheapest direct flight:\n\n| Time | Price | Bag |\n| --- | --- | --- |\n| **9:40** | **$142** | Included |\n| 13:15 | $168 | +$35 |\n| 18:50 | $191 | Included |\n\nThe 9:40 flight also lands before your 14:00 meeting.",
              { createdAt: ago(4) },
            ),
            message("t3", "user", "Select the 9:40 one and stop at the payment page.", { createdAt: ago(1) }),
          ],
        },
      }}
    />
  );
}

export function StorePriceWatchPanel() {
  installStoryChrome();
  return (
    <Chat
      agentId="shopper"
      options={{
        ...SERVER,
        chats: {
          shopper: [
            message("p1", "user", "Watch these headphones. Tell me when they cost less than $200.", {
              createdAt: ago(2_900),
            }),
            message("p2", "assistant", "I will check the price every morning and tell you.", {
              createdAt: ago(2_899),
            }),
            message(
              "p3",
              "assistant",
              "**Good news:** they dropped to **$189** today, the lowest price in 90 days.\n\n| Shop | Price |\n| --- | --- |\n| **This page** | **$189** |\n| Second shop | $215 |\n| Third shop | $229 |\n\nThe deal ends on Sunday. Add them to your cart?",
              { createdAt: ago(20) },
            ),
            message("p4", "user", "Yes, add them to the cart.", { createdAt: ago(2) }),
            message("p5", "assistant", "Done. They are in your cart at $189. I stopped before the checkout.", {
              createdAt: ago(1),
            }),
          ],
        },
      }}
    />
  );
}

export function StoreChannelPanel() {
  installStoryChrome();
  const you = { kind: "member" as const, id: MEMBER_ID, name: "You" };
  return (
    <LoadWorkspace
      options={{
        ...SERVER,
        channels: [{ ...LAUNCH_ROOM, activeTasks: 2 }],
        channelWorkers: ["builder", "research"],
        channelMessages: [
          channelMessage(1, you, "We launch on Thursday. What is still open?"),
          channelMessage(
            2,
            { kind: "agent", id: "chief", name: "Chief" },
            "Two items: the pricing page fix and the numbers in the press note. Builder takes the fix, Research checks the numbers.",
          ),
          channelMessage(
            3,
            { kind: "agent", id: "launch", name: "Launch" },
            "The checklist is updated. Everything else is green.",
          ),
          channelMessage(
            4,
            { kind: "agent", id: "research", name: "Research" },
            "The press note says 40%, but the source says 38%. I am fixing the note now.",
          ),
          channelMessage(5, you, "Great. Ping me when both items are done."),
        ],
      }}
      setup={(workspace) => workspace.openChannel(LAUNCH_ROOM.id)}
    >
      {(workspace) => <ChannelScreen workspace={workspace} onBack={() => undefined} onOpenAgent={() => undefined} />}
    </LoadWorkspace>
  );
}
