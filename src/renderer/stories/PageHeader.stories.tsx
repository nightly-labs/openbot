import { Button } from "@openbot/ui";
import { PageHeader } from "@openbot/ui/features/window/PageHeader";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

/*
 * The header of a full page. Tasks, Usage and Schedule show a title; a detail page of Settings or the
 * Marketplace shows the path to it. In the app window, the header is the top row: the page rail is
 * the way back and the server menu names the server.
 */

const meta = {
  title: "Window/PageHeader",
  component: PageHeader,
  parameters: { layout: "padded", a11y: { test: "error" } },
  args: { title: "Tasks" },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A page with no way back: the title only. */
export const Title: Story = {};

/** A narrow window has no page rail, so the header shows Back and the server. */
export const BackAndServer: Story = {
  args: { hostName: "Studio Mac", onBack: fn() },
};

/** The app window: the same page has no Back button and no server name. */
export const WindowFrame: Story = {
  args: { hostName: "Studio Mac", onBack: fn(), frame: "window" },
};

/** The controls of the page go at the end. */
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

/** A detail page: each parent goes back to its page. */
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

/** A long path: the parents and the title get shorter, and the separators keep their size. */
export const LongPath: Story = {
  args: {
    title: "A provider with a very long name that does not fit in the row",
    path: [{ title: "Providers and models of this computer", onSelect: fn() }],
  },
  decorators: [(Story) => <div style={{ width: "320px" }}>{Story()}</div>],
};
