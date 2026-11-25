import {
  type AgentApproval,
  type AgentDockPrompt,
  type AgentDockTakeover,
  type AgentDockUsageLimit,
  AVATAR_HUES,
} from "@openbot/contracts/ipc";
import type { AvatarMood } from "@openbot/ui/bloub-avatar";
import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import {
  AgentDock,
  type AgentDockChannel,
  type AgentDockChatAnswers,
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

function finishedFixture(now: number): AgentDockShelfResult[] {
  return [
    { id: "result-1", agentId: "support", kind: "message", label: "Replied to 4 tickets", at: now - 3000 },
    { id: "result-2", agentId: "research", kind: "file", label: "competitor-pricing.md", at: now - 2000 },
    { id: "result-3", agentId: "sales", kind: "message", label: "Follow-up drafts are ready", at: now - 1000 },
    { id: "result-4", agentId: "chief", kind: "file", label: "weekly-summary.pdf", at: now },
  ];
}

const APPROVAL: AgentApproval = {
  requestId: "story-approval",
  agentId: "chief",
  threadId: "chief-thread",
  turnId: "chief-turn",
  kind: "command",
  command: "git push origin launch-plan",
  cwd: "~/OpenBot/Chief",
  reason: "Push the launch plan branch so Research can review it.",
  grantRoot: null,
  permissions: null,
};

const PROMPT: AgentDockPrompt = {
  requestId: "story-prompt",
  agentId: "research",
  threadId: "research-thread",
  turnId: "research-turn",
  questions: [
    {
      id: "market",
      header: "Market",
      question: "Which market do you want first?",
      isSecret: false,
      options: [
        { label: "Germany", description: "The biggest market, with the most competitors." },
        { label: "Poland", description: "Smaller, and we already have two customers there." },
        { label: "Spain", description: "The fastest growth of the three." },
      ],
    },
  ],
  attempt: 0,
};

const CRM_PAGE = { title: "Acme CRM – Sign in", origin: "https://crm.example.com" };

const TAKEOVER: AgentDockTakeover = {
  request: {
    requestId: "story-takeover",
    agentId: "sales",
    threadId: "sales-thread",
    turnId: "sales-turn",
    tabId: "tab-crm",
    secret: { method: "password", origin: "https://crm.example.com", digits: 6 },
  },
  page: CRM_PAGE,
  agentName: "Sales",
  vault: { server: null },
  attempt: 0,
};

const MANUAL_TAKEOVER: AgentDockTakeover = {
  request: {
    requestId: "story-manual-takeover",
    agentId: "sales",
    threadId: "sales-thread",
    turnId: "sales-turn",
    tabId: "tab-crm",
  },
  page: CRM_PAGE,
  agentName: "Sales",
  vault: null,
  attempt: 0,
};

const USAGE_LIMIT: AgentDockUsageLimit = {
  agentId: "chief",
  provider: "claude",
  model: "Claude Opus 5.5",
  agentName: null,
  resetsAt: Date.UTC(2026, 8, 21, 9, 0) / 1_000,
  options: [
    {
      key: "codex:gpt-6-luna",
      choice: { provider: "codex", model: "gpt-6-luna" },
      model: "GPT-6 Luna",
      account: null,
      state: "ready",
    },
    {
      key: "claude:claude-sonnet-5",
      choice: { provider: "claude", model: "claude-sonnet-5" },
      model: "Claude Sonnet 5",
      account: null,
      state: "limit",
    },
  ],
  rememberable: true,
  attempt: 0,
};

interface StoryRequests {
  approval?: AgentApproval;
  prompt?: AgentDockPrompt;
  takeover?: AgentDockTakeover;
  usageLimit?: AgentDockUsageLimit;
}

const STORY_TUCK_DELAY_MS = 900;

function AgentDockStory(props: {
  seats: AgentDockSeatRef[];
  temporary?: AgentDockSeatRef[];
  results?: AgentDockShelfResult[];
  edgeStrip?: boolean;
  requests?: StoryRequests;
}) {
  const answered: string[] = [];
  const [state, setState] = createStore({
    seats: [...props.seats, ...(props.temporary ?? [])].map(agentDockSeatKey),
    temporary: (props.temporary ?? []).map(agentDockSeatKey),
    messages: structuredClone(MESSAGES),
    working: workingFixture(),
    results: [...(props.results ?? [])],
    approval: props.requests?.approval ? structuredClone(props.requests.approval) : null,
    prompt: props.requests?.prompt ? structuredClone(props.requests.prompt) : null,
    takeover: props.requests?.takeover ? structuredClone(props.requests.takeover) : null,
    usageLimit: props.requests?.usageLimit ? structuredClone(props.requests.usageLimit) : null,
    answered,
  });
  const timers = new Set<number>();
  onCleanup(() => {
    for (const timer of timers) window.clearTimeout(timer);
  });
  let nextId = 0;

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

  const asksOf = (id: string): SidebarAgentState | undefined => {
    if (state.usageLimit?.agentId === id) return { kind: "limited", resetsAt: state.usageLimit.resetsAt };
    if (state.takeover?.request.agentId === id) return { kind: "waiting", reason: "takeover", detail: null };
    if (state.prompt?.agentId === id)
      return { kind: "waiting", reason: "question", detail: state.prompt.questions[0]?.question ?? null };
    if (state.approval?.agentId === id)
      return { kind: "waiting", reason: "approval", detail: state.approval.command ?? null };
    return undefined;
  };
  const seats = (): AgentDockSeat[] =>
    state.seats.flatMap((key): AgentDockSeat[] => {
      const id = key.slice(key.indexOf(":") + 1);
      const activity = state.answered.includes(id) ? undefined : ACTIVITY[id];
      const working = state.working[id] ?? false;
      const asks = asksOf(id);
      const badge: SidebarAgentState | undefined = asks ?? (working ? { kind: "working" } : activity?.state);
      const temporary = state.temporary.includes(key);
      if (key.startsWith("channel:")) {
        const channel = CHANNELS.find((candidate) => candidate.id === id);
        return channel ? [{ kind: "channel", channel, state: badge, temporary }] : [];
      }
      const agent = AGENTS.find((candidate) => candidate.id === id);
      return agent
        ? [
            {
              kind: "agent",
              agent,
              mood: asks ? "waiting" : working ? "working" : (activity?.mood ?? "idle"),
              state: badge,
              temporary,
            },
          ]
        : [];
    });
  const chat = (seat: AgentDockSeatRef): AgentDockChatModel => {
    const activity = state.answered.includes(seat.id) ? undefined : ACTIVITY[seat.id]?.state;
    const approval = state.approval?.agentId === seat.id ? state.approval : null;
    const prompt = state.prompt?.agentId === seat.id ? state.prompt : null;
    const takeover = state.takeover?.request.agentId === seat.id ? state.takeover : null;
    const usageLimit = state.usageLimit?.agentId === seat.id ? state.usageLimit : null;
    const asks = asksOf(seat.id);
    return {
      messages: state.messages[seat.id] ?? [],
      working: asks ? false : (state.working[seat.id] ?? false),
      wait: asks?.kind === "waiting" ? asks.reason : activity?.kind === "waiting" ? activity.reason : null,
      approval: approval ? { approval, attempt: 0 } : null,
      prompt,
      takeover,
      usageLimit,
    };
  };

  const answerLater = (agentId: string, request: keyof StoryRequests, reply: string) =>
    new Promise<true>((resolve) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        setState((draft) => {
          draft[request] = null;
          draft.answered.push(agentId);
          addMessage(draft.messages, agentId, message(`answer-${++nextId}`, "agent", reply));
        });
        resolve(true);
      }, 600);
      timers.add(timer);
    });
  const answers: AgentDockChatAnswers = {
    approval: (approval, decision) =>
      answerLater(
        approval.agentId,
        "approval",
        decision === "accept" ? "Pushed. Research can review the branch now." : "OK, I did not push it.",
      ),
    prompt: (prompt, given) =>
      answerLater(
        prompt.agentId,
        "prompt",
        Object.keys(given).length === 0 ? "OK, I stopped the question." : "Thanks. I start with that market.",
      ),
    takeover: (takeover, decision) =>
      answerLater(
        takeover.request.agentId,
        "takeover",
        decision === "complete" ? "Thanks. I continue in the CRM." : "OK, I stopped the CRM step.",
      ),
    secret: async (takeover) => {
      await answerLater(takeover.request.agentId, "takeover", "Signed in. I continue in the CRM.");
    },
    usageLimitSend: async (limit, option) => {
      await answerLater(limit.agentId, "usageLimit", `Sent on ${option.model}.`);
    },
    usageLimitWait: (limit) => void answerLater(limit.agentId, "usageLimit", "OK, I send it when the limit resets."),
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
        blurRequest={0}
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
            const key = agentDockSeatKey(seat);
            const firstTemporary = draft.seats.findIndex((item) => draft.temporary.includes(item));
            draft.temporary = draft.temporary.filter((item) => item !== key);
            draft.seats = draft.seats.filter((item) => item !== key);
            draft.seats.splice(firstTemporary < 0 ? draft.seats.length : firstTemporary, 0, key);
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
        answers={answers}
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

export const States: Story = {
  render: () => <AgentDockStory seats={agentSeats("chief", "research", "sales", "design", "support")} />,
};

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

export const NewMessageSeats: Story = {
  render: () => (
    <AgentDockStory
      seats={agentSeats("chief", "design")}
      temporary={[...agentSeats("research", "sales"), { kind: "channel", id: "launch" }]}
    />
  ),
};

export const FinishedWork: Story = {
  render: () => (
    <AgentDockStory
      seats={agentSeats("chief", "research", "sales", "design", "support")}
      results={finishedFixture(Date.now())}
    />
  ),
};

export const Approval: Story = {
  render: () => <AgentDockStory seats={agentSeats("chief", "research", "sales")} requests={{ approval: APPROVAL }} />,
};

export const Question: Story = {
  render: () => <AgentDockStory seats={agentSeats("chief", "research", "sales")} requests={{ prompt: PROMPT }} />,
};

export const TakeoverSecret: Story = {
  render: () => <AgentDockStory seats={agentSeats("chief", "research", "sales")} requests={{ takeover: TAKEOVER }} />,
};

export const TakeoverManual: Story = {
  render: () => (
    <AgentDockStory seats={agentSeats("chief", "research", "sales")} requests={{ takeover: MANUAL_TAKEOVER }} />
  ),
};

export const UsageLimit: Story = {
  render: () => (
    <AgentDockStory seats={agentSeats("chief", "research", "sales")} requests={{ usageLimit: USAGE_LIMIT }} />
  ),
};

export const ManyAgents: Story = {
  render: () => <AgentDockStory seats={agentSeats(...AGENTS.map((agent) => agent.id))} />,
};

export const AllOnDock: Story = {
  render: () => (
    <AgentDockStory
      seats={[
        ...agentSeats(...AGENTS.map((agent) => agent.id)),
        ...CHANNELS.map((channel) => ({ kind: "channel" as const, id: channel.id })),
      ]}
    />
  ),
};

export const Empty: Story = {
  render: () => <AgentDockStory seats={[]} />,
};

export const EdgeStrip: Story = {
  render: () => <AgentDockStory seats={agentSeats("chief", "research", "sales")} edgeStrip />,
};

export const EdgeStripQuiet: Story = {
  render: () => <AgentDockStory seats={agentSeats("chief", "sales")} edgeStrip />,
};
