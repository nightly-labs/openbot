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
    const view = render(() => <ComputerUseSetup variant="settings" />);

    const section = (await view.findByRole("heading", { name: "System permissions" })).closest("section");
    if (!section) throw new Error("The System permissions section is missing.");
    const screenRecording = within(section).getByRole("button", { name: "Grant Screen Recording" });
    await fireEvent.click(screenRecording);

    await waitFor(() => expect(openPane).toHaveBeenCalledWith("screen-recording"));
  });

  it("keeps the way back to System Settings on a permission already granted", async () => {
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
    const view = render(() => <ComputerUseSetup variant="compact" />);

    expect(await view.findByText("Granted")).toBeInTheDocument();
    // Both rows, the granted one included: a grant is taken away in the same pane it is given in.
    // The granted row asks for nothing, so it reads "Manage" rather than "Grant".
    expect(view.getByRole("button", { name: "Manage Screen Recording" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Grant Accessibility" })).toBeInTheDocument();
  });

  // A grant is given in System Settings, outside this window. The driver reports only what it sees
  // when it is asked, so a panel that never asks again keeps a row the user has already granted.
  it("offers Check again, and asks the driver again when the window comes back", async () => {
    mock = createMockOpenBot();
    const read = vi
      .fn()
      .mockResolvedValueOnce(state({}))
      .mockResolvedValue(state({ status: "ready", permissions: [{ id: "screen-recording", granted: true }] }));
    mock.api.getComputerUseState = read;
    window.openbot = mock.api;
    const view = render(() => <ComputerUseSetup variant="compact" />);

    await view.findByRole("button", { name: "Check again" });
    fireEvent(window, new Event("focus"));

    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(await view.findByText("Granted")).toBeInTheDocument();
    // Still offered once everything is granted: macOS takes a grant away as easily as it gives one.
    expect(view.getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });

  // Every release carries the driver, so a build without one is a broken build and not a thing the
  // user installs by hand. The panel must name no command, on any desktop.
  it("reports a build with no driver as a fault, and offers no command to run", async () => {
    mock = createMockOpenBot();
    mock.api.getComputerUseState = vi
      .fn()
      .mockResolvedValue(
        state({ status: "driver-missing", message: "This build of OpenBot carries no Computer Use driver." }),
      );
    window.openbot = mock.api;
    const view = render(() => <ComputerUseSetup variant="compact" />);

    expect(await view.findByText("Computer Use isn’t available yet")).toBeInTheDocument();
    expect(view.getByText("This build of OpenBot carries no Computer Use driver.")).toBeInTheDocument();
    expect(view.queryByText(/cua\.ai\/driver\/install/)).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  // Windows and Linux put no permission between OpenBot and the desktop. An empty list must read as
  // ready, and must draw no row naming a macOS setting the user cannot find.
  it("reports ready without permission rows where the system grants none", async () => {
    mock = createMockOpenBot();
    mock.api.getComputerUseState = vi.fn().mockResolvedValue(state({ status: "ready", permissions: [] }));
    window.openbot = mock.api;
    const view = render(() => <ComputerUseSetup variant="settings" />);

    expect(await view.findByText("Computer Use is ready")).toBeInTheDocument();
    expect(view.queryByText("Screen Recording")).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Grant Screen Recording" })).not.toBeInTheDocument();
  });
});
