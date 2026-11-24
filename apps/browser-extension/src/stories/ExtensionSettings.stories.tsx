import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SettingsScreen } from "../SettingsScreen";
import { PanelFrame } from "./story-frame";
import { installStoryChrome } from "./story-server";

const meta = {
  title: "Extension/Settings",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Settings(props: { linked: boolean }) {
  installStoryChrome({ "openbot.analytics.v1": { enabled: props.linked, at: 0 } });
  return (
    <PanelFrame>
      <SettingsScreen onBack={() => undefined} onAnalyticsChanged={() => undefined} />
    </PanelFrame>
  );
}

export const AnalyticsLinked: Story = { render: () => <Settings linked /> };

export const AnalyticsNotLinked: Story = { render: () => <Settings linked={false} /> };
