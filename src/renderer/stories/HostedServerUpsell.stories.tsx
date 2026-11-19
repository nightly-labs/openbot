import { HostedServerUpsellDialog } from "@openbot/ui/features/servers/HostedServerUpsellDialog";
import { HostedServerUpsellNotice } from "@openbot/ui/features/servers/HostedServerUpsellNotice";
import { ServerConnectionNotice } from "@openbot/ui/features/servers/ServerConnectionNotice";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Servers/Hosted server upsell",
  parameters: {
    a11y: { test: "error" },
    viewport: {
      options: {
        upsellPhone: { name: "Phone — 390 × 844", styles: { width: "390px", height: "844px" } },
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Modal: Story = {
  render: () => <HostedServerUpsellDialog routine={{ name: "Morning brief" }} onSeePlans={fn()} onClose={fn()} />,
};

export const ModalLongName: Story = {
  render: () => (
    <HostedServerUpsellDialog
      routine={{ name: "Weekly launch review for the whole product team" }}
      onSeePlans={fn()}
      onClose={fn()}
    />
  ),
};

export const ModalWebNarrow: Story = {
  globals: { viewport: { value: "upsellPhone", isRotated: false } },
  render: () => <HostedServerUpsellDialog routine={{ name: "Morning brief" }} onSeePlans={fn()} onClose={fn()} />,
};

export const NoticeThisComputer: Story = {
  render: () => <HostedServerUpsellNotice count={3} host="this-computer" onSeePlans={fn()} onDismiss={fn()} />,
};

export const NoticeRemoteComputer: Story = {
  render: () => <HostedServerUpsellNotice count={1} host={{ name: "Studio Mac" }} onSeePlans={fn()} onDismiss={fn()} />,
};

export const OfflineNotice: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <ServerConnectionNotice
      name="Studio Mac"
      phase="waiting"
      initial
      remainingSeconds={20}
      onRetry={fn()}
      upsell={{ onSeePlans: fn() }}
    />
  ),
};

export const OfflineNoticeCompact: Story = {
  render: () => (
    <ServerConnectionNotice
      name="Studio Mac"
      phase="waiting"
      initial={false}
      remainingSeconds={20}
      onRetry={fn()}
      upsell={{ onSeePlans: fn() }}
    />
  ),
};
