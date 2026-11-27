import type { CentralAuthUser } from "@openbot/contracts/ipc";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ConnectingScreen } from "../ConnectingScreen";
import { PanelFrame } from "./story-frame";

const meta = {
  title: "Extension/Connecting",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const USER: CentralAuthUser = { id: "user-story", email: "ola.nowak@example.com", name: "Ola Nowak", avatarUrl: null };

const CURRENT = host("host-openbot", "OpenBot");

const HOSTS: RemoteTeamHost[] = [CURRENT, host("host-studio", "Studio VPS"), host("host-kasia", "Kasia's MacBook Pro")];

function host(hostId: string, name: string): RemoteTeamHost {
  return {
    hostId,
    name,
    logoKey: null,
    devicePublicKey: "story-key",
    membershipId: `membership-${hostId}`,
    role: "owner",
  };
}

function Connecting(props: { hosts: RemoteTeamHost[]; failure?: string }) {
  return (
    <PanelFrame>
      <ConnectingScreen
        hosts={props.hosts}
        host={CURRENT}
        user={USER}
        failure={props.failure ?? null}
        onSelectHost={() => undefined}
        onRetry={() => undefined}
        onSignOut={() => undefined}
      />
    </PanelFrame>
  );
}

export const ConnectingToServer: Story = { render: () => <Connecting hosts={HOSTS} /> };

export const OneServer: Story = { render: () => <Connecting hosts={[CURRENT]} /> };

export const ServerOffline: Story = { render: () => <Connecting hosts={HOSTS} failure="OpenBot is offline." /> };

export const UpdateRequired: Story = {
  render: () => <Connecting hosts={HOSTS} failure="OpenBot needs an update to work with this extension." />,
};
