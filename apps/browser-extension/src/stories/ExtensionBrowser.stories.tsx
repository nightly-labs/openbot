import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { BrowserAsks, BrowserSharingScreen } from "../BrowserSharing";
import { ASKS_KEY, type BrowserAsk, SITES_KEY } from "../client-browser-messages";
import { HomeScreen } from "../HomeScreen";
import { PanelFrame, WithWorkspace } from "./story-frame";
import { installStoryChrome } from "./story-server";

const meta = {
  title: "Extension/Shared tabs",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const HOST: RemoteTeamHost = {
  hostId: "host-home",
  name: "Home server",
  logoKey: null,
  devicePublicKey: "story-key",
  membershipId: "membership-host-home",
  role: "owner",
};

/** The home while the user shares tabs, with the approval cards that wait over it. */
function Home(props: { tabs: number; supported?: boolean; asks?: BrowserAsk[] }) {
  installStoryChrome(props.asks ? { [ASKS_KEY]: props.asks.map((ask) => ({ ...ask })) } : {});
  return (
    <WithWorkspace>
      {(workspace) => (
        <>
          <HomeScreen
            workspace={workspace}
            serverName={HOST.name}
            hosts={[HOST]}
            hostId={HOST.hostId}
            offline={false}
            onOpenAgent={() => undefined}
            onOpenChannel={() => undefined}
            onCreate={() => undefined}
            onStartThread={() => undefined}
            onSelectHost={() => undefined}
            onSignOut={() => undefined}
            sharing={{ tabs: props.tabs, supported: props.supported ?? true }}
            canShare
            onShareTabs={() => undefined}
            onManageSharing={() => undefined}
          />
          <BrowserAsks />
        </>
      )}
    </WithWorkspace>
  );
}

function ask(kind: BrowserAsk["kind"], action: BrowserAsk["action"], detail: string, site: string): BrowserAsk {
  return { id: `${kind}-${action}`, agentName: "Chief", site, kind, action, detail };
}

/** Sharing: the line on the home says how many tabs agents can use, and Manage opens the settings. */
export const SharingLine: Story = { render: () => <Home tabs={2} /> };

/** A server without `client-browser-v1`: the line asks for a server update. */
export const SharingServerTooOld: Story = { render: () => <Home tabs={1} supported={false} /> };

/** The settings: what agents may do, the sites allowed always (each with Remove), and Stop sharing. */
export const SettingsWithSites: Story = {
  render: () => {
    installStoryChrome({
      [SITES_KEY]: {
        "https://news.ycombinator.com": "always",
        "https://docs.google.com": "always",
        "https://www.a-very-long-subdomain-name.example-shop.co.uk": "always",
      },
    });
    return (
      <PanelFrame>
        <BrowserSharingScreen onBack={() => undefined} />
      </PanelFrame>
    );
  },
};

/** No site is allowed always yet: agents ask on each new site. */
export const SettingsNoSites: Story = {
  render: () => {
    installStoryChrome({});
    return (
      <PanelFrame>
        <BrowserSharingScreen onBack={() => undefined} />
      </PanelFrame>
    );
  },
};

/** An agent acts on a site for the first time: Allow once, Always for this site, or Deny. */
export const AskNewSite: Story = {
  render: () => <Home tabs={1} asks={[ask("site", "click", 'button "Add to cart"', "https://shop.example.com")]} />,
};

/** Typing into a password field asks every time, also on an allowed site. The card has no "Always". */
export const AskPassword: Story = {
  render: () => (
    <Home tabs={1} asks={[ask("password", "type", 'input password "Password"', "https://accounts.example.com")]} />
  ),
};

/** A click that starts a download asks every time; the card names the file. */
export const AskDownload: Story = {
  render: () => (
    <Home tabs={1} asks={[ask("download", "click", "invoice-2026-11.pdf", "https://billing.example.com")]} />
  ),
};

/** A page that looks like an OAuth grant asks before each click or key. */
export const AskSignInGrant: Story = {
  render: () => <Home tabs={1} asks={[ask("sign-in", "click", 'button "Authorize"', "https://github.com")]} />,
};

/** Payment fields ask like password fields. Two cards wait at once: the newest is last. */
export const AskPaymentAndSite: Story = {
  render: () => (
    <Home
      tabs={2}
      asks={[
        ask("site", "snapshot", "", "https://news.ycombinator.com"),
        ask("payment", "type", 'input text "Card number"', "https://checkout.example.com"),
      ]}
    />
  ),
};
