import { AVATAR_HUES } from "@openbot/contracts/ipc";
import type { AvatarMood } from "@openbot/ui/bloub-avatar";
import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import {
  AgentDock,
  type AgentDockChannel,
  type AgentDockChatModel,
  type AgentDockSeat,
  type AgentDockSeatRef,
  type AgentDockShelfResult,
  agentDockSeatKey,
} from "@openbot/ui/features/agent-dock/AgentDock";
import type { SidebarAgentState } from "@openbot/ui/features/sidebar/sidebar-types";
import { createSignal, createStore, onCleanup, onSettled, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AgentDockEdgeStrip } from "../src/features/agent-dock/AgentDockEdgeStrip";
import { requireFixture, STORY_AGENTS } from "./fixtures";

function storyAgent(id: string): AgentProfile {
  return requireFixture(
    STORY_AGENTS.find((agent) => agent.id === id),
    id,
  );
}

const chief = storyAgent("chief");
const research = storyAgent("research");
const sales = storyAgent("sales");
const design: AgentProfile = {
  ...research,
  id: "design",
  name: "Design Review",
  title: "Product designer",
  avatarSeed: "design-review",
  avatarHue: 30,
  threadId: "design-thread",
};
const support: AgentProfile = {
  ...chief,
  id: "support",
  name: "Customer Support",
  title: "Support lead",
  avatarSeed: "customer-support",
  avatarHue: 150,
  threadId: "support-thread",
};
/** More copies of the fixture agents, so the dock has more seats than the screen shows. */
const EXTRA_AGENTS: AgentProfile[] = Array.from({ length: 10 }, (_, index) => {
  const base = [chief, research, sales][index % 3] ?? chief;
  return {
    ...base,
    id: `extra-${index + 1}`,
    name: `${base.name} ${index + 2}`,
    avatarSeed: `extra-${index + 1}`,
    avatarHue: AVATAR_HUES[index % AVATAR_HUES.length] ?? null,
    threadId: `extra-${index + 1}-thread`,
  };
});
const AGENTS = [chief, research, sales, design, support, ...EXTRA_AGENTS];

/** Channels with their members. One has a picture instead of the member faces. */
const CHANNELS: AgentDockChannel[] = [
  {
    id: "launch",
    name: "Launch team",
    title: "Thursday launch",
    members: [{ agentId: "chief" }, { agentId: "research" }, { agentId: "sales" }],
    icon: null,
    imageUrl: null,
  },
  {
    id: "support-desk",
    name: "Support desk",
    title: "",
    members: [{ agentId: "support" }, { agentId: "chief" }],
    icon: { name: "lifebuoy", hue: 150 },
    imageUrl: null,
  },
];

/** The state of each agent and channel: the same states as the sidebar badges. */
const ACTIVITY: Record<string, { mood: AvatarMood; state: SidebarAgentState | undefined }> = {
  chief: { mood: "working", state: { kind: "working" } },
  research: {
    mood: "waiting",
    state: { kind: "waiting", reason: "question", detail: "Which market do you want first?" },
  },
  sales: { mood: "idle", state: { kind: "unread", count: 3 } },
  design: { mood: "failed", state: { kind: "routine", phase: "failed", count: 1 } },
  support: { mood: "responded", state: { kind: "responded" } },
  launch: { mood: "idle", state: { kind: "unread", count: 2 } },
};

function message(id: string, author: AgentMessage["author"], body: string): AgentMessage {
  return { id, author, body, time: "09:12" };
}

const MESSAGES: Record<string, AgentMessage[]> = {
  chief: [
    message("c1", "you", "Can you put the launch plan for Thursday together with @[Research](agent:research)?"),
    message("c2", "agent", "Yes. I am checking the **calendar** and the open tasks first."),
  ],
  research: [
    message("r1", "you", "Compare the three markets we spoke about."),
    message("r2", "agent", "I have the numbers for all three. Before I write the summary, I need one answer."),
  ],
  // Long enough to scroll, so the edges of the log fade.
  sales: [
    message("s0a", "you", "Send the follow-up email to the five leads from Tuesday's demo."),
    message("s0b", "agent", "Sent to all five. I used the short version with the pricing link."),
    message("s0c", "you", "Good. Tell me when someone answers."),
    message("s0d", "agent", "I will. I also put a reminder on Friday for the leads that do not answer."),
    message("s0e", "you", "Add Initech to the list too. Their contact is in the CRM."),
    message("s0f", "agent", "Added. Initech gets the same email this afternoon."),
    message("s1", "agent", "Two leads answered overnight."),
    message("s2", "agent", "Acme wants a call on Friday at 10:00."),
    message("s3", "agent", "Globex asks for the price of the team plan."),
  ],
  design: [message("d1", "agent", "I could not open the Figma file. The link asks for a sign-in.")],
  support: [
    message("u1", "you", "How many tickets are open?"),
    message("u2", "agent", "Four. Two of them need your decision today."),
  ],
  // A channel names the author of each message. The reader's own messages have no sender.
  launch: [
    { ...message("l1", "you", "Is everything ready for Thursday?"), senderMember: { id: "member-ana", name: "Ana" } },
    { ...message("l2", "agent", "The plan is done. Research checks the numbers now."), senderAgentId: "chief" },
    message("l3", "you", "Good. Send me the summary when it is ready."),
    { ...message("l4", "agent", "The numbers are correct. I attached the summary."), senderAgentId: "research" },
  ],
};

