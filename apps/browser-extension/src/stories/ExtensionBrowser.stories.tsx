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

function Home(props: { asks?: BrowserAsk[] }) {
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
            onAnalyticsChanged={() => undefined}
            sharing
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

export const AskNewSite: Story = {
  render: () => <Home asks={[ask("site", "click", 'button "Add to cart"', "https://shop.example.com")]} />,
};

export const AskPassword: Story = {
  render: () => <Home asks={[ask("password", "type", 'input password "Password"', "https://accounts.example.com")]} />,
};

export const AskDownload: Story = {
  render: () => <Home asks={[ask("download", "click", "invoice-2026-11.pdf", "https://billing.example.com")]} />,
};

export const AskSignInGrant: Story = {
  render: () => <Home asks={[ask("sign-in", "click", 'button "Authorize"', "https://github.com")]} />,
};

export const AskPaymentAndSite: Story = {
  render: () => (
    <Home
      asks={[
        ask("site", "snapshot", "", "https://news.ycombinator.com"),
        ask("payment", "type", 'input text "Card number"', "https://checkout.example.com"),
      ]}
    />
  ),
};
