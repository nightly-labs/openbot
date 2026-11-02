import type { AgentPromptQuestion } from "@openbot/contracts/ipc";
import { QuestionPromptBubble } from "@openbot/ui/components/QuestionPromptBubble";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { StoryConversation } from "./conversation-story-support";

const singleQuestion: AgentPromptQuestion[] = [
  {
    id: "reply",
    header: "Message",
    question: "Want me to send that reply?",
    isSecret: false,
    options: [
      { label: "Send that reply", description: "Send the prepared message now." },
      { label: "Hold off", description: "Keep the draft without sending it." },
      { label: "Also message the second seller", description: "Send the same offer to both listings." },
    ],
  },
];

const multipleQuestions: AgentPromptQuestion[] = [
  {
    id: "approach",
    header: "Approach",
    question: "Which auth approach should we use?",
    isSecret: false,
    options: [
      { label: "Session cookies", description: "Best fit for the desktop session." },
      { label: "JWT bearer", description: "Useful for clients that manage their own token." },
      { label: "OAuth only", description: "Require an external identity provider." },
    ],
  },
  {
    id: "secrets",
    header: "Secrets",
    question: "Where should local development secrets live?",
    isSecret: false,
    options: [
      { label: "Environment file", description: "Keep secrets in an ignored local file." },
      { label: "Secrets manager", description: "Read secrets from a managed vault." },
      { label: "CI only", description: "Do not provide secrets to local runs." },
    ],
  },
  {
    id: "rollout",
    header: "Rollout",
    question: "How should we release the change?",
    isSecret: false,
    options: [
      { label: "Gradual rollout", description: "Start with a small group and expand." },
      { label: "Full release", description: "Enable the change for everyone at once." },
    ],
  },
];

const customQuestion: AgentPromptQuestion[] = [
  {
    id: "outcome",
    header: "Outcome",
    question: "What result should the agent produce?",
    isSecret: false,
    options: [
      { label: "Implementation plan", description: "Prepare a decision-complete plan." },
      { label: "Working prototype", description: "Build an interactive first version." },
    ],
  },
];

const multiSelectQuestion: AgentPromptQuestion[] = [
  {
    id: "checks",
    header: "Checks",
    question: "Which checks should run before the release?",
    isSecret: false,
    multiSelect: true,
    options: [
      { label: "Unit tests", description: "Run the test files of the changed code." },
      { label: "Type check", description: "Check the types of the changed projects." },
      { label: "Smoke test", description: "Start the app and try the new feature." },
    ],
  },
];

const secretQuestion: AgentPromptQuestion[] = [
  {
    id: "token",
    header: "Private answer",
    question: "Which temporary access token should the agent use?",
    isSecret: true,
    options: null,
  },
];

const meta = {
  title: "Conversation/QuestionPromptBubble",
  component: QuestionPromptBubble,
  args: {
    questions: singleQuestion,
    onSubmit: fn(async () => false),
  },
  // The bubble alone on a canvas. "In chat" sets `stage: false`, because the real chat fills the window.
  decorators: [
    (Story, context) =>
      context.parameters.stage === false ? (
        <Story />
      ) : (
        <main class="question-prompt-story-stage">
          <Story />
        </main>
      ),
  ],
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof QuestionPromptBubble>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The real chat with a pending prompt: the timeline, the header and the composer of the app. */
export const InChat: Story = {
  name: "In chat",
  args: { questions: multipleQuestions, onSubmit: fn(async () => true) },
  parameters: { stage: false },
  render: (args) => (
    <StoryConversation
      messages={[
        {
          id: "question-chat-user",
          author: "you",
          body: "Help me choose the safest auth setup for the launch.",
          time: "10:00",
          kind: "text",
        },
        {
          id: "question-chat-agent",
          author: "agent",
          body: "I need a few decisions before I finish the setup.",
          time: "10:01",
          kind: "text",
        },
      ]}
      prompt={{
        type: "prompt",
        requestId: "question-chat",
        agentId: "chief",
        threadId: "thread-chief",
        turnId: "turn-question-chat",
        questions: args.questions,
      }}
      onAnswerPrompt={args.onSubmit}
    />
  ),
};

export const SingleQuestion: Story = {};

export const MultipleQuestions: Story = {
  args: { questions: multipleQuestions },
};

export const CustomAnswer: Story = {
  args: { questions: customQuestion },
};

export const MultiSelect: Story = {
  args: { questions: multiSelectQuestion },
};

export const SecretAnswer: Story = {
  args: { questions: secretQuestion },
};

export const Sending: Story = {
  args: { pending: true },
};

export const Empty: Story = {
  args: { questions: [] },
};

export const Narrow: Story = {
  args: { questions: multipleQuestions },
  decorators: [
    (Story) => (
      <div class="question-prompt-story-narrow">
        <Story />
      </div>
    ),
  ],
};

export const PersistedAnswered: Story = {
  args: {
    questions: multipleQuestions,
    resolution: {
      status: "answered",
      responses: {
        approach: { status: "answered", answers: ["Session cookies"] },
        secrets: { status: "answered", answers: ["Environment file"] },
        rollout: { status: "skipped" },
      },
    },
  },
};

export const PersistedExpired: Story = {
  args: { questions: multipleQuestions, resolution: { status: "expired" } },
};

export const PersistedSingleAnswer: Story = {
  args: {
    questions: singleQuestion,
    resolution: {
      status: "answered",
      responses: { reply: { status: "answered", answers: ["Send that reply"] } },
    },
  },
};

export const PersistedPrivateAnswer: Story = {
  args: {
    questions: secretQuestion,
    resolution: {
      status: "answered",
      responses: { token: { status: "answered" } },
    },
  },
};

export const PersistedLongAnswer: Story = {
  args: {
    questions: [
      {
        id: "outcome",
        header: "Outcome",
        question:
          "What should the implementation plan include so that the team can review the authentication setup and release it safely?",
        isSecret: false,
        options: null,
      },
    ],
    resolution: {
      status: "answered",
      responses: {
        outcome: {
          status: "answered",
          answers: [
            "Prepare a technical brief with the proposed approach, risks, owners, and steps to reverse the release. Include this reference: authentication-session-cookie-configuration-and-release-verification-checklist.",
          ],
        },
      },
    },
  },
};

export const PersistedLongAnswerNarrow: Story = {
  ...PersistedLongAnswer,
  decorators: [
    (Story) => (
      <div class="question-prompt-story-narrow">
        <Story />
      </div>
    ),
  ],
};

export const PreviewOnly: Story = {
  args: { readOnly: true },
};
