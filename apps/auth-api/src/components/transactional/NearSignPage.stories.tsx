import { translateFor } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import { createRootRoute, createRoute, createRouter, RouterContextProvider } from "@tanstack/solid-router";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import "../../styles.css";
import type { NearSignRequest } from "../../lib/near-sign-request";
import { siteText } from "../../lib/site-text";
import { SiteTextProvider } from "../landing/SiteText";
import { NearSignView } from "./NearSignPage";
import { nearSignText } from "./page-text";

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

const REGISTER: NearSignRequest = {
  kind: "register",
  nonce: "story",
  summary: "",
  challenge: "story-challenge",
  userId: "story-user",
  port: null,
};

const CHECK_BACKUP: NearSignRequest = {
  kind: "sign",
  nonce: "story",
  action: "check-backup",
  summary: "",
  payload: {
    challenge: "story-challenge",
    rpId: "passkeywallet.openbot.run",
    allowCredentials: [{ id: "story-credential", type: "public-key" }],
    userVerification: "required",
    timeout: 120_000,
  },
  port: null,
};

const meta = {
  title: "Site/NEAR sign page",
  component: NearSignView,
  args: {
    lang: "en",
    text: nearSignText(translateFor("en")),
    state: { step: "ready", request: REGISTER },
    onStart: () => undefined,
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  render: (args) => <WithRouter>{() => <NearSignView {...args} />}</WithRouter>,
} satisfies Meta<typeof NearSignView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CreatePasskey: Story = {};

export const CreatePasskeyWorking: Story = {
  args: { state: { step: "working", request: REGISTER } },
};

export const CreatePasskeyCancelled: Story = {
  args: { state: { step: "failed", request: REGISTER, failure: "cancelled" } },
};

export const PasskeyCreated: Story = {
  args: { state: { step: "done", request: REGISTER, returnUrl: "openbot://near-signature?nonce=story" } },
};

export const CheckBackup: Story = {
  args: { state: { step: "ready", request: CHECK_BACKUP } },
};
