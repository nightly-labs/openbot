import type { ComputerUseState, MacPermissionId } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ComputerUseMacSetup } from "../src/features/computer-use/ComputerUseMacSetup";
import { createMockOpenBot } from "./mock-openbot";

function permissions(granted: readonly MacPermissionId[]): ComputerUseState["permissions"] {
  return (["screen-recording", "accessibility"] as const).map((id) => ({ id, granted: granted.includes(id) }));
}

const permissionsRequired: ComputerUseState = {
  status: "permissions-required",
  permissions: permissions([]),
  message: null,
};

function MockedSetup(props: { state?: ComputerUseState; error?: Error; loading?: boolean }) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot();
  mock.api.getComputerUseState = props.loading
    ? () => new Promise(() => undefined)
    : props.error
      ? async () => {
          throw props.error;
        }
      : async () => props.state ?? permissionsRequired;
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    window.openbot = previousApi;
  });
  return (
    <main class="foundation-story foundation-interaction-stage">
      <ComputerUseMacSetup platform="darwin" variant="compact" />
    </main>
  );
}

const meta = {
  title: "Settings/ComputerUseMacSetup",
  component: ComputerUseMacSetup,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof ComputerUseMacSetup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PermissionsRequired: Story = {
  render: () => <MockedSetup />,
};

export const PartlyGranted: Story = {
  render: () => <MockedSetup state={{ ...permissionsRequired, permissions: permissions(["screen-recording"]) }} />,
};

export const Ready: Story = {
  render: () => (
    <MockedSetup
      state={{ status: "ready", permissions: permissions(["screen-recording", "accessibility"]), message: null }}
    />
  ),
};

export const Loading: Story = {
  render: () => <MockedSetup loading />,
};

export const DriverMissing: Story = {
  render: () => (
    <MockedSetup
      state={{
        status: "driver-missing",
        permissions: permissions([]),
        message: "Install the Computer Use driver, then check again.",
      }}
    />
  ),
};

export const Failure: Story = {
  render: () => <MockedSetup error={new Error("OpenBot could not check Computer Use.")} />,
};
