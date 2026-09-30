import { Bot, Hash, Palette, Settings, Store } from "@openbot/ui";
import {
  GlobalSearch,
  type GlobalSearchAction,
  type GlobalSearchChannel,
  type GlobalSearchFile,
  type GlobalSearchPage,
  type GlobalSearchRoutine,
} from "@openbot/ui/components/GlobalSearch";
import type { AgentMessage, AgentProfile } from "@openbot/ui/data";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { requireFixture, STORY_AGENTS } from "../src/preview/fixtures";

const chief = requireFixture(STORY_AGENTS[0], "Chief agent");
const research = requireFixture(STORY_AGENTS[1], "Research agent");

function extraAgent(base: AgentProfile, id: string, name: string, hue: AgentProfile["avatarHue"]): AgentProfile {
  return { ...base, id, name, avatarSeed: id, avatarHue: hue, threadId: `thread-${id}` };
}

const agents: AgentProfile[] = [
  ...STORY_AGENTS,
  extraAgent(chief, "launch-planner", "Launch planner", 150),
  extraAgent(research, "product-research", "Product research", 100),
  extraAgent(chief, "design-critic", "Design critic", 215),
  extraAgent(chief, "release-notes", "Release notes", 245),
  extraAgent(research, "customer-signals", "Customer signals", 30),
];

function message(id: string, author: AgentMessage["author"], body: string, time: string): AgentMessage {
  return { id, author, body, time };
}

const messages: Array<{ agentId: string; message: AgentMessage }> = [
  {
    agentId: "research",
    message: message(
      "m1",
      "agent",
      "All four sources check out. The pricing link now points to the new page, and the research brief is updated.",
      "14:12",
    ),
  },
  { agentId: "research", message: message("m2", "you", "Can you research the three pricing tiers again?", "14:02") },
  {
    agentId: "sales",
    message: message("m3", "agent", "I added the research notes to the follow-up draft for Acme.", "Yesterday"),
  },
  {
    agentId: "product-research",
    message: message(
      "m4",
      "agent",
      "Before we start the interviews, here is a long note about scope, recruiting and incentives, and then the research plan for the new onboarding flow.",
      "Mon",
    ),
  },
  { agentId: "chief", message: message("m5", "you", "Ask @[Research](agent:research) for the summary.", "Mon") },
  {
    agentId: "customer-signals",
    message: message("m6", "agent", "Two research requests came from the support queue this week.", "Sep 12"),
  },
];

/** Pages of 100 from the offset in the cursor, as the conversation database gives them. */
function page<T>(items: T[], cursor: string | undefined, counted: boolean): GlobalSearchPage<T> {
  const offset = Number(cursor ?? 0);
  const end = offset + 100;
  return {
    results: items.slice(offset, end),
    ...(counted ? { total: items.length } : {}),
    nextCursor: end < items.length ? String(end) : null,
  };
}

async function searchMessages(query: string, cursor?: string) {
  const needle = query.toLocaleLowerCase();
  return page(
    messages.filter((item) => item.message.body.toLocaleLowerCase().includes(needle)),
    cursor,
    true,
  );
}

const channels: GlobalSearchChannel[] = [
  { id: "launch", name: "launch", detail: "Launch planner: The research review moves to Thursday." },
  { id: "research-desk", name: "research-desk", detail: "You: Please share the pricing sources." },
  { id: "support", name: "support" },
];

const files: GlobalSearchFile[] = [
  { id: "f1", name: "pricing-research.pdf", agentId: "research", messageId: "m1", time: "14:12" },
  { id: "f2", name: "interview-plan.md", agentId: "product-research", messageId: "m4", time: "Mon" },
  { id: "f3", name: "acme-follow-up.docx", agentId: "sales", messageId: "m3", time: "Yesterday" },
];

const routines: GlobalSearchRoutine[] = [
  { id: "r1", name: "Weekly research digest", agentId: "research", detail: "Research" },
  { id: "r2", name: "Morning brief", agentId: "chief", detail: "Chief" },
  { id: "r3", name: "Support triage", detail: "support" },
];

