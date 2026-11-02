import { type AgentStep, AgentStepsDisclosure } from "@openbot/ui/features/conversation/AgentSteps";
import { type TraceSpan, TraceWaterfall } from "@openbot/ui/features/conversation/TraceWaterfall";
import { createMemo, createSignal, onSettled } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

/*
 * The trace of an agent's turn: each model call, tool call, wait and handoff as a bar on one
 * timeline. The steps row of a finished turn opens it in a dialog. These stories use fixtures.
 */

/** A span of the fixture turn, with its times in ms after the turn started. */
interface FixtureSpan extends Omit<TraceSpan, "start" | "end"> {
  from: number;
  to: number;
}

const TURN: readonly FixtureSpan[] = [
  {
    id: "agent",
    icon: "agent",
    parentId: null,
    name: "Mira",
    detail: "Sonnet 5.5",
    kind: "model",
    from: 0,
    to: 38_600,
  },
  {
    id: "think-1",
    icon: "thinking",
    parentId: "agent",
    name: "Thinking",
    detail: "Sonnet 5.5",
    kind: "model",
    from: 0,
    to: 3_200,
    tokens: 1_840,
    costUsd: 0.011,
  },
  {
    id: "read-1",
    icon: "read",
    parentId: "agent",
    name: "read",
    detail: "turn-steps.ts",
    kind: "tool",
    from: 3_300,
    to: 3_900,
  },
  {
    id: "search-1",
    icon: "search",
    parentId: "agent",
    name: "search",
    detail: "itemCreatedAt",
    kind: "tool",
    from: 3_900,
    to: 5_100,
  },
  {
    id: "think-2",
    icon: "thinking",
    parentId: "agent",
    name: "Thinking",
    detail: "Sonnet 5.5",
    kind: "model",
    from: 5_200,
    to: 8_400,
    tokens: 2_210,
    costUsd: 0.014,
  },
  { id: "handoff", parentId: "agent", name: "Start 2 subagents", kind: "handoff", from: 8_500, to: 9_000 },
  {
    id: "explore",
    icon: "agent",
    parentId: "agent",
    name: "Explore",
    detail: "Haiku 5.5",
    kind: "model",
    from: 9_000,
    to: 21_400,
  },
  {
    id: "explore-think",
    icon: "thinking",
    parentId: "explore",
    name: "Thinking",
    detail: "Haiku 5.5",
    kind: "model",
    from: 9_100,
    to: 10_900,
    tokens: 960,
    costUsd: 0.001,
  },
  {
    id: "explore-search",
    icon: "search",
    parentId: "explore",
    name: "search",
    detail: "AgentSteps",
    kind: "tool",
    from: 11_000,
    to: 13_400,
  },
  {
    id: "explore-read-1",
    icon: "read",
    parentId: "explore",
    name: "read",
    detail: "AgentSteps.tsx",
    kind: "tool",
    from: 13_500,
    to: 14_100,
  },
  {
    id: "explore-read-2",
    icon: "read",
    parentId: "explore",
    name: "read",
    detail: "Subagents.tsx",
    kind: "tool",
    from: 14_100,
    to: 14_800,
  },
  {
    id: "explore-summary",
    icon: "text",
    parentId: "explore",
    name: "Summary",
    detail: "Haiku 5.5",
    kind: "model",
    from: 14_900,
    to: 21_400,
    tokens: 2_480,
    costUsd: 0.004,
  },
  {
    id: "review",
    icon: "agent",
    parentId: "agent",
    name: "Review",
    detail: "Sonnet 5.5",
    kind: "model",
    from: 9_000,
    to: 31_000,
  },
  {
    id: "review-command",
    icon: "command",
    parentId: "review",
    name: "command",
    detail: "bun run typecheck:renderer",
    kind: "tool",
    from: 9_600,
    to: 26_800,
  },
  {
    id: "review-web",
    icon: "web",
    parentId: "review",
    name: "web",
    detail: "docs.solidjs.com",
    kind: "tool",
    failed: true,
    from: 26_900,
    to: 28_300,
  },
  {
    id: "review-summary",
    icon: "text",
    parentId: "review",
    name: "Summary",
    detail: "Sonnet 5.5",
    kind: "model",
    from: 28_400,
    to: 31_000,
    tokens: 1_720,
    costUsd: 0.012,
  },
  { id: "wait", parentId: "agent", name: "Wait for subagents", kind: "waiting", from: 9_000, to: 31_000 },
  {
    id: "answer",
    icon: "text",
    parentId: "agent",
    name: "Answer",
    detail: "Sonnet 5.5",
    kind: "model",
    from: 31_200,
    to: 38_600,
    tokens: 3_900,
    costUsd: 0.031,
  },
];

