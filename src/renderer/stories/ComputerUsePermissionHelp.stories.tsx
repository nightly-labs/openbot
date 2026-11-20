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

function MockedHelp(props: {
  permission: MacPermissionId;
  granted?: readonly MacPermissionId[];
  app?: string | null;
  sunshine?: boolean;
}) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot();
  mock.api.computerUse.getState = async () => state(props.granted ?? []);
  const name = props.app === undefined ? "Electron" : props.app;
  mock.api.computerUse.getPermissionApp = async () => (name ? { name, iconDataUrl: null } : null);
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    window.openbot = previousApi;
  });
  return <ComputerUsePermissionHelp permission={props.permission} sunshine={props.sunshine} />;
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

export const Granted: Story = {
  render: () => <MockedHelp permission="accessibility" granted={["accessibility"]} />,
};

export const WithoutApplication: Story = {
  render: () => <MockedHelp permission="screen-recording" app={null} />,
};

export const Sunshine: Story = {
  render: () => <MockedHelp permission="accessibility" app="Sunshine" sunshine />,
};