function addMessage(messages: Record<string, AgentMessage[]>, agentId: string, added: AgentMessage): void {
  const list = messages[agentId];
  if (list) list.push(added);
  else messages[agentId] = [added];
}

function agentSeats(...ids: string[]): AgentDockSeatRef[] {
  return ids.map((id) => ({ kind: "agent", id }));
}

function workingFixture(): Record<string, boolean> {
  const working: Record<string, boolean> = {};
  for (const [id, activity] of Object.entries(ACTIVITY)) working[id] = activity.state?.kind === "working";
  return working;
}

/** Finished work of three agents, the newest last. */
function finishedFixture(now: number): AgentDockShelfResult[] {
  return [
    { id: "result-1", agentId: "support", kind: "message", label: "Replied to 4 tickets", at: now - 3000 },
    { id: "result-2", agentId: "research", kind: "file", label: "competitor-pricing.md", at: now - 2000 },
    { id: "result-3", agentId: "sales", kind: "message", label: "Follow-up drafts are ready", at: now - 1000 },
    { id: "result-4", agentId: "chief", kind: "file", label: "weekly-summary.pdf", at: now },
  ];
}

/** The time without use before the story dock slides into the edge, as in the dock window. */
const STORY_TUCK_DELAY_MS = 900;

/**
 * The dock with fixture agents. A message that you send gets a short answer, which also shows on the
 * finished-work shelf until you open that chat. With `edgeStrip`, the dock hides when not in use and
 * leaves the edge strip, as "Show a strip at the edge" in Settings does.
 */
function AgentDockStory(props: { seats: AgentDockSeatRef[]; results?: AgentDockShelfResult[]; edgeStrip?: boolean }) {
  const [state, setState] = createStore({
    seats: props.seats.map(agentDockSeatKey),
    messages: structuredClone(MESSAGES),
    working: workingFixture(),
    results: [...(props.results ?? [])],
  });
  const timers = new Set<number>();
  onCleanup(() => {
    for (const timer of timers) window.clearTimeout(timer);
  });
  let nextId = 0;

  // As in the app, the dock starts full and goes into the edge when it is not in use.
  const [tucked, setTucked] = createSignal(false);
  const use = { near: false, onDock: false, chat: false };
  let tuckTimer: number | undefined;
  const updateTuck = () => {
    window.clearTimeout(tuckTimer);
    if (!props.edgeStrip) return;
    if (use.near || use.onDock || use.chat) setTucked(false);
    else tuckTimer = window.setTimeout(() => setTucked(true), STORY_TUCK_DELAY_MS);
  };
  onSettled(() => {
    if (!props.edgeStrip) return;
    const onPointer = (event: MouseEvent) => {
      use.onDock = event.target instanceof Element && event.target.closest(".agent-dock, .ui-action-menu") !== null;
      updateTuck();
    };
    document.addEventListener("mouseover", onPointer);
    updateTuck();
    return () => {
      document.removeEventListener("mouseover", onPointer);
      window.clearTimeout(tuckTimer);
    };
  });

  const seats = (): AgentDockSeat[] =>
    state.seats.flatMap((key): AgentDockSeat[] => {
      const id = key.slice(key.indexOf(":") + 1);
      const activity = ACTIVITY[id];
      const working = state.working[id] ?? false;
      const badge = working ? { kind: "working" as const } : activity?.state;
      if (key.startsWith("channel:")) {
        const channel = CHANNELS.find((candidate) => candidate.id === id);
        return channel ? [{ kind: "channel", channel, state: badge }] : [];
      }
      const agent = AGENTS.find((candidate) => candidate.id === id);
      return agent
        ? [{ kind: "agent", agent, mood: working ? "working" : (activity?.mood ?? "idle"), state: badge }]
        : [];
    });
  const chat = (seat: AgentDockSeatRef): AgentDockChatModel => {
    const activity = ACTIVITY[seat.id]?.state;
    return {
      messages: state.messages[seat.id] ?? [],
      working: state.working[seat.id] ?? false,
      wait: activity?.kind === "waiting" ? activity.reason : null,
    };
  };

  return (
    <div style={{ height: "100vh", background: "var(--openbot-bg-canvas)" }}>
      <AgentDock
        seats={seats()}
        available={AGENTS.filter((agent) => !state.seats.includes(agentDockSeatKey({ kind: "agent", id: agent.id })))}
        availableChannels={CHANNELS.filter(
          (channel) => !state.seats.includes(agentDockSeatKey({ kind: "channel", id: channel.id })),
        )}
        chat={chat}
        results={state.results}
        tucked={tucked()}
        onOpenChange={(seat) => {
          use.chat = seat !== null;
          updateTuck();
          setState((draft) => {
            for (let index = draft.results.length - 1; index >= 0; index -= 1) {
              if (seat?.kind === "agent" && draft.results[index]?.agentId === seat.id) draft.results.splice(index, 1);
            }
          });
        }}
        onAdd={(seat) =>
          setState((draft) => {
            draft.seats.push(agentDockSeatKey(seat));
          })
        }
        onRemove={(seat) =>
          setState((draft) => {
            draft.seats.splice(draft.seats.indexOf(agentDockSeatKey(seat)), 1);
          })
        }
        onOpenSettings={() => undefined}
        onHide={() => undefined}
        onMove={(seat, before) =>
          setState((draft) => {
            const key = agentDockSeatKey(seat);
            draft.seats.splice(draft.seats.indexOf(key), 1);
            const index = before ? draft.seats.indexOf(agentDockSeatKey(before)) : -1;
            draft.seats.splice(index < 0 ? draft.seats.length : index, 0, key);
          })
        }
        onSend={async (seat, text) => {
          const agentId = seat.id;
          const id = `story-${++nextId}`;
          setState((draft) => {
            addMessage(draft.messages, agentId, message(id, "you", text));
            draft.working[agentId] = true;
          });
          const timer = window.setTimeout(() => {
            timers.delete(timer);
            setState((draft) => {
              addMessage(draft.messages, agentId, {
                ...message(`${id}-answer`, "agent", "Done. I added it to the list."),
                ...(seat.kind === "channel" ? { senderAgentId: "chief" } : {}),
              });
              draft.working[agentId] = false;
              if (seat.kind === "agent")
                draft.results.push({
                  id: `${id}-answer`,
                  agentId,
                  kind: "message",
                  label: "Done. I added it to the list.",
                  at: Date.now(),
                });
            });
          }, 1600);
          timers.add(timer);
          return { messageId: id };
        }}
        onOpenInMain={() => undefined}
        agents={AGENTS}
      />
      <Show when={props.edgeStrip}>
        <AgentDockEdgeStrip
          side="right"
          shown={tucked()}
          asks={seats().some((seat) => seat.state?.kind === "waiting")}
          onNearChange={(near) => {
            use.near = near;
            updateTuck();
          }}
          onShow={() => setTucked(false)}
        />
      </Show>
    </div>
  );
}

