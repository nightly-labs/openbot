import { ConversationHeader } from "@openbot/ui/features/conversation/ConversationHeader";
import { ThreadHeader } from "@openbot/ui/features/conversation/threads/ThreadHeader";
import {
  DRAFT_THREAD_ID,
  MAIN_THREAD_ID,
  type ThreadItem,
  type ThreadStatus,
} from "@openbot/ui/features/conversation/threads/thread-types";
import { createStore } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT, STORY_AGENT_STATUS, STORY_MODELS, storyRuntimeSettings } from "./fixtures";
import "./agent-threads-story.css";

const IDLE: ThreadStatus = { kind: "idle" };

function item(id: string, title: string, minutesAgo: number, status: ThreadStatus = IDLE): ThreadItem {
  const updatedAt = new Date(Date.parse("2026-08-19T10:00:00.000Z") - minutesAgo * 60_000).toISOString();
  return { id, kind: "side", title, updatedAt, status };
}

/** When the agent's own chat changed last. The new thread tab shows this time. */
const MAIN_UPDATED_AT = "2026-08-19T10:00:00.000Z";

const STATES: ThreadItem[] = [
  item("pricing", "Pricing page copy", 2),
  item("competitors", "Competitor scan", 10, { kind: "working" }),
  item("deploy", "Deploy the docs site", 14, { kind: "waiting", reason: "approval" }),
  item("links", "Check broken links", 30, { kind: "queued" }),
  item("release", "Release notes draft", 20, { kind: "failed" }),
];

const MANY: ThreadItem[] = [
  ...STATES,
  item("onboarding", "Onboarding email sequence for the new trial plan", 40),
  item("faq", "FAQ answers", 50),
  item("press", "Press kit", 60),
  item("survey", "Customer survey summary", 70),
  item("roadmap", "Q4 roadmap notes", 80),
];

const ARCHIVED: ThreadItem[] = [
  item("old-onboarding", "Old onboarding copy", 1440),
  item("launch", "Launch checklist", 2880),
];

interface HeaderFixture {
  threads: ThreadItem[];
  open: string[];
  active?: string;
  archived?: ThreadItem[];
  canStartNew?: boolean;
  /** A host with `agent-tasks-v1` only cannot rename or delete a thread. */
  editable?: boolean;
  narrow?: boolean;
}

