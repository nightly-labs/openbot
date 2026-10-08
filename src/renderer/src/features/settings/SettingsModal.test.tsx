import type { HostedServerList, HostedServerSummary } from "@openbot/contracts/hosted-servers";
import type {
  AccountSession,
  AppLogoColor,
  AvatarImageInput,
  CentralAuthUser,
  DesktopPlatform,
  MobileConnectedDevice,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { DEFAULT_GENERAL_SETTINGS } from "@openbot/ui/features/settings/app-settings";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockHostedServers } from "../../preview/mock-hosted-servers";
import { SettingsModal } from "./SettingsModal";
import { isOpenSettingsShortcut } from "./settings-shortcut";

const account: CentralAuthUser = {
  id: "user-1",
  email: "norbert@example.com",
  name: "Norbert",
  avatarUrl: null,
};

const idleUpdateStatus: UpdateStatus = {
  phase: "idle",
  currentVersion: "0.2.1",
  availableVersion: null,
  progress: null,
  checkedAt: null,
  message: null,
  errorCode: null,
};

/** The General tab reads and watches the logo color in main. */
function logoColorPort() {
  return {
    getAppLogoColorPreference: vi.fn(async () => ({ color: "lavender" as const })),
    onAppLogoColorPreference: vi.fn(() => () => undefined),
    setAppLogoColorPreference: vi.fn(async ({ color }: { color: AppLogoColor }) => ({ color })),
  };
}

// Every describe block renders the modal, and the General tab is open by default.
beforeEach(() => {
  vi.stubGlobal("openbot", logoColorPort());
});

