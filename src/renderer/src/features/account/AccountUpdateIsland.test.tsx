import type { UpdateStatus } from "@openbot/contracts/ipc";
import { AccountUpdateIsland } from "@openbot/ui/features/account/AccountUpdateIsland";
import { render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";

function updateStatus(phase: UpdateStatus["phase"]): UpdateStatus {
  return {
    phase,
    currentVersion: "0.1.0",
    availableVersion: "0.2.0",
    progress: null,
    checkedAt: "2026-08-12T22:00:00.000Z",
    message: null,
    errorCode: null,
  };
}

function renderIsland(initialPhase: UpdateStatus["phase"]) {
  const [phase, setPhase] = createSignal<UpdateStatus["phase"]>(initialPhase);
  render(() => <AccountUpdateIsland updateStatus={updateStatus(phase())} onUpdateAction={async () => {}} />);
  return setPhase;
}

// Closed, the island used to stay mounted at `opacity: 0` — a composited layer
// with a 12px backdrop-filter and a spinner rotating into it every frame, which
// measured ~10% of a core on an idle window. These cases pin the presence
// lifecycle that replaced it: absent when there is nothing to announce, and
// still there when a close is interrupted.
describe("AccountUpdateIsland", () => {
  it("stays out of the document while no update is pending", () => {
    renderIsland("idle");

    expect(screen.queryByText("New update available")).not.toBeInTheDocument();
  });

  it.each([
    ["a failed check, which found no update to offer", "check_failed" as const, false],
    ["a failed download, which still has an update to retry", "download_failed" as const, true],
    ["a failed install, which still has an update to retry", "install_failed" as const, true],
  ])("carries %s", (_label, errorCode, expected) => {
    // The island is one nowrap line that ellipsizes, so a sentence it would cut in half has to reach
    // the user through the account menu instead.
    render(() => (
      <AccountUpdateIsland
        updateStatus={{
          ...updateStatus("error"),
          errorCode,
          message: "Could not reach the update service. Check your internet connection, then try again.",
        }}
        onUpdateAction={async () => {}}
      />
    ));

    const shown = screen.queryByRole("button", { name: /Retry update/ }) !== null;
    expect(shown).toBe(expected);
  });

  it("leaves the document once the update is gone and the slide-out has run", async () => {
    vi.useFakeTimers();
    try {
      const setPhase = renderIsland("available");
      expect(await screen.findByText("New update available")).toBeInTheDocument();

      setPhase("idle");
      flush();
      vi.advanceTimersByTime(1_000);
      flush();

      expect(screen.queryByText("New update available")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives a close that a new update interrupts", async () => {
    vi.useFakeTimers();
    try {
      const setPhase = renderIsland("available");
      expect(await screen.findByText("New update available")).toBeInTheDocument();

      setPhase("idle");
      flush();
      vi.advanceTimersByTime(100);
      setPhase("available");
      flush();
      // Past the close hold. A timer left over from the interrupted close would
      // take away an island that is open again, and nothing would bring it back.
      vi.advanceTimersByTime(1_000);
      flush();

      expect(screen.queryByText("New update available")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
