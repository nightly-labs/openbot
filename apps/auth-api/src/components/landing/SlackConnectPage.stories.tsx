import type { Meta, StoryObj } from "storybook-solidjs-vite";
// The site's stylesheet, loaded only when a site story opens. See `ArticleMedia.stories.tsx`.
import "../../styles.css";
import { SlackConnectView } from "./SlackConnectPage";

const meta = {
  title: "Site/Slack connect page",
  component: SlackConnectView,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof SlackConnectView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** After the install: one action, in the middle of the card. */
export const ReturnToOpenBot: Story = {
  args: { openUrl: "openbot://slack-workspace?nonce=example&grant=example", failure: null },
};

export const WorkspaceTaken: Story = {
  args: { openUrl: "", failure: "slack_workspace_taken" },
};

export const Failed: Story = {
  args: { openUrl: "", failure: "slack_failed" },
};
