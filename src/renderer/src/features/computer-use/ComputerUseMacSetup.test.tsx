import type { ComputerUseState } from "@openbot/contracts/ipc";
import { fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockOpenBot, type MockOpenBotControls } from "../../preview/mock-openbot";
import { ComputerUseMacSetup } from "./ComputerUseMacSetup";

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

describe("ComputerUseMacSetup", () => {
  it("opens the pane for the permission whose button was pressed", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const openPane = vi.spyOn(mock.api, "openComputerUsePermissionPane");
    const view = render(() => <ComputerUseMacSetup platform="darwin" variant="settings" />);

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
    const view = render(() => <ComputerUseMacSetup platform="darwin" variant="compact" />);

    expect(await view.findByText("Granted")).toBeInTheDocument();
    expect(view.getAllByRole("button", { name: "Open settings" })).toHaveLength(1);
  });

  it("names the install command when this computer has no driver", async () => {
    mock = createMockOpenBot();
    mock.api.getComputerUseState = vi.fn().mockResolvedValue(state({ status: "driver-missing" }));
    window.openbot = mock.api;
    const view = render(() => <ComputerUseMacSetup platform="darwin" variant="compact" />);

    expect(await view.findByText("Install the Computer Use driver")).toBeInTheDocument();
    expect(view.getByText(/cua\.ai\/driver\/install\.sh/)).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Open settings" })).not.toBeInTheDocument();
  });

  it("does not ask for Computer Use on other platforms", async () => {
    mock = createMockOpenBot();
    window.openbot = mock.api;
    const getState = vi.spyOn(mock.api, "getComputerUseState");
    const view = render(() => <ComputerUseMacSetup platform="win32" variant="compact" />);

    expect(view.container).toBeEmptyDOMElement();
    expect(getState).not.toHaveBeenCalled();
  });
});
