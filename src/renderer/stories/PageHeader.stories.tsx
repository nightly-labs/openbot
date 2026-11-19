import { Button } from "@openbot/ui";
import { PageHeader } from "@openbot/ui/features/window/PageHeader";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Window/PageHeader",
  component: PageHeader,
  parameters: { layout: "padded", a11y: { test: "error" } },
  args: { title: "Tasks" },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Title: Story = {};

export const BackAndServer: Story = {
  args: { hostName: "Studio Mac", onBack: fn() },
};

export const WindowFrame: Story = {
  args: { hostName: "Studio Mac", onBack: fn(), frame: "window" },
};

export const WindowFrameControls: Story = {
  args: { title: "Usage", onBack: fn(), frame: "window" },
  render: (args) => (
    <PageHeader {...args}>
      <Button variant="outline" size="sm">
        Last 7 days
      </Button>
    </PageHeader>
  ),
};

export const Controls: Story = {
  args: { title: "Usage", hostName: "Studio Mac", onBack: fn() },
  render: (args) => (
    <PageHeader {...args}>
      <Button variant="outline" size="sm">
        Last 7 days
      </Button>
    </PageHeader>
  ),
};

export const Path: Story = {
  args: {
    title: "GitHub",
    pathLabel: "Path",
    path: [
      { title: "Apps", onSelect: fn() },
      { title: "Developer tools", onSelect: fn() },
    ],
  },
};

export const LongPath: Story = {
  args: {
    title: "A provider with a very long name that does not fit in the row",
    path: [{ title: "Providers and models of this computer", onSelect: fn() }],
  },
  decorators: [(Story) => <div style={{ width: "320px" }}>{Story()}</div>],
};
