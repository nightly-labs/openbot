import type { AgentProfileDraft } from "@openbot/contracts/ipc";
import { fireEvent, fn, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AgentProfileSetup } from "../src/features/agents/AgentProfileSetup";

const profile: AgentProfileDraft = {
  name: "Research partner",
  title: "Science researcher",
  description:
    "Find primary sources, compare evidence, and explain uncertainty clearly. Cite sources for factual claims.",
  avatarSeed: "profile:research",
  avatarHue: 215,
  sectionId: "research",
};
const meta = {
  title: "Setup/AgentProfileSetup",
  component: AgentProfileSetup,
  args: {
    sections: [
      { id: "research", name: "Research" },
      { id: "personal", name: "Personal" },
    ],
    generate: fn(async () => ({ ...profile })),
    save: fn(async () => undefined),
    onClose: fn(),
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AgentProfileSetup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Prompt: Story = {};
export const Review: Story = {
  args: { initialDraft: profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await fireEvent.input(canvas.getByRole("textbox", { name: "Describe your agent" }), {
      target: { value: "Help me research scientific questions using primary sources. Put the agent in Research." },
    });
    await fireEvent.click(canvas.getByRole("button", { name: "Generate profile" }));
  },
};
export const Generating: Story = {
  args: { generate: () => new Promise<AgentProfileDraft>(() => undefined) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await fireEvent.input(canvas.getByRole("textbox", { name: "Describe your agent" }), {
      target: { value: "Help me research scientific questions." },
    });
    await fireEvent.click(canvas.getByRole("button", { name: "Generate profile" }));
  },
};
export const Failure: Story = {
  args: {
    initialDraft: profile,
    generate: async () => {
      throw new Error("The provider disconnected. Try again.");
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await fireEvent.input(canvas.getByRole("textbox", { name: "Describe your agent" }), {
      target: { value: "Focus on climate science." },
    });
    await fireEvent.click(canvas.getByRole("button", { name: "Generate profile" }));
  },
};
