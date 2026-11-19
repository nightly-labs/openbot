import { SideQuestionPanel } from "@openbot/ui/features/conversation/SideQuestionPanel";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT, STORY_AGENTS } from "./fixtures";

const ANSWER = [
  "A step that one person can start today without asking anyone.",
  "",
  "- **Not clear:** “Work on the launch post.”",
  "- **Clear:** “The writer sends the first draft of the launch post to Research by Thursday.”",
].join("\n");

const meta = {
  title: "Conversation/SideQuestionPanel",
  component: SideQuestionPanel,
  args: {
    agent: STORY_AGENT,
    agents: STORY_AGENTS,
    exchanges: [],
    error: null,
    draft: "",
    focusRequest: 0,
    onDraftChange: fn(),
    onAsk: fn(),
    onClosePanel: fn(),
    onOpenLink: fn(),
  },
  render: (args) => {
    const [draft, setDraft] = createSignal(args.draft);
    return (
      <div class="conversation-panel" style="height: 100vh; --browser-panel-width: 420px">
        <SideQuestionPanel
          {...args}
          draft={draft()}
          onDraftChange={(value) => {
            setDraft(value);
            args.onDraftChange(value);
          }}
        />
      </div>
    );
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof SideQuestionPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Answered: Story = {
  args: {
    exchanges: [
      {
        id: "side-question-1",
        question: "What counts as a clear next action? Give one example.",
        askedAt: "2026-10-16T10:14:00.000Z",
        answer: ANSWER,
        answeredAt: "2026-10-16T10:14:20.000Z",
      },
    ],
  },
};

export const Asking: Story = {
  args: {
    exchanges: [
      {
        id: "side-question-1",
        question: "Who owns the launch post?",
        askedAt: "2026-10-16T10:14:00.000Z",
        answer: null,
        answeredAt: null,
      },
    ],
  },
};

export const Failed: Story = {
  args: {
    draft: "Who owns the launch post?",
    error: "The agent could not answer the side question. Try again.",
  },
};
