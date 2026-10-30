import { translateFor } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import { createRootRoute, createRoute, createRouter, RouterContextProvider } from "@tanstack/solid-router";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
// The site's stylesheet, loaded only when a site story opens. See `ArticleMedia.stories.tsx`.
import "../../styles.css";
import { LIST_PRICE_PLANS } from "../../lib/pricing-page";
import { PricingPage } from "./PricingPage";
import { pricingPageText } from "./pricing-page-text";

/**
 * The header and footer links need a router. The real route tree carries Worker-only modules, so this is
 * a small stand-in tree with the paths that the page links to. It is built at module level:
 * creating a router writes reactive state, which Solid refuses inside a component.
 */
const rootRoute = createRootRoute();
rootRoute.addChildren(
  [
    "/",
    "/news",
    "/guides",
    "/plugins",
    "/download",
    "/changelog",
    "/compare",
    "/compare/$slug",
    "/providers",
    "/providers/$slug",
    "/teams",
    "/pricing",
    "/contact",
    "/app",
  ].map((path) => createRoute({ getParentRoute: () => rootRoute, path })),
);
const router = createRouter({ routeTree: rootRoute });

function WithRouter(props: { children: () => JSX.Element }) {
  return <RouterContextProvider router={router}>{props.children}</RouterContextProvider>;
}

const meta = {
  title: "Site/Pricing page",
  component: PricingPage,
  args: {
    text: pricingPageText(translateFor("en")),
    offer: { plans: LIST_PRICE_PLANS, inEu: false },
    lang: "en",
    locale: "en",
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  render: (args) => <WithRouter>{() => <PricingPage {...args} />}</WithRouter>,
} satisfies Meta<typeof PricingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A visitor outside the EU: the total has no VAT text. */
export const OutsideEu: Story = {};

/** A visitor in the EU: the unit beside the total says "excl. VAT". */
export const InEu: Story = {
  args: { offer: { plans: LIST_PRICE_PLANS, inEu: true } },
};