const meta = {
  title: "Agents/Agent dock",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Five agents on the dock, each in a different state: working, waiting for an answer, unread answers,
 * a failed routine and a new answer. Click an agent to open its chat; click it again or press Escape
 * to close it. Use + to add an agent and the ⋯ menu in the chat to remove one. Ten agents and two
 * channels are not on the dock, so the + menu starts with a search field: type part of a name and
 * press Enter to add the first match. With 8 or fewer, the menu is a plain list.
 */
export const States: Story = {
  render: () => <AgentDockStory seats={agentSeats("chief", "research", "sales", "design", "support")} />,
};

/**
 * Two channels beside the agents. A channel shows its member faces or its picture. Its chat names the
 * author of each message; the reader's own messages are on the right. Use + to add a channel.
 */
export const Channels: Story = {
  render: () => (
    <AgentDockStory
      seats={[
        ...agentSeats("chief", "research"),
        { kind: "channel", id: "launch" },
        { kind: "channel", id: "support-desk" },
      ]}
    />
  ),
};

/**
 * Four agents finished work. The three newest show beside the dock and "+1 more" shows the oldest.
 * Each hides after 8 s; the pointer on the dock or on the shelf brings them back. Click one to open
 * its chat.
 */
export const FinishedWork: Story = {
  render: () => (
    <AgentDockStory
      seats={agentSeats("chief", "research", "sales", "design", "support")}
      results={finishedFixture(Date.now())}
    />
  ),
};

/**
 * Fifteen agents: more than the dock shows. Scroll the seats; the edges fade where more agents are
 * behind them. An agent that you open at a faded edge scrolls into view.
 */
export const ManyAgents: Story = {
  render: () => <AgentDockStory seats={agentSeats(...AGENTS.map((agent) => agent.id))} />,
};

/** No agent on the dock yet: only the + button. */
export const Empty: Story = {
  render: () => <AgentDockStory seats={[]} />,
};

/**
 * The dock hides when not in use and leaves a thin strip at the edge. Move the pointer toward the strip:
 * it grows, and the dock comes out when the pointer is close. Research asks a question, so a wash front
 * goes up through the strip from time to time.
 */
export const EdgeStrip: Story = {
  render: () => <AgentDockStory seats={agentSeats("chief", "research", "sales")} edgeStrip />,
};

/** The edge strip while no agent asks anything: the strip stays dark and nothing moves. */
export const EdgeStripQuiet: Story = {
  render: () => <AgentDockStory seats={agentSeats("chief", "sales")} edgeStrip />,
};
