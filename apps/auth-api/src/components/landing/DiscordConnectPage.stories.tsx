import type { Meta, StoryObj } from "storybook-solidjs-vite";
// The site's stylesheet, loaded only when a site story opens. See `ArticleMedia.stories.tsx`.
import "../../styles.css";
import { DiscordConnectView } from "./DiscordConnectPage";

const meta = {
  title: "Site/Discord connect page",
  component: DiscordConnectView,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof DiscordConnectView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** After the install: one action, in the middle of the card. */
export const ReturnToOpenBot: Story = {
  args: { openUrl: "openbot://discord-guild?nonce=example&grant=example", failure: null },
};

export const GuildTaken: Story = {
  args: { openUrl: "", failure: "discord_guild_taken" },
};

export const Failed: Story = {
  args: { openUrl: "", failure: "discord_failed" },
};
