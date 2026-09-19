import type { ComputerUseState } from "@openbot/contracts/ipc";
import { fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockOpenBot, type MockOpenBotControls } from "../../preview/mock-openbot";
import { ComputerUseSetup } from "./ComputerUseSetup";

let mock: MockOpenBotControls | undefined;
const previousApi = window.openbot;

afterEach(() => {
  mock?.dispose();
  mock = undefined;
  window.openbot = previousApi;
  vi.restoreAllMocks();
});

function state(overrides: Partial<ComputerUseState>): ComputerUseState {
  return {
    status: "permissions-required",
    permissions: [
      { id: "screen-recording", granted: false },
      { id: "accessibility", granted: false },
    ],
    message: null,
    ...overrides,
  };
}

describe("ComputerUseSetup", () => {
  it("opens the pane for the permission whose button was pressed", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const openPane = vi.spyOn(mock.api, "openComputerUsePermissionPane");
    const view = render(() => <ComputerUseSetup platform="darwin" variant="settings" />);

    const section = (await view.findByRole("heading", { name: "System permissions" })).closest("section");
    if (!section) throw new Error("The System permissions section is missing.");
    const [screenRecording] = within(section).getAllByRole("button", { name: "Open settings" });
    await fireEvent.click(screenRecording);

    await waitFor(() => expect(openPane).toHaveBeenCalledWith("screen-recording"));
  });

  it("replaces a granted permission's button with a badge", async () => {
    mock = createMockOpenBot();
    mock.api.getComputerUseState = vi.fn().mockResolvedValue(
      state({
        permissions: [
          { id: "screen-recording", granted: true },
          { id: "accessibility", granted: false },
        ],
      }),
    );
    window.openbot = mock.api;
    const view = render(() => <ComputerUseSetup platform="darwin" variant="compact" />);

    expect(await view.findByText("Granted")).toBeInTheDocument();
    expect(view.getAllByRole("button", { name: "Open settings" })).toHaveLength(1);
  });

  it("names the install command when this computer has no driver", async () => {
    mock = createMockOpenBot();
    mock.api.getComputerUseState = vi.fn().mockResolvedValue(state({ status: "driver-missing" }));
    window.openbot = mock.api;
    const view = render(() => <ComputerUseSetup platform="darwin" variant="compact" />);

    expect(await view.findByText("Install the Computer Use driver")).toBeInTheDocument();
    expect(view.getByText(/cua\.ai\/driver\/install\.sh/)).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Open settings" })).not.toBeInTheDocument();
  });

  // Each desktop has its own installer, and a command for the wrong shell cannot be run.
  it("names the Windows installer on Windows", async () => {
    mock = createMockOpenBot();
    mock.api.getComputerUseState = vi.fn().mockResolvedValue(state({ status: "driver-missing", permissions: [] }));
    window.openbot = mock.api;
    const view = render(() => <ComputerUseSetup platform="win32" variant="compact" />);

    expect(await view.findByText(/cua\.ai\/driver\/install\.ps1/)).toBeInTheDocument();
    expect(view.queryByText(/install\.sh/)).not.toBeInTheDocument();
  });

  // Windows and Linux put no permission between OpenBot and the desktop. An empty list must read as
  // ready, and must draw no row naming a macOS setting the user cannot find.
  it("reports ready without permission rows where the system grants none", async () => {
    mock = createMockOpenBot();
    mock.api.getComputerUseState = vi.fn().mockResolvedValue(state({ status: "ready", permissions: [] }));
    window.openbot = mock.api;
    const view = render(() => <ComputerUseSetup platform="linux" variant="settings" />);

    expect(await view.findByText("Computer Use is ready")).toBeInTheDocument();
    expect(view.queryByText("Screen Recording")).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Open settings" })).not.toBeInTheDocument();
  });
});
