import { translateFor } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import { createRootRoute, createRoute, createRouter, RouterContextProvider } from "@tanstack/solid-router";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
// The site's stylesheet, loaded only when a site story opens. See `ArticleMedia.stories.tsx`.
import "../../styles.css";
import { MessagingConnectView } from "./MessagingConnectPage";
import { messagingConnectText } from "./page-text";

/**
 * The site header's links need a router. The real route tree carries Worker-only modules, so this is
 * a small stand-in tree, made at module level: a router writes reactive state, which Solid refuses
 * inside a component.
 */
const rootRoute = createRootRoute();
rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/" }),
  createRoute({ getParentRoute: () => rootRoute, path: "/news" }),
  createRoute({ getParentRoute: () => rootRoute, path: "/guides" }),
  createRoute({ getParentRoute: () => rootRoute, path: "/marketplace" }),
  createRoute({ getParentRoute: () => rootRoute, path: "/marketplace/apps" }),
  createRoute({ getParentRoute: () => rootRoute, path: "/download" }),
]);
const router = createRouter({ routeTree: rootRoute });

function WithRouter(props: { children: () => JSX.Element }) {
  return <RouterContextProvider router={router}>{props.children}</RouterContextProvider>;
}

const SLACK_TEXT = messagingConnectText(translateFor("en"), "slack");
const DISCORD_TEXT = messagingConnectText(translateFor("en"), "discord");

const meta = {
  title: "Site/Messaging connect page",
  component: MessagingConnectView,
  args: { provider: "slack", lang: "en", text: SLACK_TEXT, openUrl: "", failure: null },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  render: (args) => <WithRouter>{() => <MessagingConnectView {...args} />}</WithRouter>,
} satisfies Meta<typeof MessagingConnectView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** After a Slack install: one action, in the middle of the card. */
export const SlackReturnToOpenBot: Story = {
  args: { openUrl: "openbot://slack-workspace?nonce=example&grant=example" },
};

/** The browser client tab took the grant. */
export const SlackInBrowserClient: Story = {
  args: { webClient: true },
};

export const SlackWorkspaceTaken: Story = {
  args: { failure: "slack_workspace_taken" },
};

export const SlackCancelled: Story = {
  args: { failure: "access_denied" },
};

/** The browser client tab that started the install did not answer, so the browser action comes first. */
export const SlackTabClosed: Story = {
  args: { failure: "slack_tab_closed" },
};

/** A code that the page does not know shows the general message. */
export const SlackUnknownError: Story = {
  args: { failure: "slack_something_new" },
};

export const DiscordReturnToOpenBot: Story = {
  args: { provider: "discord", text: DISCORD_TEXT, openUrl: "openbot://discord-guild?nonce=example&grant=example" },
};

export const DiscordGuildTaken: Story = {
  args: { provider: "discord", text: DISCORD_TEXT, failure: "discord_guild_taken" },
};

export const DiscordSignInExpired: Story = {
  args: { provider: "discord", text: DISCORD_TEXT, failure: "discord_state_invalid" },
};
