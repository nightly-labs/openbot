import type { ComputerUseState, MacPermissionId } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ComputerUsePermissionHelp } from "../src/features/computer-use/ComputerUsePermissionHelp";
import { createMockOpenBot } from "./mock-openbot";

function state(granted: readonly MacPermissionId[]): ComputerUseState {
  return {
    status: granted.length === 2 ? "ready" : "permissions-required",
    permissions: (["screen-recording", "accessibility"] as const).map((id) => ({ id, granted: granted.includes(id) })),
    message: null,
  };
}

function MockedHelp(props: { permission: MacPermissionId; granted?: readonly MacPermissionId[]; app?: string | null }) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot();
  mock.api.getComputerUseState = async () => state(props.granted ?? []);
  const name = props.app === undefined ? "Electron" : props.app;
  mock.api.getComputerUsePermissionApp = async () => (name ? { name, iconDataUrl: null } : null);
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    window.openbot = previousApi;
  });
  // The surface fills its own window, which is 340 by 322. Nothing wraps it here for the same
  // reason nothing wraps it there.
  return <ComputerUsePermissionHelp permission={props.permission} />;
}

const meta = {
  title: "Settings/ComputerUsePermissionHelp",
  component: ComputerUsePermissionHelp,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof ComputerUsePermissionHelp>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ScreenRecording: Story = {
  render: () => <MockedHelp permission="screen-recording" />,
};

export const Accessibility: Story = {
  render: () => <MockedHelp permission="accessibility" />,
};

/** The grant landed while the user was in System Settings, which puts the accent on Done. */
export const Granted: Story = {
  render: () => <MockedHelp permission="accessibility" granted={["accessibility"]} />,
};

/** No bundle to drag, which is every build that does not run from an application. */
export const WithoutApplication: Story = {
  render: () => <MockedHelp permission="screen-recording" app={null} />,
};