const TURN_LENGTH = 38_600;

/** The turn as it is `elapsed` ms after it started at `origin`: later spans are not there yet. */
function spansAt(origin: number, elapsed: number): TraceSpan[] {
  return TURN.filter((span) => span.from <= elapsed).map(({ from, to, ...span }) => ({
    ...span,
    start: origin + from,
    end: to <= elapsed ? origin + to : null,
  }));
}

const ORIGIN = Date.UTC(2026, 9, 24, 9, 30);
const FINISHED = spansAt(ORIGIN, TURN_LENGTH);
const FINISHED_NOW = ORIGIN + TURN_LENGTH;

/** A clock for the story. It moves `now` each second, as the caller does in the app. */
function createStoryClock() {
  const [now, setNow] = createSignal(Date.now());
  onSettled(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  });
  return now;
}

const meta = {
  title: "Conversation/TraceWaterfall",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A finished turn with two subagents and one failed tool call. */
export const Finished: Story = {
  render: () => (
    <div style={{ width: "1000px", height: "640px", display: "flex" }}>
      <TraceWaterfall spans={FINISHED} now={FINISHED_NOW} keyboard="mac" />
    </div>
  ),
};

/** A running turn. The open spans grow to the "now" line, and the turn starts again at its end. */
export const Live: Story = {
  render: () => {
    const now = createStoryClock();
    const origin = Date.now() - 12_000;
    const elapsed = () => (now() - origin) % (TURN_LENGTH + 4_000);
    const spans = createMemo(() => spansAt(now() - elapsed(), elapsed()));
    return (
      <div style={{ width: "1000px", height: "640px", display: "flex" }}>
        <TraceWaterfall spans={spans()} now={now()} keyboard="mac" />
      </div>
    );
  },
};

/** A search that matches nothing. */
export const NoMatches: Story = {
  render: () => (
    <div style={{ width: "1000px", height: "520px", display: "flex" }}>
      <TraceWaterfall spans={FINISHED} now={FINISHED_NOW} keyboard="pc" defaultQuery="deploy" />
    </div>
  ),
};

/** A narrow trace. The step names get less room, and the timeline keeps the rest. */
export const Narrow: Story = {
  render: () => (
    <div style={{ width: "420px", height: "640px", display: "flex" }}>
      <TraceWaterfall spans={FINISHED} now={FINISHED_NOW} keyboard="mac" />
    </div>
  ),
};

/** The steps of the fixture turn that the steps row lists: its own thoughts and tool calls. */
const STEPS: AgentStep[] = TURN.filter((span) => span.parentId === "agent" && span.icon !== "agent").flatMap(
  (span): AgentStep[] => {
    if (span.icon === "thinking") return [{ id: span.id, kind: "thinking", text: span.name }];
    if (span.kind === "tool") return [{ id: span.id, kind: "progress", text: `${span.name} ${span.detail ?? ""}` }];
    return [];
  },
);

/**
 * The placement: the steps row of a finished turn opens the trace in a dialog. A click on one of the
 * turn's own steps closes it and shows that step in the list.
 */
export const FromStepsRow: Story = {
  render: () => (
    <div style={{ width: "640px" }}>
      <AgentStepsDisclosure
        steps={STEPS}
        defaultOpen={false}
        trace={{ spans: () => FINISHED, keyboard: "mac" }}
        facts={{ durationMs: TURN_LENGTH, failed: FINISHED.filter((span) => span.failed).length }}
      />
    </div>
  ),
};
