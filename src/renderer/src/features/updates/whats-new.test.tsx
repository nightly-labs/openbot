import { Button } from "@openbot/ui";
import type { WhatsNewRelease } from "@openbot/ui/features/updates/whats-new";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installOpenbotStub } from "../../app-test-harness";
import { PlatformProvider } from "../../platform";
import { WhatsNewOverlay } from "./WhatsNewOverlay";
import { useWhatsNew, WhatsNewProvider } from "./whats-new-context";
import { WHATS_NEW_VERSION_KEY } from "./whats-new-history";
import { whatsNewReleasesSchema } from "./whats-new-releases";
import notes from "./whats-new-releases.json";

const whatsNewReleases = whatsNewReleasesSchema.parse(notes);

function Controls() {
  const notes = useWhatsNew();
  return (
    <>
      <Button onClick={notes.reopen}>Open release notes</Button>
      <WhatsNewOverlay ready />
    </>
  );
}

function mount(loadReleases: () => Promise<readonly WhatsNewRelease[]> = async () => whatsNewReleases) {
  return render(() => (
    <PlatformProvider>
      <WhatsNewProvider loadReleases={loadReleases}>
        <Controls />
      </WhatsNewProvider>
    </PlatformProvider>
  ));
}

beforeEach(() => {
  localStorage.clear();
  installOpenbotStub();
  vi.mocked(window.openbot.getAppInfo).mockResolvedValue({
    name: "OpenBot",
    version: "0.34.1",
    platform: "darwin",
    variant: "dev",
  });
});
afterEach(cleanup);

describe("post-update notes", () => {
  it("records a first install without a dialog and permits manual opening", async () => {
    mount();
    await waitFor(() => expect(localStorage.getItem(WHATS_NEW_VERSION_KEY)).toBe("0.34.1"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open release notes" }));
    expect(await screen.findByRole("dialog", { name: "What’s new in OpenBot" })).toBeInTheDocument();
    expect(await screen.findByText("The message box stays at the bottom of the chat again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Full changelog" }));
    expect(window.openbot.openUrl).toHaveBeenCalledWith("https://openbot.run/changelog");
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("merges skipped releases and persists once per version across remounts and downgrades", async () => {
    localStorage.setItem("openbot:analytics-app-version", "0.33.0");
    const view = mount();
    expect(await screen.findByText("See your routines on a canvas.")).toBeInTheDocument();
    expect(screen.getByText("The message box stays at the bottom of the chat again.")).toBeInTheDocument();
    expect(localStorage.getItem(WHATS_NEW_VERSION_KEY)).toBe("0.34.1");
    view.unmount();
    const load = vi.fn(async () => whatsNewReleases);
    const current = mount(load);
    await screen.findByRole("button", { name: "Open release notes" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
    current.unmount();
    vi.mocked(window.openbot.getAppInfo).mockResolvedValue({
      name: "OpenBot",
      version: "0.34.0",
      platform: "darwin",
      variant: "dev",
    });
    mount(load);
    await screen.findByRole("button", { name: "Open release notes" });
    expect(localStorage.getItem(WHATS_NEW_VERSION_KEY)).toBe("0.34.1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("silently consumes an empty update and shows the empty state on manual open", async () => {
    localStorage.setItem(WHATS_NEW_VERSION_KEY, "0.34.0");
    mount(async () => []);
    await waitFor(() => expect(localStorage.getItem(WHATS_NEW_VERSION_KEY)).toBe("0.34.1"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open release notes" }));
    expect(
      await screen.findByText("This version has no notes to show here. The full changelog shows all changes."),
    ).toBeInTheDocument();
  });

  it("shows a failure once and retries without blocking close", async () => {
    localStorage.setItem(WHATS_NEW_VERSION_KEY, "0.34.0");
    const load = vi
      .fn<() => Promise<readonly WhatsNewRelease[]>>()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(whatsNewReleases);
    mount(load);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("The message box stays at the bottom of the chat again.")).toBeInTheDocument();
    expect(localStorage.getItem(WHATS_NEW_VERSION_KEY)).toBe("0.34.1");
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows required steps and lets the reader expand and collapse a long fix list", async () => {
    const release: WhatsNewRelease = {
      version: "0.34.1",
      date: "2026-10-09",
      notices: ["Sign in again after the update."],
      groups: [{ type: "fixed", items: ["Fix one.", "Fix two.", "Fix three.", "Fix four."] }],
    };
    mount(async () => [release]);
    await waitFor(() => expect(localStorage.getItem(WHATS_NEW_VERSION_KEY)).toBe("0.34.1"));
    fireEvent.click(screen.getByRole("button", { name: "Open release notes" }));
    expect(await screen.findByText("Sign in again after the update.")).toBeInTheDocument();
    expect(screen.queryByText("Fix four.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 4 fixes" }));
    expect(await screen.findByText("Fix four.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide fixes" }));
    await waitFor(() => expect(screen.queryByText("Fix four.")).not.toBeInTheDocument());
  });

  it("does not reopen when a manual load finishes after close", async () => {
    const pending = Promise.withResolvers<readonly WhatsNewRelease[]>();
    mount(() => pending.promise);
    await waitFor(() => expect(localStorage.getItem(WHATS_NEW_VERSION_KEY)).toBe("0.34.1"));
    fireEvent.click(screen.getByRole("button", { name: "Open release notes" }));
    await screen.findByRole("dialog", { name: "What’s new in OpenBot" });
    expect(screen.getAllByText("Loading the release notes…").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    pending.resolve(whatsNewReleases);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