describe("SettingsModal", () => {
  it("disconnects another desktop from the account session list and preserves the current device", async () => {
    const current: AccountSession = {
      sessionId: "current",
      name: "Current desktop",
      kind: "desktop",
      current: true,
      connectedAt: 1,
      lastActiveAt: 2,
    };
    const other: AccountSession = { ...current, sessionId: "other", name: "Other desktop", current: false };
    let sessions = [current, other];
    const revoke = vi.fn(async (sessionId: string) => {
      sessions = sessions.filter((session) => session.sessionId !== sessionId);
    });
    render(() => (
      <SettingsModal
        open
        onOpenChange={() => {}}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => {}}
        appInfo={null}
        updateStatus={idleUpdateStatus}
        onUpdateAction={async () => {}}
        account={account}
        onUpdateAccountName={async () => {}}
        onUpdateAccountAvatar={async () => {}}
        onListAccountSessions={async () => sessions}
        onRevokeAccountSession={revoke}
      />
    ));
    await fireEvent.click(await screen.findByRole("tab", { name: "Profile" }));
    await fireEvent.click(await screen.findByRole("button", { name: /^Disconnect Other desktop session/ }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Disconnect Other desktop session/ })).not.toBeInTheDocument(),
    );
    expect(revoke).toHaveBeenCalledWith("other");
    expect(screen.queryByRole("button", { name: /^Disconnect Current desktop session/ })).not.toBeInTheDocument();
    expect(sessions).toEqual([current]);
  });
  afterEach(() => {
    toast.dismiss();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps every settings preference controlled across a button close, Escape, and reopen", async () => {
    const [open, setOpen] = createSignal(true);
    const [value, setValue] = createSignal({ ...DEFAULT_GENERAL_SETTINGS });
    let openTrigger: HTMLButtonElement | undefined;

    render(() => (
      <>
        <button ref={(element) => (openTrigger = element)} type="button" onClick={() => setOpen(true)}>
          Open settings
        </button>
        <SettingsModal
          open={open()}
          onOpenChange={setOpen}
          value={value()}
          onValueChange={setValue}
          appInfo={{ name: "OpenBot", version: "0.2.1", platform: "darwin", variant: "dev" }}
          updateStatus={idleUpdateStatus}
          onUpdateAction={vi.fn(async () => undefined)}
          account={account}
          onUpdateAccountName={vi.fn(async () => undefined)}
          onUpdateAccountAvatar={vi.fn(async () => undefined)}
          restoreFocusTarget={openTrigger}
        />
      </>
    ));

    const launchSwitch = screen.getByRole("switch", { name: "Launch OpenBot at login" });
    await fireEvent.click(launchSwitch);
    expect(value().launchAtLogin).toBe(false);

    const select = screen.getByRole("button", { name: /^Open external links in/ });
    await fireEvent.pointerDown(select, { pointerType: "mouse", button: 0 });
    await fireEvent.click(screen.getByRole("option", { name: "OpenBot" }));
    expect(value().externalLinkTarget).toBe("OpenBot");
    await fireEvent.click(screen.getByRole("switch", { name: "Share product analytics" }));
    expect(value().productAnalytics).toBe(false);

    await fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "General" })).not.toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "Open settings" }));

    expect(await screen.findByRole("switch", { name: "Launch OpenBot at login" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: /^Open external links in/ })).toHaveTextContent("OpenBot");
    expect(screen.getByRole("switch", { name: "Share product analytics" })).not.toBeChecked();

    await fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    const autoDownload = await screen.findByRole("switch", { name: "Automatically download updates" });
    expect(autoDownload).toBeChecked();
    await fireEvent.click(autoDownload);
    expect(value().autoDownloadUpdates).toBe(false);

    await fireEvent.keyDown(screen.getByRole("dialog", { name: "Updates" }), { key: "Escape" });
    // The dialog is named after the active tab, so the wait has to target the Updates title.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Updates" })).not.toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    await fireEvent.click(await screen.findByRole("tab", { name: "Updates" }));

    expect(await screen.findByRole("switch", { name: "Automatically download updates" })).not.toBeChecked();

    await fireEvent.click(screen.getByRole("tab", { name: "Dynamic Island" }));
    const width = await screen.findByRole("slider", { name: "Width" });
    await fireEvent.keyDown(width, { key: "ArrowLeft" });
    await fireEvent.keyUp(width, { key: "ArrowLeft" });
    await waitFor(() => expect(value().macBookNotchWidthPercent).toBe(95));
    expect(width).toHaveAttribute("aria-valuetext", "95%");
    await fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(value().macBookNotchWidthPercent).toBe(100);
    expect(screen.getByRole("button", { name: "Reset to default" })).toBeDisabled();

    await fireEvent.click(screen.getByRole("switch", { name: "Show status in the MacBook notch" }));
    expect(value().macBookNotch).toBe(false);
    for (const dependent of ["Haptic feedback", "Show idle island", "Show on additional displays"]) {
      expect(await screen.findByRole("switch", { name: dependent })).toBeChecked();
      expect(screen.getByRole("switch", { name: dependent })).toBeDisabled();
    }
    expect(screen.getByRole("slider", { name: "Height" })).toHaveAttribute("aria-disabled", "true");
  });

  it("runs the updater and reflects its live status", async () => {
    const [status, setStatus] = createSignal<UpdateStatus>(idleUpdateStatus);
    const onUpdateAction = vi.fn(async () => {
      setStatus({ ...idleUpdateStatus, phase: "up-to-date", checkedAt: "2026-08-26T12:00:00.000Z" });
    });

    render(() => (
      <SettingsModal
        open
        onOpenChange={() => undefined}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => undefined}
        appInfo={{ name: "OpenBot", version: "0.2.1", platform: "darwin", variant: "dev" }}
        updateStatus={status()}
        onUpdateAction={onUpdateAction}
        account={account}
        onUpdateAccountName={vi.fn(async () => undefined)}
        onUpdateAccountAvatar={vi.fn(async () => undefined)}
      />
    ));

    await fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    await fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => expect(onUpdateAction).toHaveBeenCalledOnce());
    expect(await screen.findByText("OpenBot is up to date on the Stable track.")).toBeInTheDocument();
  });

  it("reports host management instead of tenant update controls on a managed host", async () => {
    const onUpdateAction = vi.fn(async () => undefined);
    render(() => (
      <SettingsModal
        open
        onOpenChange={() => undefined}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => undefined}
        appInfo={{ name: "OpenBot", version: "0.16.0", platform: "darwin", variant: "dev" }}
        updateStatus={{ ...idleUpdateStatus, phase: "up-to-date", currentVersion: "0.16.0", managedByHost: true }}
        onUpdateAction={onUpdateAction}
        account={account}
        onUpdateAccountName={vi.fn(async () => undefined)}
        onUpdateAccountAvatar={vi.fn(async () => undefined)}
      />
    ));

    await fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    expect(await screen.findByText("Managed by Host")).toBeInTheDocument();
    expect(screen.getByText(/managed automatically by OpenBot Host Manager/)).toBeInTheDocument();
    expect(screen.getByText(/Up to date/)).toBeInTheDocument();
    // The host owns both the shared application and the download schedule, so neither the manual
    // action nor the per-user download preference can change anything.
    expect(screen.queryByRole("switch", { name: "Automatically download updates" })).not.toBeInTheDocument();
    for (const name of ["Check for updates", "Download update", "Restart to update", "Managed by host"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(onUpdateAction).not.toHaveBeenCalled();
  });

  it("shows the live host update status while the host installs a new version", async () => {
    const [status, setStatus] = createSignal<UpdateStatus>({
      ...idleUpdateStatus,
      phase: "downloading",
      currentVersion: "0.16.0",
      availableVersion: "0.17.0",
      progress: 42,
      managedByHost: true,
    });

    render(() => (
      <SettingsModal
        open
        onOpenChange={() => undefined}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => undefined}
        appInfo={{ name: "OpenBot", version: "0.16.0", platform: "darwin", variant: "dev" }}
        updateStatus={status()}
        onUpdateAction={vi.fn(async () => undefined)}
        account={account}
        onUpdateAccountName={vi.fn(async () => undefined)}
        onUpdateAccountAvatar={vi.fn(async () => undefined)}
      />
    ));

    await fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    expect(await screen.findByText(/Downloading OpenBot v0.17.0 · 42%/)).toBeInTheDocument();

    setStatus((current) => ({ ...current, phase: "ready", progress: null }));
    expect(await screen.findByText(/Waiting for the other users of this Mac to be idle/)).toBeInTheDocument();

    setStatus((current) => ({ ...current, phase: "installing" }));
    expect(await screen.findByText("Installing OpenBot v0.17.0…")).toBeInTheDocument();
    expect(screen.getByText("Managed by Host")).toBeInTheDocument();
  });

  it("disables busy update actions and shows action failures", async () => {
    const onUpdateAction = vi.fn(async () => {
      throw new Error("Update service is offline.");
    });
    render(() => (
      <SettingsModal
        open
        onOpenChange={() => undefined}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => undefined}
        appInfo={{ name: "OpenBot", version: "0.2.1", platform: "darwin", variant: "dev" }}
        updateStatus={idleUpdateStatus}
        onUpdateAction={onUpdateAction}
        account={account}
        onUpdateAccountName={vi.fn(async () => undefined)}
        onUpdateAccountAvatar={vi.fn(async () => undefined)}
      />
    ));

    await fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    await fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Update service is offline.")).toBeInTheDocument();
  });

  it("resets a display-name draft and saves its trimmed value", async () => {
    const [currentAccount, setCurrentAccount] = createSignal({ ...account });
    const onUpdateAccountName = vi.fn(async (name: string) => {
      setCurrentAccount((current) => ({ ...current, name }));
    });

    render(() => (
      <SettingsModal
        open
        onOpenChange={() => undefined}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => undefined}
        appInfo={{ name: "OpenBot", version: "0.2.1", platform: "darwin", variant: "dev" }}
        updateStatus={idleUpdateStatus}
        onUpdateAction={vi.fn(async () => undefined)}
        account={currentAccount()}
        onUpdateAccountName={onUpdateAccountName}
        onUpdateAccountAvatar={vi.fn(async () => undefined)}
      />
    ));

    await fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
    const input = screen.getByRole("textbox", { name: "Display name" });
    await fireEvent.input(input, { target: { value: "Unsaved name" } });
    await fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    await fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
    expect(input).toHaveValue("Norbert");
    expect(onUpdateAccountName).not.toHaveBeenCalled();

    await fireEvent.input(input, { target: { value: "  No\u0308ra\u00a0\u00a0Bot  " } });
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onUpdateAccountName).toHaveBeenCalledWith("Nöra Bot"));
    expect(input).toHaveValue("Nöra Bot");
  });

  it("does not mark a normalized legacy display name as changed", async () => {
    render(() => (
      <SettingsModal
        open
        onOpenChange={() => undefined}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => undefined}
        appInfo={{ name: "OpenBot", version: "0.2.1", platform: "darwin", variant: "dev" }}
        updateStatus={idleUpdateStatus}
        onUpdateAction={vi.fn(async () => undefined)}
        account={{ ...account, name: "Jose\u0301" }}
        onUpdateAccountName={vi.fn(async () => undefined)}
        onUpdateAccountAvatar={vi.fn(async () => undefined)}
      />
    ));

    await fireEvent.click(screen.getByRole("tab", { name: "Profile" }));

    expect(screen.getByRole("textbox", { name: "Display name" })).toHaveValue("Jose\u0301");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("keeps an invalid or rejected display name in the field", async () => {
    const onUpdateAccountName = vi
      .fn(async () => undefined)
      .mockRejectedValueOnce(new Error("Profile service is offline."));
    render(() => (
      <SettingsModal
        open
        onOpenChange={() => undefined}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => undefined}
        appInfo={{ name: "OpenBot", version: "0.2.1", platform: "darwin", variant: "dev" }}
        updateStatus={idleUpdateStatus}
        onUpdateAction={vi.fn(async () => undefined)}
        account={account}
        onUpdateAccountName={onUpdateAccountName}
        onUpdateAccountAvatar={vi.fn(async () => undefined)}
      />
    ));

    await fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
    const input = screen.getByRole("textbox", { name: "Display name" });
    await fireEvent.input(input, { target: { value: " " } });
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onUpdateAccountName).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a display name.");

    await fireEvent.input(input, { target: { value: "No" } });
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onUpdateAccountName).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Use at least 3 characters.");

    await fireEvent.input(input, { target: { value: "Nor\u200bbert" } });
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onUpdateAccountName).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Remove line breaks and hidden or control characters.");

    await fireEvent.input(input, { target: { value: "Nora" } });
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Profile service is offline.");
    expect(input).toHaveValue("Nora");
  });

  it("updates and removes the signed-in account avatar from Profile settings", async () => {
    const [currentAccount, setCurrentAccount] = createSignal({ ...account });
    const onUpdateAccountAvatar = vi.fn(async (image: AvatarImageInput | null) => {
      setCurrentAccount((current) => ({
        ...current,
        avatarUrl: image ? "data:image/webp;base64,cHJvZmlsZQ==" : null,
      }));
    });

    render(() => (
      <SettingsModal
        open
        onOpenChange={() => undefined}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => undefined}
        appInfo={{ name: "OpenBot", version: "0.2.1", platform: "darwin", variant: "dev" }}
        updateStatus={idleUpdateStatus}
        onUpdateAction={vi.fn(async () => undefined)}
        account={currentAccount()}
        onUpdateAccountName={vi.fn(async () => undefined)}
        onUpdateAccountAvatar={onUpdateAccountAvatar}
        processAvatarFile={async () => ({
          mimeType: "image/webp",
          bytes: new Uint8Array([1, 2, 3]),
        })}
      />
    ));

    await fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
    const input = screen.getByLabelText("Upload profile photo");
    const file = new File(["profile"], "profile.png", { type: "image/png" });
    await fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(onUpdateAccountAvatar).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "image/webp" })),
    );
    await fireEvent.click(await screen.findByRole("button", { name: "Remove profile photo" }));
    await waitFor(() => expect(onUpdateAccountAvatar).toHaveBeenLastCalledWith(null));
  });

  it("confirms a new mobile connection before collapsing the QR code", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const devices: MobileConnectedDevice[] = [];
    const onListMobileConnectedDevices = vi.fn(async () => [...devices]);
    const view = render(() => (
      <SettingsModal
        open
        onOpenChange={() => undefined}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => undefined}
        appInfo={{ name: "OpenBot", version: "0.2.1", platform: "darwin", variant: "dev" }}
        updateStatus={idleUpdateStatus}
        onUpdateAction={vi.fn(async () => undefined)}
        account={account}
        onUpdateAccountName={vi.fn(async () => undefined)}
        onUpdateAccountAvatar={vi.fn(async () => undefined)}
        onCreateMobileConnect={async () => ({
          qrData: "openbot://mobile-connect?api=https%3A%2F%2Fapi.openbot.run&ticket=mobile-ticket_success_1234567890",
          expiresAt: Date.now() + 120_000,
        })}
        onListMobileConnectedDevices={onListMobileConnectedDevices}
        onRevokeMobileConnectedDevice={vi.fn(async () => undefined)}
      />
    ));

    try {
      await fireEvent.click(screen.getByRole("tab", { name: "Mobile Connect" }));
      await vi.advanceTimersByTimeAsync(0);
      await fireEvent.click(screen.getByRole("button", { name: "Generate QR code" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByRole("img", { name: "Mobile Connect sign-in QR code" })).toBeInTheDocument();
      const requestsBeforePolling = onListMobileConnectedDevices.mock.calls.length;

      devices.push({
        sessionId: "22222222-2222-4222-8222-222222222222",
        name: "Norbert’s iPhone",
        platform: "ios",
        connectedAt: Date.now(),
        lastActiveAt: Date.now(),
      });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(onListMobileConnectedDevices).toHaveBeenCalledTimes(requestsBeforePolling);
      expect(screen.queryByText("Phone connected")).not.toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(1);
      expect(onListMobileConnectedDevices).toHaveBeenCalledTimes(requestsBeforePolling + 1);

      expect(screen.getByText("Phone connected")).toBeInTheDocument();
      expect(screen.getByText("Norbert’s iPhone is ready to use OpenBot.")).toBeInTheDocument();
      expect(screen.getByRole("table")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(1_200);
      expect(screen.queryByRole("img", { name: "Mobile Connect sign-in QR code" })).not.toBeInTheDocument();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("captures the existing device baseline before issuing a Mobile Connect ticket", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const existingDevice: MobileConnectedDevice = {
      sessionId: "11111111-1111-4111-8111-111111111111",
      name: "Existing iPhone",
      platform: "ios",
      connectedAt: Date.now() - 60_000,
      lastActiveAt: Date.now(),
    };
    let resolveInitialDevices: ((devices: MobileConnectedDevice[]) => void) | undefined;
    const initialDevices = new Promise<MobileConnectedDevice[]>((resolve) => {
      resolveInitialDevices = resolve;
    });
    const onListMobileConnectedDevices = vi
      .fn<() => Promise<MobileConnectedDevice[]>>()
      .mockImplementationOnce(() => initialDevices)
      .mockImplementationOnce(() => initialDevices)
      .mockResolvedValue([existingDevice]);
    const onCreateMobileConnect = vi.fn(async () => ({
      qrData: "openbot://mobile-connect?api=https%3A%2F%2Fapi.openbot.run&ticket=mobile-ticket_baseline_1234567890",
      expiresAt: Date.now() + 120_000,
    }));
    const view = render(() => (
      <SettingsModal
        open
        onOpenChange={() => undefined}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => undefined}
        appInfo={{ name: "OpenBot", version: "0.2.1", platform: "darwin", variant: "dev" }}
        updateStatus={idleUpdateStatus}
        onUpdateAction={vi.fn(async () => undefined)}
        account={account}
        onUpdateAccountName={vi.fn(async () => undefined)}
        onUpdateAccountAvatar={vi.fn(async () => undefined)}
        onCreateMobileConnect={onCreateMobileConnect}
        onListMobileConnectedDevices={onListMobileConnectedDevices}
      />
    ));

    try {
      await fireEvent.click(screen.getByRole("tab", { name: "Mobile Connect" }));
      await fireEvent.click(screen.getByRole("button", { name: "Generate QR code" }));
      expect(onCreateMobileConnect).not.toHaveBeenCalled();

      resolveInitialDevices?.([existingDevice]);
      await vi.advanceTimersByTimeAsync(0);
      expect(onCreateMobileConnect).toHaveBeenCalledOnce();
      expect(screen.getByRole("img", { name: "Mobile Connect sign-in QR code" })).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(screen.queryByText("Phone connected")).not.toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Mobile Connect sign-in QR code" })).toBeInTheDocument();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("does not poll connected mobile devices without a QR code and refreshes when the window is shown", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const onListMobileConnectedDevices = vi.fn(async () => []);
    const view = render(() => (
      <SettingsModal
        open
        onOpenChange={() => undefined}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => undefined}
        appInfo={{ name: "OpenBot", version: "0.2.1", platform: "darwin", variant: "dev" }}
        updateStatus={idleUpdateStatus}
        onUpdateAction={vi.fn(async () => undefined)}
        account={account}
        onUpdateAccountName={vi.fn(async () => undefined)}
        onUpdateAccountAvatar={vi.fn(async () => undefined)}
        onListMobileConnectedDevices={onListMobileConnectedDevices}
      />
    ));

    try {
      await fireEvent.click(screen.getByRole("tab", { name: "Mobile Connect" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(onListMobileConnectedDevices).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(onListMobileConnectedDevices).toHaveBeenCalledTimes(1);

      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(onListMobileConnectedDevices).toHaveBeenCalledTimes(2);
      visibility.mockRestore();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("lists connected mobile devices and revokes one device session", async () => {
    const onListMobileConnectedDevices = vi.fn(async () => [
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        name: "Norbert’s iPhone",
        platform: "ios" as const,
        connectedAt: Date.now() - 60_000,
        lastActiveAt: Date.now(),
      },
    ]);
    const onRevokeMobileConnectedDevice = vi.fn(async () => undefined);
    render(() => (
      <SettingsModal
        open
        onOpenChange={() => undefined}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => undefined}
        appInfo={{ name: "OpenBot", version: "0.2.1", platform: "darwin", variant: "dev" }}
        updateStatus={idleUpdateStatus}
        onUpdateAction={vi.fn(async () => undefined)}
        account={account}
        onUpdateAccountName={vi.fn(async () => undefined)}
        onUpdateAccountAvatar={vi.fn(async () => undefined)}
        onListMobileConnectedDevices={onListMobileConnectedDevices}
        onRevokeMobileConnectedDevice={onRevokeMobileConnectedDevice}
      />
    ));

    await fireEvent.click(screen.getByRole("tab", { name: "Mobile Connect" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Disconnect Norbert’s iPhone" }));

    await waitFor(() =>
      expect(onRevokeMobileConnectedDevice).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111"),
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No connected devices")).toBeInTheDocument();
  });

  it("warns before Turbo mode is turned on, and turns it off without asking", async () => {
    const [value, setValue] = createSignal({ ...DEFAULT_GENERAL_SETTINGS });
    render(() => (
      <SettingsModal
        open
        onOpenChange={() => undefined}
        value={value()}
        onValueChange={setValue}
        appInfo={null}
        updateStatus={idleUpdateStatus}
        onUpdateAction={async () => {}}
        account={account}
        onUpdateAccountName={async () => {}}
        onUpdateAccountAvatar={async () => {}}
      />
    ));

    const toggle = await screen.findByRole("switch", { name: "Turbo mode" });
    await fireEvent.click(toggle);
    // Nothing is on yet: the switch is a request to turn it on, and the dialog is where it is given.
    expect(value().turboMode).toBe(false);
    await fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(value().turboMode).toBe(false);

    await fireEvent.click(toggle);
    await fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(value().turboMode).toBe(true));

    await fireEvent.click(await screen.findByRole("switch", { name: "Turbo mode" }));
    await waitFor(() => expect(value().turboMode).toBe(false));
  });
});

describe("isOpenSettingsShortcut", () => {
  it("accepts Command+, and Control+,", () => {
    expect(isOpenSettingsShortcut({ key: ",", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBe(
      true,
    );
    expect(isOpenSettingsShortcut({ key: ",", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false })).toBe(
      true,
    );
  });

  it("does not claim a plain comma or a modified shortcut", () => {
    expect(isOpenSettingsShortcut({ key: ",", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })).toBe(
      false,
    );
    expect(isOpenSettingsShortcut({ key: ",", metaKey: true, ctrlKey: false, altKey: true, shiftKey: false })).toBe(
      false,
    );
    expect(isOpenSettingsShortcut({ key: ",", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true })).toBe(
      false,
    );
    expect(isOpenSettingsShortcut({ key: ".", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBe(
      false,
    );
  });
});

describe("notification settings", () => {
  function renderSettings(platform: DesktopPlatform, onOpenNotificationSettings: () => Promise<void>) {
    render(() => (
      <SettingsModal
        open
        onOpenChange={() => undefined}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => undefined}
        appInfo={{ name: "OpenBot", version: "0.2.1", platform, variant: "dev" }}
        updateStatus={idleUpdateStatus}
        onUpdateAction={vi.fn(async () => undefined)}
        account={account}
        onUpdateAccountName={vi.fn(async () => undefined)}
        onUpdateAccountAvatar={vi.fn(async () => undefined)}
        onTestNotification={vi.fn(async () => undefined)}
        onOpenNotificationSettings={onOpenNotificationSettings}
        initialTab="notifications"
      />
    ));
  }

  it("opens the system page where the user allows notifications", async () => {
    const onOpenNotificationSettings = vi.fn(async () => undefined);
    renderSettings("darwin", onOpenNotificationSettings);
    await fireEvent.click(await screen.findByRole("button", { name: "Open system settings" }));
    await waitFor(() => expect(onOpenNotificationSettings).toHaveBeenCalledOnce());
  });

  it("offers no system page on Linux", async () => {
    renderSettings(
      "linux",
      vi.fn(async () => undefined),
    );
    await screen.findByRole("button", { name: "Send test" });
    expect(screen.queryByRole("button", { name: "Open system settings" })).not.toBeInTheDocument();
  });
});

describe("hosted servers", () => {
  const server: HostedServerSummary = {
    serverId: "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
    name: "Research server",
    size: "small",
    plan: "starter",
    interval: "month",
    currency: "eur",
    state: "stopped",
    error: null,
    createdAt: "2026-09-20T09:30:00.000Z",
    updatedAt: "2026-09-20T09:30:00.000Z",
  };

  /** Opens Settings from "Manage servers", with a list that answers only when the test says so. */
  function renderFromManageServers() {
    let answer: (list: HostedServerList) => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    const list = vi.fn(
      () =>
        new Promise<HostedServerList>((resolve, reject) => {
          answer = resolve;
          fail = reject;
        }),
    );
    const [open, setOpen] = createSignal(true);
    render(() => (
      <SettingsModal
        open={open()}
        onOpenChange={setOpen}
        value={DEFAULT_GENERAL_SETTINGS}
        onValueChange={() => undefined}
        appInfo={null}
        updateStatus={idleUpdateStatus}
        onUpdateAction={vi.fn(async () => undefined)}
        account={account}
        onUpdateAccountName={vi.fn(async () => undefined)}
        onUpdateAccountAvatar={vi.fn(async () => undefined)}
        hostedServersApi={{ ...createMockHostedServers(), list }}
        onAddHostedServer={() => undefined}
        openTab="hosted-servers"
      />
    ));
    return {
      list,
      setOpen,
      answer: (value: Omit<HostedServerList, "maxServers">) => answer({ ...value, maxServers: 3 }),
      fail: (error: Error) => fail(error),
    };
  }

  it("opens on the Billing tab with a loading status before the list answers", async () => {
    const hosted = renderFromManageServers();
    expect(await screen.findByRole("tab", { name: "Billing", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "General", selected: false })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading hosted servers…" })).toBeInTheDocument();

    hosted.answer({ available: true, servers: [server] });
    expect(await screen.findByRole("button", { name: /Delete Research server/ })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading hosted servers…" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Billing", selected: true })).toBeInTheDocument();
  });

  it("shows the empty text when the account has no server yet", async () => {
    const hosted = renderFromManageServers();
    hosted.answer({ available: true, servers: [] });
    expect(await screen.findByText("You do not have a hosted server yet.")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading hosted servers…" })).not.toBeInTheDocument();
  });

  it("keeps the tab open with the error when the first list fails", async () => {
    const hosted = renderFromManageServers();
    hosted.fail(new Error("Could not load hosted servers."));
    expect(await screen.findByText("Could not load hosted servers.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Billing", selected: true })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading hosted servers…" })).not.toBeInTheDocument();
  });

  it("keeps Billing open when the account cannot use hosted servers", async () => {
    const hosted = renderFromManageServers();
    hosted.answer({ available: false, servers: [] });
    expect(await screen.findByRole("tab", { name: "Billing", selected: true })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Hosted servers" })).not.toBeInTheDocument();
  });

  it("keeps the loaded rows across tab changes and a reopen", async () => {
    const hosted = renderFromManageServers();
    hosted.answer({ available: true, servers: [server] });
    await screen.findByRole("button", { name: /Delete Research server/ });

    for (let round = 0; round < 3; round += 1) {
      await fireEvent.click(screen.getByRole("tab", { name: "General" }));
      await screen.findByRole("tab", { name: "General", selected: true });
      await fireEvent.click(screen.getByRole("tab", { name: "Billing" }));
      expect(await screen.findByRole("button", { name: /Delete Research server/ })).toBeInTheDocument();
      expect(screen.queryByRole("status", { name: "Loading hosted servers…" })).not.toBeInTheDocument();
    }
    expect(hosted.list).toHaveBeenCalledOnce();

    hosted.setOpen(false);
    hosted.setOpen(true);
    await waitFor(() => expect(hosted.list).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: /Delete Research server/ })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading hosted servers…" })).not.toBeInTheDocument();
  });
});
