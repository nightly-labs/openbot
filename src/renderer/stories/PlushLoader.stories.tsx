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

/** A panel that loads. */
export const Panel: Story = {};

/** Beside the caption of a step in another app. Without a label, the loader is decoration. */
export const Inline: Story = {
  render: () => (
    <div class="foundation-story-row">
      <PlushLoader size={32} />
      <Text tone="secondary">Waiting for GitHub</Text>
    </div>
  ),
};

/** The balls under the plush, as on the history load screen. */
export const Stack: Story = { args: { size: 132, layout: "stack" } };
