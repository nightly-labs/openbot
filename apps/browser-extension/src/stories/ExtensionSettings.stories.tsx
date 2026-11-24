import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SITES_KEY } from "../client-browser-messages";
import { SettingsScreen } from "../SettingsScreen";
import { PanelFrame } from "./story-frame";
import { installStoryChrome } from "./story-server";

const meta = {
  title: "Extension/Settings",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const SITES = {
  "https://news.ycombinator.com": "always",
  "https://docs.google.com": "always",
  "https://linear.app": "always",
  "https://www.a-very-long-subdomain-name.example-shop.co.uk": "always",
};

function Settings(props: { linked: boolean; sharing?: boolean; sites?: boolean }) {
  installStoryChrome({
    "openbot.analytics.v1": { enabled: props.linked, at: 0 },
    ...(props.sites === false ? {} : { [SITES_KEY]: SITES }),
  });
  return (
    <PanelFrame>
      <SettingsScreen sharing={props.sharing ?? true} onBack={() => undefined} onAnalyticsChanged={() => undefined} />
    </PanelFrame>
  );
}

export const AnalyticsLinked: Story = { render: () => <Settings linked /> };

export const AnalyticsNotLinked: Story = { render: () => <Settings linked={false} /> };

export const NoAllowedSites: Story = { render: () => <Settings linked sites={false} /> };

export const ServerWithoutSharedTabs: Story = { render: () => <Settings linked sharing={false} /> };
