import { translateFor } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import { createRootRoute, createRoute, createRouter, RouterContextProvider } from "@tanstack/solid-router";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import "../../styles.css";
import { siteText } from "../../lib/site-text";
import { SiteTextProvider } from "../landing/SiteText";
import { CreditsPage } from "./CreditsPage";
import { creditsPageText } from "./credits-page-text";
import { STORY_CATALOG } from "./credits-story-catalog";

const rootRoute = createRootRoute();
rootRoute.addChildren(
  [
    "/",
    "/news",
    "/guides",
    "/marketplace",
    "/marketplace/apps",
    "/download",
    "/changelog",
    "/compare",
    "/compare/$slug",
    "/providers",
    "/providers/$slug",
    "/teams",
    "/pricing",
    "/credits",
    "/contact",
    "/app",
    "/privacy",
    "/terms",
  ].map((path) => createRoute({ getParentRoute: () => rootRoute, path })),
);
const router = createRouter({ routeTree: rootRoute });

function WithRouter(props: { children: () => JSX.Element }) {
  return (
    <RouterContextProvider router={router}>
      {() => (
        <SiteTextProvider chrome={{ lang: "en", dir: "ltr", locale: "en", text: siteText(translateFor("en")) }}>
          {props.children()}
        </SiteTextProvider>
      )}
    </RouterContextProvider>
  );
}

const meta = {
  title: "Site/Credits page",
  component: CreditsPage,
  args: { text: creditsPageText(translateFor("en")), lang: "en", catalog: STORY_CATALOG },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  render: (args) => <WithRouter>{() => <CreditsPage {...args} />}</WithRouter>,
} satisfies Meta<typeof CreditsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const PricesNotLoaded: Story = { args: { catalog: [] } };