/** The chat header with a thread row whose actions change a local copy of the threads. */
function ThreadHeaderStory(props: HeaderFixture) {
  const [state, setState] = createStore({
    threads: props.threads,
    archived: props.archived ?? [],
    open: props.open,
    active: props.active ?? MAIN_THREAD_ID,
    draft: false,
  });
  const byId = (id: string) => state.threads.find((thread) => thread.id === id);
  const tabs = (): ThreadItem[] => {
    const open = state.open.flatMap((id) => byId(id) ?? []);
    const draft: ThreadItem[] = state.draft
      ? [{ id: DRAFT_THREAD_ID, kind: "draft", title: "New thread", updatedAt: MAIN_UPDATED_AT, status: IDLE }]
      : [];
    return [...open, ...draft];
  };
  /** The tab order with the agent's own chat first, which has no tab: closing the first tab opens it. */
  const order = () => [MAIN_THREAD_ID, ...tabs().map((tab) => tab.id)];
  const setOrder = (next: string[], active: string) =>
    setState((draft) => {
      draft.open = next.filter((id) => id !== MAIN_THREAD_ID && id !== DRAFT_THREAD_ID);
      draft.draft = next.includes(DRAFT_THREAD_ID);
      draft.active = active;
    });
  const close = (id: string) => {
    const index = order().indexOf(id);
    const next = order().filter((entry) => entry !== id);
    setOrder(next, state.active === id ? (next[Math.max(0, index - 1)] ?? MAIN_THREAD_ID) : state.active);
  };
  const open = (id: string) =>
    setState((draft) => {
      if (id !== MAIN_THREAD_ID && id !== DRAFT_THREAD_ID && !draft.open.includes(id)) draft.open.push(id);
      draft.active = id;
    });
  const renameThread = (id: string, title: string) =>
    setState((draft) => {
      const thread = draft.threads.find((entry) => entry.id === id);
      if (thread) thread.title = title;
    });
  const deleteThread = (id: string) => {
    close(id);
    setState((draft) => {
      draft.threads = draft.threads.filter((entry) => entry.id !== id);
    });
  };
  const editable = props.editable ?? true;
  const rename = editable ? renameThread : undefined;
  const remove = editable ? deleteThread : undefined;
  return (
    <div class="thread-header-story" data-narrow={props.narrow ? "" : undefined}>
      <ConversationHeader
        agent={STORY_AGENT}
        onSettingsIntent={fn()}
        onOpenSettings={fn()}
        onOpenChat={state.active === MAIN_THREAD_ID ? undefined : () => open(MAIN_THREAD_ID)}
        modelPicker={{
          provider: storyRuntimeSettings(STORY_AGENT).provider,
          value: STORY_AGENT.model,
          reasoningEffort: STORY_AGENT.reasoningEffort,
          modelOptions: STORY_MODELS,
          agentStatus: STORY_AGENT_STATUS,
          onChange: fn(),
          onReasoningEffortChange: fn(),
        }}
        sidePanel={{ open: false, onToggle: fn() }}
        threads={
          <ThreadHeader
            threads={state.threads}
            tabs={tabs()}
            archived={state.archived}
            activeId={state.active}
            canStartNew={props.canStartNew ?? true}
            onOpen={open}
            onNew={() =>
              setState((draft) => {
                draft.draft = true;
                draft.active = DRAFT_THREAD_ID;
              })
            }
            onClose={close}
            onCloseOthers={(id) => setOrder([MAIN_THREAD_ID, ...(id === MAIN_THREAD_ID ? [] : [id])], id)}
            onCloseToTheRight={(id) => {
              const next = order().slice(0, order().indexOf(id) + 1);
              setOrder(next, next.includes(state.active) ? state.active : id);
            }}
            onMove={(id, index) => {
              // The index is among the shown tabs, without the agent's own chat.
              const next = tabs()
                .map((tab) => tab.id)
                .filter((entry) => entry !== id);
              next.splice(index, 0, id);
              setOrder(next, state.active);
            }}
            onArchive={(id) => {
              const thread = byId(id);
              close(id);
              if (!thread) return;
              setState((draft) => {
                draft.threads = draft.threads.filter((entry) => entry.id !== id);
                draft.archived.unshift(thread);
              });
            }}
            onRestore={(id) => {
              const thread = state.archived.find((entry) => entry.id === id);
              if (!thread) return;
              setState((draft) => {
                draft.archived = draft.archived.filter((entry) => entry.id !== id);
                draft.threads.push(thread);
              });
              open(id);
            }}
            onRename={rename}
            onDelete={remove}
          />
        }
      />
    </div>
  );
}

const meta = {
  title: "Conversation/Thread header",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The agent has only its own chat: the header shows "New thread" and nothing more. */
export const OwnChatOnly: Story = { render: () => <ThreadHeaderStory threads={[]} open={[]} /> };

/** One tab for each state: done, working, waiting for an approval, queued and failed. */
export const States: Story = {
  render: () => <ThreadHeaderStory threads={STATES} open={STATES.map((thread) => thread.id)} active="pricing" />,
};

/** More tabs than the header has space for: the tabs scroll, and the open tab stays in view. */
export const ManyTabs: Story = {
  render: () => <ThreadHeaderStory threads={MANY} open={MANY.map((thread) => thread.id)} active="roadmap" />,
};

/** Archived threads show under "Archived" in the thread list. Opening one restores it. */
export const Archived: Story = {
  render: () => <ThreadHeaderStory threads={STATES.slice(0, 2)} open={["pricing"]} archived={ARCHIVED} />,
};

/** A host with `agent-tasks-v1` only: the tab menu has no rename and no delete. */
export const NoRenameOrDelete: Story = {
  render: () => <ThreadHeaderStory threads={STATES} open={["pricing", "competitors"]} editable={false} />,
};

/** At the limit of threads: "New thread" is off. */
export const AtLimit: Story = {
  render: () => <ThreadHeaderStory threads={STATES} open={["pricing"]} canStartNew={false} />,
};

/** A narrow window: the tabs become one button with the open thread. */
export const Narrow: Story = {
  render: () => <ThreadHeaderStory threads={STATES} open={["pricing", "competitors"]} active="pricing" narrow />,
};