const actions: GlobalSearchAction[] = [
  { id: "new-agent", label: "New agent", group: "actions", icon: Bot, run: fn() },
  { id: "new-channel", label: "New channel", group: "actions", icon: Hash, run: fn() },
  { id: "marketplace", label: "Open marketplace", group: "actions", icon: Store, run: fn() },
  { id: "general", label: "General", detail: "App settings", group: "settings", icon: Settings, run: fn() },
  { id: "appearance", label: "Appearance", detail: "App settings", group: "settings", icon: Palette, run: fn() },
];

async function searchFiles(query: string, cursor?: string) {
  const needle = query.toLocaleLowerCase();
  return page(
    files.filter((file) => file.name.toLocaleLowerCase().includes(needle)),
    cursor,
    false,
  );
}

// Thousands of rows, for the virtual list and paging. Each page takes a moment, as over a network.
const hues = [30, 55, 100, 150, 185, 215, 245, 280, 320] as const;
const manyAgents = agents.concat(
  Array.from({ length: 400 }, (_, index) =>
    extraAgent(
      index % 2 ? chief : research,
      `agent-${index}`,
      `Research agent ${index + 1}`,
      hues[index % hues.length] ?? null,
    ),
  ),
);
const manyMessages = Array.from({ length: 2500 }, (_, index) => ({
  agentId: manyAgents[index % manyAgents.length]?.id ?? "research",
  message: message(
    `many-${index}`,
    index % 3 ? "agent" : "you",
    `Research note ${index + 1}: the pricing sources and the interview plan for week ${(index % 52) + 1}.`,
    `${(index % 12) + 1}:${String(index % 60).padStart(2, "0")}`,
  ),
}));
const manyFiles = Array.from(
  { length: 800 },
  (_, index): GlobalSearchFile => ({
    id: `many-file-${index}`,
    name: `research-${index + 1}.pdf`,
    agentId: manyAgents[index % manyAgents.length]?.id ?? "research",
    messageId: `many-${index}`,
    time: "Mon",
  }),
);

function slowly<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 300));
}

const args: Parameters<typeof GlobalSearch>[0] = {
  open: true,
  agents,
  channels,
  routines,
  actions,
  onSearchMessages: fn(searchMessages),
  onSearchFiles: fn(searchFiles),
  onOpenChange: fn(),
  onSelectAgent: fn(),
  onSelectChannel: fn(),
  onSelectMessage: fn(),
  onSelectRoutine: fn(),
};

const meta = {
  title: "Conversation/GlobalSearch",
  component: GlobalSearch,
  args,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof GlobalSearch>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Type "research" to see every group: agents, channels, messages, files, routines and settings. */
export const Default: Story = {};

/** The message search never answers, so a query shows the searching state. */
export const SearchingMessages: Story = {
  args: {
    onSearchMessages: fn(() => new Promise<GlobalSearchPage<{ agentId: string; message: AgentMessage }>>(() => {})),
  },
};

/**
 * 400 more agents, 2,500 messages and 800 files. Only the rows in view render. Type "research" and
 * open Messages or Files: the next page loads as the list comes near its end. Files do not count
 * their results, so the count shows "100+" until the last page.
 */
export const ManyResults: Story = {
  args: {
    agents: manyAgents,
    onSearchMessages: fn(async (query: string, cursor?: string) => {
      const needle = query.toLocaleLowerCase();
      return slowly(
        page(
          manyMessages.filter((item) => item.message.body.toLocaleLowerCase().includes(needle)),
          cursor,
          true,
        ),
      );
    }),
    onSearchFiles: fn(async (query: string, cursor?: string) => {
      const needle = query.toLocaleLowerCase();
      return slowly(
        page(
          manyFiles.filter((file) => file.name.toLocaleLowerCase().includes(needle)),
          cursor,
          false,
        ),
      );
    }),
  },
};

/** Only agents and messages, as on a web client host with no channels: no other filter shows. */
export const AgentsAndMessagesOnly: Story = {
  args: { channels: undefined, routines: undefined, actions: undefined, onSearchFiles: undefined },
};

export const NoAgents: Story = { args: { agents: [] } };
