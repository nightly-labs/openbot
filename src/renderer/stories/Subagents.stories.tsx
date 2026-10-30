import type { ConversationSubagent, ConversationSubagentStep } from "@openbot/contracts/ipc";
import { SubagentGroup, SubagentPanel } from "@openbot/ui/features/conversation/Subagents";
import { createSignal, onSettled, untrack } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

/*
 * The subagents that an agent starts in one turn: Claude `Agent` calls and Codex `spawnAgent`
 * calls. The chat shows one card for each turn; a click on a row opens its steps in the side panel.
 */

const STARTED = Date.now();

function at(secondsAgo: number): string {
  return new Date(STARTED - secondsAgo * 1_000).toISOString();
}

function steps(id: string, items: [ConversationSubagentStep["kind"], string][]): ConversationSubagentStep[] {
  return items.map(([kind, text], index) => ({ id: `${id}:${index}`, kind, text }));
}

const PRICING = steps("pricing", [
  ["thinking", "The pricing page probably reads its limits from a shared plan table. I find that first."],
  ["search", "agentLimit"],
  ["read", "apps/auth-api/src/components/pricing/PricingPage.tsx"],
  ["read", "packages/contracts/src/plans.ts"],
  ["thinking", "The page shows “5 agents” for Pro, but the contract allows 10. The page has its own copy."],
  ["search", "5 agents"],
  ["read", "apps/auth-api/src/components/pricing/plan-copy.ts"],
  [
    "text",
    "Two differences. Pro: the page says 5 agents, the contract allows 10 (plan-copy.ts:18). Team: the page says 20 agents, the contract allows 25 (plan-copy.ts:31).",
  ],
]);

const COMPETITORS = steps("competitors", [
  ["thinking", "Prices change often, so I use the pricing pages and not news articles."],
  ["web", "AI agent app team plan price per seat"],
  ["web", "https://example.com/pricing"],
  ["edit", "competitor-prices.md"],
  ["text", "I found public prices for 3 of the 5 apps. Two apps ask you to contact sales."],
]);

const NOTES = steps("notes", [
  ["thinking", "The notes come from changelog.d, one file per pull request."],
  ["command", "git log v0.41.0..HEAD --oneline"],
  ["read", "changelog.d"],
  ["edit", "release-notes-0.42.md"],
  ["text", "The draft has 12 entries in 3 groups: New, Better and Fixed."],
]);

const STAGING = steps("staging", [
  ["thinking", "The staging Worker writes its logs to Cloudflare. I read them with Wrangler."],
  ["command", "wrangler tail openbot-staging --format=json"],
]);

function subagent(
  id: string,
  title: string,
  all: ConversationSubagentStep[],
  shown: number,
  status: ConversationSubagent["status"],
  options: { agentType?: string; startedSecondsAgo: number; endedSecondsAgo?: number; error?: string },
): ConversationSubagent {
  return {
    id,
    title,
    agentType: options.agentType ?? "general-purpose",
    prompt: `${title}. Give the file and line of each finding. Do not change files.`,
    status,
    startedAt: at(options.startedSecondsAgo),
    endedAt: status === "running" ? null : at(options.endedSecondsAgo ?? 0),
    steps: all.slice(0, shown),
    error: options.error ?? null,
  };
}

const RUNNING: ConversationSubagent[] = [
  subagent("pricing", "Check the pricing page against the plan limits", PRICING, 3, "running", {
    agentType: "Explore",
    startedSecondsAgo: 48,
  }),
  subagent(
    "competitors",
    "Collect the team plan prices of comparable agent apps, with the source of each price",
    COMPETITORS,
    2,
    "running",
    { startedSecondsAgo: 46 },
  ),
  subagent("notes", "Draft the release notes for 0.42", NOTES, NOTES.length, "completed", {
    startedSecondsAgo: 130,
    endedSecondsAgo: 31,
  }),
];

