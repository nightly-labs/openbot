import { ThreadsPane } from "@openbot/ui/features/conversation/threads/ThreadsPane";
import {
  DRAFT_THREAD_ID,
  MAIN_THREAD_ID,
  type ThreadItem,
  type ThreadStatus,
} from "@openbot/ui/features/conversation/threads/thread-types";
import { createStore } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import "./agent-threads-story.css";

const IDLE: ThreadStatus = { kind: "idle" };
const NOW = Date.now();

function item(id: string, title: string, minutesAgo: number, extra: Partial<ThreadItem> = {}): ThreadItem {
  return {
    id,
    kind: "side",
    title,
    updatedAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
    status: IDLE,
    ...extra,
  };
}

const THREADS: ThreadItem[] = [
  item("deploy", "Deploy the docs site", 2, { status: { kind: "waiting", reason: "approval" } }),
  item("competitors", "Competitor scan", 6, { status: { kind: "working" } }),
  item("competitors-pricing", "Compare their pricing tiers", 8, {
    status: { kind: "queued" },
    stem: { through: [], last: true },
  }),
  item("pricing", "Pricing page copy", 25, { unread: 2 }),
  item("release", "Release notes draft", 90, { status: { kind: "failed" } }),
  item("onboarding", "Onboarding email sequence for the new trial plan and the annual discount", 1440),
  item("faq", "FAQ answers", 2880),
];

function ThreadsPaneStory(props: { threads: ThreadItem[]; active?: string; beside?: string[]; canStartNew?: boolean }) {
  const [state, setState] = createStore({ active: props.active ?? MAIN_THREAD_ID, beside: props.beside ?? [] });
  return (
    <div class="threads-pane-story">
      <ThreadsPane
        threads={props.threads}
        activeId={state.active}
        besideIds={state.beside}
        canStartNew={props.canStartNew ?? true}
        onOpen={(id) =>
          setState((draft) => {
            draft.beside = draft.beside.filter((entry) => entry !== id);
            draft.active = id;
          })
        }
        onToggleBeside={(id) =>
          setState((draft) => {
            if (draft.beside.includes(id)) {
              draft.beside = draft.beside.filter((entry) => entry !== id);
              draft.active = id;
              return;
            }
            draft.beside.push(id);
            if (draft.active === id) draft.active = MAIN_THREAD_ID;
          })
        }
        onNew={fn()}
      />
    </div>
  );
}

const meta = {
  title: "Conversation/Threads pane",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {
  render: () => <ThreadsPaneStory threads={THREADS} active="pricing" beside={["competitors"]} />,
};

export const WithDraft: Story = {
  render: () => (
    <ThreadsPaneStory
      threads={[item(DRAFT_THREAD_ID, "New thread", 0, { kind: "draft" }), ...THREADS]}
      active={DRAFT_THREAD_ID}
    />
  ),
};

export const Empty: Story = { render: () => <ThreadsPaneStory threads={[]} /> };

export const EmptyAtLimit: Story = { render: () => <ThreadsPaneStory threads={[]} canStartNew={false} /> };
