import { ChoiceCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const choiceArgs: Parameters<typeof ChoiceCard>[0] = {
  title: "What should I help with first?",
  hint: "Choose a focus area for this agent.",
  choices: ["Work & projects", "Research & writing", "Sales & outreach"],
  customChoice: "Something else",
  onSubmit: async () => true,
};

const meta = {
  title: "Conversation/ChoiceCard",
  component: ChoiceCard,
  args: choiceArgs,
  decorators: [
    (Story) => (
      <main class="foundation-story">
        <Story />
      </main>
    ),
  ],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ChoiceCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Choices: Story = {};

export const Pending: Story = {
  args: { pending: true },
};

export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: "280px", "max-width": "100%" }}>
        <Story />
      </div>
    ),
  ],
};

export const LongContent: Story = {
  args: {
    title: "Which part of the project should the agent work on before the next team review?",
    hint: "Choose a suggested task, or enter the instructions that best fit your project.",
    choices: [
      "Review the account settings and document the changes needed for the next release",
      "Investigate the report from the customer support team",
      "Something else",
    ],
  },
};

export const CustomAnswer: Story = {
  args: { choices: [...choiceArgs.choices, "Something else"] },
};
