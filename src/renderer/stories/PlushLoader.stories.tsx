import { PlushLoader, Text } from "@openbot/ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Foundations/PlushLoader",
  component: PlushLoader,
  args: { size: 48, layout: "row", label: "Loading billing" },
  argTypes: {
    size: { control: { type: "range", min: 16, max: 200, step: 4 } },
    layout: { control: "inline-radio", options: ["row", "stack"] },
  },
  parameters: { a11y: { test: "error" } },
} satisfies Meta<typeof PlushLoader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Panel: Story = {};

export const Inline: Story = {
  render: () => (
    <div class="foundation-story-row">
      <PlushLoader size={32} />
      <Text tone="secondary">Waiting for GitHub</Text>
    </div>
  ),
};

export const Stack: Story = { args: { size: 132, layout: "stack" } };
