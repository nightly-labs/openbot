import type { UpdateStatus } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitUpdateStatus, installOpenbotStub } from "../../app-test-harness";
import { DesktopUpdateScreen } from "./DesktopUpdateScreen";
import { UpdatesProvider, useUpdates } from "./updates-context";
import { writeUpdateAttempt } from "./updates-port";

const ready: UpdateStatus = {
  phase: "ready",
  currentVersion: "0.1.0",
  availableVersion: "0.2.0",
  progress: 100,
  checkedAt: null,
  message: null,
  errorCode: null,
};

function Reopen() {
  const updates = useUpdates();
  return <Button onClick={() => void updates.openAction()}>Open update</Button>;
}
function mount() {
  return render(() => (
    <UpdatesProvider>
      <Reopen />
      <DesktopUpdateScreen />
    </UpdatesProvider>
  ));
}

beforeEach(() => {
  installOpenbotStub();
  window.localStorage.clear();
  vi.mocked(window.openbot.update.getStatus).mockResolvedValue(ready);
});

describe("desktop update flow", () => {
  it("dismisses, reopens, installs once, and recovers from an install failure", async () => {
    mount();
    const restart = await screen.findByRole("button", { name: "Restart to update" });
    await waitFor(() => expect(restart).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Open update" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restart to update" }));
    await waitFor(() => expect(window.openbot.update.install).toHaveBeenCalledOnce());
    emitUpdateStatus?.({ ...ready, phase: "installing" });
    expect(await screen.findByRole("heading", { name: "Restarting…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart to update" })).not.toBeInTheDocument();
    emitUpdateStatus?.({ ...ready, phase: "error", errorCode: "install_failed" });
    expect(await screen.findByRole("heading", { name: "The update did not install" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each([
    ["0.2.0", "Up to date"],
    ["0.1.0", "The update was interrupted"],
  ])("checks the running version %s after relaunch", async (currentVersion, heading) => {
    writeUpdateAttempt("0.2.0");
    vi.mocked(window.openbot.update.getStatus).mockResolvedValue({ ...ready, phase: "idle", currentVersion });
    mount();
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps a newer event when the initial status request finishes late", async () => {
    let resolveStatus: (status: UpdateStatus) => void = () => undefined;
    vi.mocked(window.openbot.update.getStatus).mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    mount();
    await waitFor(() => expect(window.openbot.update.onEvent).toHaveBeenCalled());
    emitUpdateStatus?.(ready);
    expect(await screen.findByRole("heading", { name: "Update ready" })).toBeInTheDocument();
    resolveStatus({ ...ready, phase: "idle" });
    await Promise.resolve();
    expect(screen.getByRole("heading", { name: "Update ready" })).toBeInTheDocument();
  });
});