const FINISHED: ConversationSubagent[] = [
  subagent("pricing", "Check the pricing page against the plan limits", PRICING, PRICING.length, "completed", {
    agentType: "Explore",
    startedSecondsAgo: 160,
    endedSecondsAgo: 70,
  }),
  subagent("notes", "Draft the release notes for 0.42", NOTES, NOTES.length, "completed", {
    startedSecondsAgo: 130,
    endedSecondsAgo: 31,
  }),
  subagent("staging", "Check the staging deploy logs", STAGING, STAGING.length, "failed", {
    startedSecondsAgo: 120,
    endedSecondsAgo: 90,
    error: "The token has no access to openbot-staging (403).",
  }),
  subagent("competitors", "Collect the team plan prices of comparable agent apps", COMPETITORS, 2, "stopped", {
    startedSecondsAgo: 110,
    endedSecondsAgo: 60,
  }),
];

const meta = {
  title: "Conversation/Subagents",
  component: SubagentGroup,
  render: (args) => {
    const [selected, setSelected] = createSignal<string | null>(untrack(() => args.selectedId ?? null));
    return (
      <main style={{ width: "min(760px, 100vw)", padding: "var(--openbot-space-4)" }}>
        <SubagentGroup
          {...args}
          selectedId={selected()}
          onOpen={(id) => setSelected((current) => (current === id ? null : id))}
        />
      </main>
    );
  },
  args: { subagents: RUNNING, onOpen: () => undefined },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof SubagentGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two subagents work. The list is open, and the ring shows how many finished. */
export const Running: Story = {};

/** All subagents ended. The list is closed, and the chip counts the results. */
export const Finished: Story = { args: { subagents: FINISHED } };

/** The row of the subagent that the side panel shows. */
export const Selected: Story = { args: { selectedId: "pricing" } };

/** The side panel pane of one subagent: its task, its state, and all of its steps. */
export const Panel: Story = {
  render: () => (
    <div style={{ position: "relative", width: "420px", height: "640px", display: "flex" }}>
      <SubagentPanel subagent={RUNNING[0]} agentName="Chief" onClosePanel={() => undefined} />
    </div>
  ),
};

/** A failed subagent shows its error under its steps. */
export const PanelFailed: Story = {
  render: () => (
    <div style={{ position: "relative", width: "420px", height: "640px", display: "flex" }}>
      <SubagentPanel subagent={FINISHED[2]} agentName="Chief" onClosePanel={() => undefined} />
    </div>
  ),
};

/** The subagents work through their steps, then end. The loop repeats. */
export const Live: Story = {
  render: () => {
    const [tick, setTick] = createSignal(0);
    const last = PRICING.length + 6;
    onSettled(() => {
      const timer = window.setInterval(() => setTick((value) => (value >= last ? 0 : value + 1)), 900);
      return () => window.clearInterval(timer);
    });
    const subagents = (): ConversationSubagent[] => {
      const step = tick();
      const pricingDone = step >= PRICING.length;
      const competitorsDone = step >= COMPETITORS.length + 1;
      return [
        subagent(
          "pricing",
          "Check the pricing page against the plan limits",
          PRICING,
          Math.min(step + 1, PRICING.length),
          pricingDone ? "completed" : "running",
          { agentType: "Explore", startedSecondsAgo: 20 },
        ),
        subagent(
          "competitors",
          "Collect the team plan prices of comparable agent apps",
          COMPETITORS,
          Math.min(step, COMPETITORS.length),
          competitorsDone ? "completed" : "running",
          { startedSecondsAgo: 18 },
        ),
      ];
    };
    const [selected, setSelected] = createSignal<string | null>(null);
    return (
      <main style={{ width: "min(760px, 100vw)", padding: "var(--openbot-space-4)" }}>
        <SubagentGroup
          subagents={subagents()}
          selectedId={selected()}
          onOpen={(id) => setSelected((current) => (current === id ? null : id))}
        />
      </main>
    );
  },
};
