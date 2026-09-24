import type { AccountUsage, AgentSummary, ApprovalAutomationPreference } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { assert, expect, it, vi } from "vitest";
import { App } from "./App";
import { desktopAnalytics } from "./analytics";
import {
  AGENTS,
  confirmOnboardingModel,
  emitAgentEvent,
  emitScopedAgentEvent,
  emitUpdateStatus,
  installOpenbotStub,
  testConversationPage,
  testServer,
  trackAnalytics,
} from "./app-test-harness";
import { SIDEBAR_PINS_STORAGE_KEY } from "./features/sidebar/sidebar-pins-storage";

describe("OpenBot connected desktop shell", () => {
  it("opens the marketplace from skill settings and returns to skills", async () => {
    // Load the real lazy panels before measuring their visible behavior under CI load.
    await import("./features/conversation/AgentSettingsPanel");
    await import("./features/settings/SkillsMarketplaceModal");
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await waitFor(() => expect(window.openbot.agent.listInstalledSkills).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole("button", { name: "View agent settings" }));
    await fireEvent.click(await screen.findByRole("button", { name: /^Skills/ }));
    const [addFromMarketplace] = await screen.findAllByRole("button", { name: "Add from marketplace" });
    assert(addFromMarketplace);
    // The button stays disabled until the agent's skills load.
    await waitFor(() => expect(addFromMarketplace).toBeEnabled());
    await fireEvent.click(addFromMarketplace);
    expect(await screen.findByRole("heading", { name: "Marketplace" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Close marketplace" }));
    expect((await screen.findAllByRole("button", { name: "Add from marketplace" }))[0]).toBeEnabled();
  });
  beforeEach(() => {
    installOpenbotStub();
  });
  afterEach(() => toast.dismiss());

  it("reports a failed Turbo disable after Settings closes and restores its enabled state", async () => {
    const write = Promise.withResolvers<ApprovalAutomationPreference>();
    vi.mocked(window.openbot.getApprovalAutomation).mockResolvedValue({
      turbo: true,
      defaultAutoApprove: false,
      autoApproveOverrides: {},
    });
    vi.mocked(window.openbot.setApprovalAutomation).mockReturnValueOnce(write.promise);
    render(() => <App />);
    await fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const toggle = await screen.findByRole("switch", { name: "Turbo mode" });
    await waitFor(() => expect(toggle).toBeChecked());
    await fireEvent.click(toggle);
    await waitFor(() => expect(window.openbot.setApprovalAutomation).toHaveBeenCalledWith({ turbo: false }));
    expect(toggle).toBeDisabled();
    await fireEvent.click(toggle);
    expect(window.openbot.setApprovalAutomation).toHaveBeenCalledOnce();
    await fireEvent.keyDown(screen.getByRole("dialog", { name: "General" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "General" })).not.toBeInTheDocument());
    write.reject(new Error("Write failed"));
    expect(
      await screen.findByText("Could not turn off Turbo mode. It is still active. Try again."),
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const restored = await screen.findByRole("switch", { name: "Turbo mode" });
    expect(restored).toBeChecked();
    expect(restored).toBeEnabled();
  });

  it.each<ApprovalAutomationPreference & { enabled: boolean }>([
    { defaultAutoApprove: true, autoApproveOverrides: {}, turbo: false, enabled: true },
    { defaultAutoApprove: false, autoApproveOverrides: {}, turbo: false, enabled: false },
    { defaultAutoApprove: true, autoApproveOverrides: { chief: false }, turbo: false, enabled: false },
    { defaultAutoApprove: true, autoApproveOverrides: { chief: false }, turbo: true, enabled: true },
  ])("shows the effective auto-approval choice: %j", async ({ enabled, ...preference }) => {
    vi.mocked(window.openbot.getApprovalAutomation).mockResolvedValue(preference);
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(screen.getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    const toggle = await screen.findByRole("switch", { name: "Auto approve this agent's actions" });
    if (enabled) expect(toggle).toBeChecked();
    else expect(toggle).not.toBeChecked();
    if (preference.turbo) expect(toggle).toBeDisabled();
    else expect(toggle).toBeEnabled();
  });

  it("reports a failed model-picker revocation and keeps the grant available for retry", async () => {
    vi.mocked(window.openbot.getApprovalAutomation).mockResolvedValue({
      turbo: false,
      defaultAutoApprove: false,
      autoApproveOverrides: { chief: true },
    });
    vi.mocked(window.openbot.setApprovalAutomation).mockRejectedValueOnce(new Error("Write failed"));
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(screen.getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    const toggle = await screen.findByRole("switch", { name: "Auto approve this agent's actions" });
    expect(toggle).toBeChecked();
    await fireEvent.click(toggle);
    expect(
      await screen.findByText("Could not revoke the standing approval for Chief. It is still active. Try again."),
    ).toBeInTheDocument();
    expect(toggle).toBeChecked();
    await fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(window.openbot.setApprovalAutomation).toHaveBeenCalledTimes(2);
  });

  it("answers the original approval after switching agents during a grant write", async () => {
    vi.mocked(window.openbot.agent.listAgents).mockResolvedValue(
      AGENTS.map((agent) => ({ ...agent, threadId: `thread-${agent.id}` })),
    );
    const write = Promise.withResolvers<ApprovalAutomationPreference>();
    vi.mocked(window.openbot.setApprovalAutomation).mockReturnValueOnce(write.promise);
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await confirmOnboardingModel();
    const requestApproval = (agentId: string) => {
      emitAgentEvent?.({
        type: "approval",
        approval: {
          requestId: `approval-${agentId}`,
          agentId,
          threadId: `thread-${agentId}`,
          turnId: `turn-${agentId}`,
          kind: "command",
          command: "bun run lint",
          cwd: null,
          reason: null,
          grantRoot: null,
          permissions: null,
        },
      });
    };
    requestApproval("chief");
    await fireEvent.click(await screen.findByRole("button", { name: "Always allow" }));
    const dialog = await screen.findByRole("alertdialog");
    await fireEvent.click(within(dialog).getByRole("button", { name: "Always allow" }));
    await waitFor(() =>
      expect(window.openbot.setApprovalAutomation).toHaveBeenCalledWith({ agentId: "chief", autoApprove: true }),
    );
    await fireEvent.click(screen.getByRole("button", { name: /Sales Outbound, Outbound specialist/ }));
    await screen.findByRole("heading", { name: "Sales Outbound" });
    requestApproval("sales-outbound");
    await screen.findByRole("button", { name: "Deny" });
    write.resolve({ turbo: false, defaultAutoApprove: false, autoApproveOverrides: { chief: true } });
    await waitFor(() => expect(window.openbot.agent.respondToApproval).toHaveBeenCalledOnce());
    expect(window.openbot.agent.respondToApproval).toHaveBeenCalledWith({
      requestId: "approval-chief",
      decision: "accept",
    });
    expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled();
  });

  it("shows Turbo without per-agent approval controls in Settings", async () => {
    vi.mocked(window.openbot.getApprovalAutomation).mockResolvedValue({
      turbo: false,
      defaultAutoApprove: false,
      autoApproveOverrides: { chief: true, "sales-outbound": true },
    });
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("switch", { name: "Turbo mode" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Revoke the standing approval/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke all" })).not.toBeInTheDocument();
    expect(window.openbot.setApprovalAutomation).not.toHaveBeenCalled();
  });

  it("refreshes skill suggestions after settings closes", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await waitFor(() => expect(window.openbot.agent.listInstalledSkills).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole("button", { name: "View agent settings" }));
    await screen.findByRole("textbox", { name: "Agent name" });
    vi.mocked(window.openbot.agent.listInstalledSkills).mockResolvedValue([
      {
        skillId: "local-skill-smoke",
        slug: "smoke",
        name: "Smoke checklist",
        origin: "local",
        installedVersion: 1,
        availableVersion: 1,
        enabled: true,
        state: "installed",
      },
    ]);
    vi.mocked(window.openbot.agent.listInstalledSkills).mockClear();
    await fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    await waitFor(() => expect(window.openbot.agent.listInstalledSkills).toHaveBeenCalledWith("chief"));
    const editor = screen.getByRole("textbox", { name: "Message Chief" });
    editor.textContent = "$Smoke";
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await fireEvent.input(editor);
    expect(await screen.findByRole("listbox", { name: "Insert skill or MCP server" })).toHaveTextContent(
      "Smoke checklist",
    );
  });

  it("opens the dock surfaces and closes them from their own controls", async () => {
    render(() => <App />);
    await waitFor(() => expect(window.openbot.agent.getUsage).toHaveBeenCalledTimes(1));
    expect(vi.mocked(window.openbot.agent.getUsage).mock.calls[0]).toEqual([]);

    const usageButton = await screen.findByRole("button", { name: "Usage, ChatGPT 59% left" });
    await fireEvent.click(usageButton);
    const usageDialog = screen.getByRole("dialog", { name: "Usage" });
    expect(within(usageDialog).getByRole("listitem", { name: /ChatGPT, 59% left/ })).toBeInTheDocument();
    await fireEvent.click(within(usageDialog).getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(window.openbot.agent.getUsage).toHaveBeenCalledTimes(2));
    await fireEvent.keyDown(usageDialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Usage" })).not.toBeInTheDocument());

    const accountButton = screen.getByRole("button", { name: "Open account actions" });
    await fireEvent.click(accountButton);
    const accountDialog = screen.getByRole("dialog", { name: "Account actions" });
    expect(within(accountDialog).queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
    await fireEvent.keyDown(accountDialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Account actions" })).not.toBeInTheDocument());

    await fireEvent.click(accountButton);
    const reopenedAccountDialog = await screen.findByRole("dialog", { name: "Account actions" });
    fireEvent.click(within(reopenedAccountDialog).getByRole("button", { name: "Send feedback" }));
    await waitFor(() => expect(window.openbot.openExternal).toHaveBeenCalledWith("feedback"));

    fireEvent.click(accountButton);
    fireEvent.click(screen.getByRole("button", { name: "Message" }));
    await waitFor(() => expect(window.openbot.openExternal).toHaveBeenCalledWith("message"));

    const settingsButton = screen.getByRole("button", { name: "Settings" });
    await fireEvent.click(settingsButton);
    const dialog = await screen.findByRole("dialog", { name: "General" });
    const launchSwitch = within(dialog).getByRole("switch", { name: "Launch OpenBot at login" });
    await fireEvent.click(launchSwitch);
    expect(launchSwitch).not.toBeChecked();

    await fireEvent.click(within(dialog).getByRole("button", { name: "Close settings" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "General" })).not.toBeInTheDocument());
  });

  it("re-reads usage on its own while the dock keeps it on screen", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(() => <App />);
      await waitFor(() => expect(window.openbot.agent.getUsage).toHaveBeenCalledTimes(1));

      await vi.advanceTimersByTimeAsync(4 * 60_000);
      expect(window.openbot.agent.getUsage).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(90_000);
      await waitFor(() => expect(window.openbot.agent.getUsage).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads usage lazily when the account menu hides it", async () => {
    vi.mocked(window.openbot.getAppInfo).mockResolvedValue({
      name: "OpenBot",
      version: "0.1.0",
      platform: "win32",
      variant: "production",
    });

    render(() => <App />);
    const accountButton = await screen.findByRole("button", { name: "Open account menu" });
    await Promise.resolve();

    expect(window.openbot.agent.getUsage).not.toHaveBeenCalled();
    await fireEvent.click(accountButton);
    await waitFor(() => expect(window.openbot.agent.getUsage).toHaveBeenCalledTimes(1));
    expect(vi.mocked(window.openbot.agent.getUsage).mock.calls[0]).toEqual([]);
    const accountDialog = screen.getByRole("dialog", { name: "Account actions" });
    expect(within(accountDialog).getByRole("heading", { name: "Usage" })).toBeInTheDocument();
    expect(within(accountDialog).getByRole("listitem", { name: /ChatGPT, 59% left/ })).toBeInTheDocument();
  });

  it("lists each connected provider in the usage popover", async () => {
    vi.mocked(window.openbot.agent.getUsage).mockResolvedValue({
      limits: [
        {
          id: "codex",
          primary: null,
          secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: null },
        },
        {
          id: "claude",
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: null },
          secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: null },
        },
      ],
    });

    render(() => <App />);
    // The active agent runs on ChatGPT, so a spent Claude quota stays out of the chip.
    const usageButton = await screen.findByRole("button", { name: "Usage, ChatGPT 85% left" });
    await fireEvent.click(usageButton);
    const usageDialog = screen.getByRole("dialog", { name: "Usage" });
    expect(within(usageDialog).getByRole("listitem", { name: /Claude, 0% left/ })).toBeInTheDocument();
    expect(within(usageDialog).getByRole("listitem", { name: /ChatGPT, 85% left/ })).toBeInTheDocument();
  });

  it("keeps host-wide usage when an earlier request finishes late", async () => {
    let resolveInitialUsage!: (usage: AccountUsage) => void;
    const initialUsageRequest = new Promise<AccountUsage>((resolve) => {
      resolveInitialUsage = resolve;
    });
    vi.mocked(window.openbot.agent.getUsage)
      .mockReturnValueOnce(initialUsageRequest)
      .mockResolvedValueOnce({
        limits: [
          {
            id: "codex",
            primary: null,
            secondary: { usedPercent: 82, windowDurationMins: 10_080, resetsAt: null },
          },
        ],
      });

    render(() => <App />);
    await waitFor(() => expect(window.openbot.agent.getUsage).toHaveBeenCalledTimes(1));

    emitAgentEvent?.({
      type: "usage-changed",
      usage: {
        limits: [
          {
            id: "codex",
            primary: null,
            secondary: { usedPercent: 82, windowDurationMins: 10_080, resetsAt: null },
          },
        ],
      },
    });
    expect(await screen.findByRole("button", { name: "Usage, ChatGPT 18% left" })).toBeInTheDocument();
    expect(window.openbot.agent.getUsage).toHaveBeenCalledTimes(1);

    resolveInitialUsage({
      limits: [
        {
          id: "claude",
          primary: null,
          secondary: { usedPercent: 41, windowDurationMins: 10_080, resetsAt: null },
        },
      ],
    });
    await initialUsageRequest;
    await Promise.resolve();

    expect(screen.getByRole("button", { name: "Usage, ChatGPT 18% left" })).toBeInTheDocument();
  });

  it("replaces an in-flight usage request after usage is invalidated", async () => {
    let resolveInitialUsage!: (usage: AccountUsage) => void;
    const initialUsageRequest = new Promise<AccountUsage>((resolve) => {
      resolveInitialUsage = resolve;
    });
    vi.mocked(window.openbot.agent.getUsage)
      .mockReturnValueOnce(initialUsageRequest)
      .mockResolvedValueOnce({
        limits: [
          {
            id: "codex",
            primary: null,
            secondary: { usedPercent: 72, windowDurationMins: 10_080, resetsAt: null },
          },
        ],
      });

    render(() => <App />);
    await waitFor(() => expect(window.openbot.agent.getUsage).toHaveBeenCalledTimes(1));

    emitAgentEvent?.({
      type: "usage-changed",
      usage: {
        limits: [
          {
            id: "codex",
            primary: null,
            secondary: { usedPercent: 72, windowDurationMins: 10_080, resetsAt: null },
          },
        ],
      },
    });
    expect(await screen.findByRole("button", { name: "Usage, ChatGPT 28% left" })).toBeInTheDocument();
    expect(window.openbot.agent.getUsage).toHaveBeenCalledTimes(1);

    resolveInitialUsage({
      limits: [
        {
          id: "codex",
          primary: null,
          secondary: { usedPercent: 41, windowDurationMins: 10_080, resetsAt: null },
        },
      ],
    });
    await initialUsageRequest;
    expect(screen.getByRole("button", { name: "Usage, ChatGPT 28% left" })).toBeInTheDocument();
  });

  it("persists every settings preference through its own IPC channel", async () => {
    vi.mocked(window.openbot.update.getPreference).mockResolvedValue({ autoDownload: false });
    render(() => <App />);
    await fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    await fireEvent.click(await screen.findByRole("switch", { name: "Share product analytics" }));
    await waitFor(() => expect(window.openbot.setAnalyticsPreference).toHaveBeenCalledWith({ enabled: false }));

    await fireEvent.click(await screen.findByRole("tab", { name: "Dynamic Island" }));
    const notchSwitch = await screen.findByRole("switch", { name: "Show status in the MacBook notch" });
    expect(notchSwitch).toBeChecked();
    await fireEvent.click(notchSwitch);
    await waitFor(() =>
      expect(window.openbot.dynamicIsland.setPreference).toHaveBeenCalledWith({
        enabled: false,
        hapticsEnabled: true,
        idleVisible: true,
        additionalDisplaysEnabled: true,
        widthPercent: 100,
        heightPercent: 100,
      }),
    );
    expect(notchSwitch).not.toBeChecked();

    await fireEvent.click(await screen.findByRole("tab", { name: "Updates" }));
    const autoDownload = await screen.findByRole("switch", { name: "Automatically download updates" });
    await waitFor(() => expect(autoDownload).not.toBeChecked());
    await fireEvent.click(autoDownload);
    await waitFor(() => expect(window.openbot.update.setPreference).toHaveBeenCalledWith({ autoDownload: true }));

    // The language row lives in the General tab, which the Updates tab hides through CSS that jsdom
    // does not apply. Go back to it, so the test reaches the control the way a user does.
    await fireEvent.click(screen.getByRole("tab", { name: "General" }));
    // The trigger reads its label and its value, so match the start of the name. It also opens on
    // pointer down rather than on click, so a plain click never reaches the list.
    await fireEvent.pointerDown(screen.getByRole("button", { name: /^Language/ }), { pointerType: "mouse", button: 0 });
    await fireEvent.click(await screen.findByRole("option", { name: "Français" }));
    await waitFor(() => expect(window.openbot.setAppLanguagePreference).toHaveBeenCalledWith({ language: "fr" }));
    // The screen is written in the chosen language at once, with no restart: the tab the user is
    // looking at is the same tab, now named in French.
    await screen.findByRole("tab", { name: "Général" });
    // The document says which language it is in, so a screen reader speaks it with the right voice.
    expect(document.documentElement.lang).toBe("fr");
  });

  it("does not open desktop analytics when the saved preference is disabled", async () => {
    vi.mocked(window.openbot.getAnalyticsPreference).mockResolvedValueOnce({ enabled: false });
    const setTrackingEnabled = vi.spyOn(desktopAnalytics, "setTrackingEnabled");
    render(() => <App />);

    await screen.findByRole("heading", { name: "Chief" });
    await waitFor(() => expect(setTrackingEnabled).toHaveBeenCalledWith(false));
    expect(trackAnalytics).not.toHaveBeenCalledWith("desktop_app_opened", expect.anything());
    setTrackingEnabled.mockRestore();
  });

  it("signs out from the account menu without removing local data", async () => {
    render(() => <App />);
    await fireEvent.click(await screen.findByRole("button", { name: "Open account actions" }));
    await fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(window.openbot.auth.logout).toHaveBeenCalledOnce());
    expect(trackAnalytics).toHaveBeenCalledWith("account_sign_out", { result: "succeeded" });
    expect(await screen.findByRole("heading", { name: "Sign in to OpenBot" })).toBeInTheDocument();
    expect(window.openbot.agent.deleteAgent).not.toHaveBeenCalled();
  });

  it("shows an available update, downloads it, and exposes restart to install", async () => {
    vi.mocked(window.openbot.update.getStatus).mockResolvedValueOnce({
      phase: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      progress: null,
      checkedAt: "2026-08-12T22:00:00.000Z",
      message: null,
      errorCode: null,
    });
    render(() => <App />);

    expect(await screen.findByText("New update available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open account actions" }));
    fireEvent.click(await screen.findByRole("button", { name: /Download update/ }));
    await waitFor(() => expect(window.openbot.update.download).toHaveBeenCalledOnce());
    expect(trackAnalytics).toHaveBeenCalledWith("update_action", {
      action: "download",
      result: "succeeded",
      phase: "downloading",
    });

    emitUpdateStatus?.({
      phase: "ready",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      progress: 100,
      checkedAt: "2026-08-12T22:00:00.000Z",
      message: null,
      errorCode: null,
    });
    fireEvent.click(await screen.findByRole("button", { name: /Restart to update/ }));
    await waitFor(() => expect(window.openbot.update.install).toHaveBeenCalledOnce());
  });

  it.each([
    [
      "Could not check for updates. Try again.",
      "Could not check for updates. Try again.",
      "Could not download update. Try again.",
      "Could not download update. Try again.",
    ],
    [
      "ENOSPC: write '/private/update.zip'",
      "There is not enough storage space. Free some space on the computer running OpenBot, then try again.",
      "Error invoking remote method 'update:download': Error: ECONNREFUSED 127.0.0.1:1234",
      "Could not connect. Check your connection and try again.",
    ],
  ])(
    "reports update failures with recovery guidance: %s",
    async (statusError, statusMessage, rejectedError, rejectedMessage) => {
      vi.mocked(window.openbot.update.getStatus).mockResolvedValueOnce({
        phase: "available",
        currentVersion: "0.1.0",
        availableVersion: "0.2.0",
        progress: null,
        checkedAt: null,
        message: null,
        errorCode: null,
      });
      vi.mocked(window.openbot.update.download)
        .mockResolvedValueOnce({
          phase: "error",
          currentVersion: "0.1.0",
          availableVersion: "0.2.0",
          progress: null,
          checkedAt: "2026-08-12T22:00:00.000Z",
          message: statusError,
          errorCode: "download_failed",
        })
        .mockRejectedValueOnce(new Error(rejectedError));
      render(() => <App />);

      fireEvent.click(await screen.findByRole("button", { name: "Open account actions" }));
      fireEvent.click(await screen.findByRole("button", { name: /Download update/ }));

      await waitFor(() =>
        expect(trackAnalytics).toHaveBeenCalledWith("update_action", {
          action: "download",
          result: "failed",
          phase: "error",
          failure_code: "download_failed",
        }),
      );
      const retryAfterReturnedError = await screen.findByRole("button", {
        name: `Retry update. ${statusMessage}`,
      });
      expect(retryAfterReturnedError).toBeEnabled();

      fireEvent.click(retryAfterReturnedError);

      expect(await screen.findByRole("button", { name: `Retry update. ${rejectedMessage}` })).toBeEnabled();
      await waitFor(() => expect(window.openbot.update.download).toHaveBeenCalledTimes(2));
      expect(window.openbot.update.check).not.toHaveBeenCalled();
    },
  );

  it("states why a check failed in the account menu and recovers when the retry succeeds", async () => {
    vi.mocked(window.openbot.update.getStatus).mockResolvedValueOnce({
      phase: "error",
      currentVersion: "0.9.0",
      availableVersion: null,
      progress: null,
      checkedAt: "2026-09-14T11:40:00.000Z",
      message: "Could not reach the update service. Check your internet connection, then try again.",
      errorCode: "check_failed",
    });
    vi.mocked(window.openbot.update.check).mockResolvedValueOnce({
      phase: "up-to-date",
      currentVersion: "0.9.0",
      availableVersion: null,
      progress: null,
      checkedAt: "2026-09-14T11:41:00.000Z",
      message: null,
      errorCode: null,
    });
    render(() => <App />);

    fireEvent.click(await screen.findByRole("button", { name: "Open account actions" }));
    // The whole sentence is on screen, and it names the cause rather than only asking for a retry.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the update service. Check your internet connection, then try again.",
    );

    fireEvent.click(await screen.findByRole("button", { name: /Check for updates/ }));

    await waitFor(() => expect(window.openbot.update.check).toHaveBeenCalledOnce());
    // A successful retry clears the failure instead of leaving it under a working updater.
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByRole("button", { name: /Check for updates/ })).toBeEnabled();
  });

  it("keeps a toggle made before the stored preference finishes loading", async () => {
    let resolvePreference: ((value: { autoDownload: boolean }) => void) | undefined;
    vi.mocked(window.openbot.update.getPreference).mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePreference = resolve;
      }),
    );
    render(() => <App />);

    await fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await fireEvent.click(await screen.findByRole("tab", { name: "Updates" }));
    const toggle = await screen.findByRole("switch", { name: "Automatically download updates" });
    await fireEvent.click(toggle);
    await waitFor(() => expect(window.openbot.update.setPreference).toHaveBeenCalledWith({ autoDownload: false }));

    // The stored read finally lands with the value the user has just replaced. Painting it back would
    // leave the switch disagreeing with both disk and the main process.
    resolvePreference?.({ autoDownload: true });
    // Let the hydration continuation actually run, otherwise this asserts before it could apply.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(toggle).not.toBeChecked();
  });

  it("confirms an installed app version on the next launch", async () => {
    const configureAnalytics = vi.spyOn(desktopAnalytics, "configure").mockReturnValue(true);
    window.localStorage.setItem("openbot:analytics-app-version", "0.0.9");
    render(() => <App />);

    await waitFor(() =>
      expect(trackAnalytics).toHaveBeenCalledWith("app_updated", {
        from_version: "0.0.9",
        to_version: "0.1.0",
      }),
    );
    expect(window.localStorage.getItem("openbot:analytics-app-version")).toBe("0.1.0");
    configureAnalytics.mockRestore();
  });

  it("selects a provider and model from the conversation header", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    const trigger = screen.getByRole("button", { name: "Agent model: GPT-5.6 Luna" });
    await fireEvent.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Choose agent model" });
    expect(within(picker).getByText("0.144.1 (Codex CLI)")).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "GPT-5.6 Luna" })).toHaveAttribute("aria-selected", "true");

    await fireEvent.click(within(picker).getByRole("tab", { name: /^Claude:/ }));
    expect(window.openbot.agent.updateAgent).not.toHaveBeenCalled();
    expect(within(picker).getByText("2.1.231 (Claude Code)")).toBeInTheDocument();
    await fireEvent.click(within(picker).getByRole("option", { name: "Claude Opus 5" }));

    await waitFor(() =>
      expect(window.openbot.agent.updateAgent).toHaveBeenCalledWith({
        agentId: "chief",
        model: "claude-opus-5",
        provider: "claude",
        reasoningEffort: "medium",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Choose agent model" })).toBeInTheDocument();
    const claudeTrigger = await screen.findByRole("button", {
      name: "Agent model: Claude Opus 5",
    });
    expect(claudeTrigger).toBeEnabled();
  });

  it("persists rapid model and effort changes in order as complete settings", async () => {
    const chief = AGENTS.find((agent) => agent.id === "chief");
    if (!chief) throw new Error("Chief fixture is missing");
    let resolveModelUpdate!: (agent: AgentSummary) => void;
    vi.mocked(window.openbot.agent.updateAgent)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveModelUpdate = resolve;
          }),
      )
      .mockImplementationOnce(async (input) => ({
        ...chief,
        ...input,
        provider: "claude",
        model: "claude-opus-5",
      }));
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await fireEvent.click(screen.getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    const picker = screen.getByRole("dialog", { name: "Choose agent model" });
    await fireEvent.click(within(picker).getByRole("tab", { name: /^Claude:/ }));
    await fireEvent.click(within(picker).getByRole("option", { name: "Claude Opus 5" }));
    const effort = within(picker).getByRole("button", { name: /Agent reasoning effort/ });
    await fireEvent.pointerDown(effort, { pointerType: "mouse", button: 0 });
    await fireEvent.click(screen.getByRole("option", { name: "High" }));

    expect(window.openbot.agent.updateAgent).toHaveBeenCalledTimes(1);
    expect(effort).toHaveTextContent("High");
    resolveModelUpdate({
      ...chief,
      provider: "claude",
      model: "claude-opus-5",
      reasoningEffort: "medium",
    });

    await waitFor(() =>
      expect(vi.mocked(window.openbot.agent.updateAgent).mock.calls).toEqual([
        [
          {
            agentId: "chief",
            provider: "claude",
            model: "claude-opus-5",
            reasoningEffort: "medium",
          },
        ],
        [
          {
            agentId: "chief",
            reasoningEffort: "high",
          },
        ],
      ]),
    );
    expect(window.openbot.agent.updateAgent).toHaveBeenLastCalledWith({
      agentId: "chief",
      reasoningEffort: "high",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("button", { name: "Agent model: Claude Opus 5" })).toBeEnabled();
    expect(effort).toHaveTextContent("High");
  });

  it("does not send a queued settings save to the server the user switched to", async () => {
    const local = testServer("local", true);
    const remote = testServer("remote-1", false);
    let resolveModelUpdate!: (agent: AgentSummary) => void;
    vi.mocked(window.openbot.servers.list).mockResolvedValueOnce([local, remote]);
    vi.mocked(window.openbot.servers.select).mockImplementation(async (serverId) => [
      { ...local, active: serverId === "local" },
      { ...remote, active: serverId === "remote-1" },
    ]);
    vi.mocked(window.openbot.agent.updateAgent).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveModelUpdate = resolve;
        }),
    );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await fireEvent.click(screen.getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    const picker = screen.getByRole("dialog", { name: "Choose agent model" });
    await fireEvent.click(within(picker).getByRole("tab", { name: /^Claude:/ }));
    await fireEvent.click(within(picker).getByRole("option", { name: "Claude Opus 5" }));
    await fireEvent.click(within(picker).getByRole("option", { name: "Claude Sonnet 5" }));
    expect(window.openbot.agent.updateAgent).toHaveBeenCalledOnce();

    await fireEvent.keyDown(picker, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose agent model" })).not.toBeInTheDocument());
    await fireEvent.click(screen.getByRole("button", { name: "Studio Mac server" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Studio Mac server" })).toHaveAttribute("aria-pressed", "true"),
    );

    const chief = AGENTS.find((agent) => agent.id === "chief");
    if (!chief) throw new Error("Chief fixture is missing");
    resolveModelUpdate({ ...chief, provider: "claude", model: "claude-opus-5", reasoningEffort: "medium" });
    await fireEvent.click(screen.getByRole("button", { name: "Local server" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Local server" })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(vi.mocked(window.openbot.agent.updateAgent).mock.calls).toEqual([
      [{ agentId: "chief", provider: "claude", model: "claude-opus-5", reasoningEffort: "medium" }],
    ]);
  });

  it("rolls back a queued effort when its model save fails", async () => {
    let rejectModelUpdate!: (error: Error) => void;
    vi.mocked(window.openbot.agent.updateAgent).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectModelUpdate = reject;
        }),
    );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await fireEvent.click(screen.getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    const picker = screen.getByRole("dialog", { name: "Choose agent model" });
    await fireEvent.click(within(picker).getByRole("option", { name: "GPT-5.6 Sol" }));
    const effort = within(picker).getByRole("button", { name: /Agent reasoning effort/ });
    await fireEvent.pointerDown(effort, { pointerType: "mouse", button: 0 });
    await fireEvent.click(screen.getByRole("option", { name: "Extra high" }));

    expect(window.openbot.agent.updateAgent).toHaveBeenCalledTimes(1);
    rejectModelUpdate(new Error("Model failed"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not change effort. Try again.");
    expect(window.openbot.agent.updateAgent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Agent model: GPT-5.6 Luna" })).toBeEnabled();
    expect(effort).toHaveTextContent("Medium");
    await fireEvent.click(screen.getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
  });

  it("rolls back a failed header model change and reports the error", async () => {
    vi.mocked(window.openbot.agent.updateAgent).mockRejectedValueOnce(new Error("Provider failed"));
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await screen.findByRole("button", { name: "Agent model: GPT-5.6 Luna" });

    await fireEvent.click(screen.getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    await fireEvent.click(screen.getByRole("option", { name: "GPT-5.6 Sol" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not change model. Try again.");
    expect(screen.getByRole("button", { name: "Agent model: GPT-5.6 Luna" })).toBeEnabled();
    expect(
      screen.queryByRole("radiogroup", { name: "What do you want me helping with most?" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Message Chief")).toHaveAttribute("contenteditable", "true");
  });

  it("permits approval revocation during active work while locking model and effort changes", async () => {
    vi.mocked(window.openbot.getApprovalAutomation).mockResolvedValue({
      turbo: false,
      defaultAutoApprove: false,
      autoApproveOverrides: { chief: true },
    });
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const trigger = screen.getByRole("button", { name: "Agent model: GPT-5.6 Luna" });
    await waitFor(() => expect(trigger).toBeEnabled());
    await fireEvent.click(trigger);
    await screen.findByRole("option", { name: "GPT-5.6 Sol" });

    emitAgentEvent?.({
      type: "turn-started",
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-1",
    });
    await waitFor(() => expect(screen.getByRole("option", { name: "GPT-5.6 Sol" })).toBeDisabled());
    expect(trigger).toBeEnabled();
    expect(screen.getByRole("button", { name: /Agent reasoning effort/ })).toBeDisabled();
    const approval = screen.getByRole("switch", { name: "Auto approve this agent's actions" });
    expect(approval).toBeChecked();
    await fireEvent.click(approval);
    await waitFor(() => expect(approval).not.toBeChecked());
    expect(window.openbot.setApprovalAutomation).toHaveBeenCalledWith({ agentId: "chief", autoApprove: false });

    emitAgentEvent?.({
      type: "turn-completed",
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-1",
      status: "completed",
    });
    await waitFor(() => expect(screen.getByRole("option", { name: "GPT-5.6 Sol" })).toBeEnabled());
    expect(screen.getByRole("button", { name: /Agent reasoning effort/ })).toBeEnabled();
    expect(trackAnalytics).not.toHaveBeenCalledWith("system_turn_started", expect.anything());
    expect(trackAnalytics).not.toHaveBeenCalledWith("system_turn_completed", expect.anything());
  });

  it("propagates an agent rename across the workspace without a refresh", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const started = {
      type: "turn-started",
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-rename",
    } as const;
    await waitFor(() => expect(emitScopedAgentEvent).toBeDefined());
    emitAgentEvent?.(started);
    emitScopedAgentEvent?.({ serverId: "local", event: started });
    await waitFor(() =>
      expect(vi.mocked(window.openbot.dynamicIsland.publishPresentation).mock.calls.at(-1)?.[0]).toMatchObject({
        mode: "working",
        working: [{ agent: { id: "chief", name: "Chief" } }],
      }),
    );

    await fireEvent.click(screen.getByRole("button", { name: "View agent settings" }));
    const name = await screen.findByRole("textbox", { name: "Agent name" });
    await fireEvent.input(name, { target: { value: "Coordinator" } });
    await fireEvent.blur(name);

    await waitFor(() =>
      expect(window.openbot.agent.updateAgent).toHaveBeenCalledWith({ agentId: "chief", name: "Coordinator" }),
    );
    expect(await screen.findByRole("heading", { name: "Coordinator" })).toBeInTheDocument();
    expect(screen.getByLabelText("Message Coordinator")).toHaveAttribute("contenteditable", "true");
    expect(screen.getByRole("button", { name: /Coordinator, Chief of staff/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(window.openbot.dynamicIsland.publishPresentation).mock.calls.at(-1)?.[0]).toMatchObject({
        mode: "working",
        working: [{ agent: { id: "chief", name: "Coordinator" } }],
      }),
    );

    await fireEvent.click(screen.getByRole("button", { name: /Sales Outbound/ }));
    await fireEvent.click(screen.getByRole("button", { name: /Coordinator, Chief of staff/ }));
    expect(await screen.findByRole("heading", { name: "Coordinator" })).toBeInTheDocument();
  });

  it("removes a custom agent avatar and keeps its generated avatar settings", async () => {
    vi.mocked(window.openbot.agent.listAgents).mockResolvedValueOnce([
      { ...AGENTS[0], avatarUrl: "openbot-avatar://agent/chief?v=image-1" },
    ]);
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(screen.getByRole("button", { name: "View agent settings" }));
    const settings = await screen.findByRole("complementary", { name: "Agent settings" });
    await fireEvent.click(within(settings).getByRole("button", { name: "Edit agent avatar" }));
    const editor = within(settings).getByRole("dialog", { name: "Avatar editor" });
    await fireEvent.click(within(editor).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(window.openbot.agent.setAvatar).toHaveBeenCalledWith({ agentId: "chief", image: null }));
    expect(window.openbot.agent.updateAgent).not.toHaveBeenCalledWith(
      expect.objectContaining({ avatarSeed: expect.any(String) }),
    );
  });

  it("closes only the open popover when Escape is pressed in agent settings", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(screen.getByRole("button", { name: "View agent settings" }));
    const settings = await screen.findByRole("complementary", { name: "Agent settings" });
    await fireEvent.click(within(settings).getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));

    await fireEvent.keyDown(within(settings).getByRole("dialog", { name: "Choose agent model" }), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose agent model" })).not.toBeInTheDocument());
    expect(screen.getByRole("complementary", { name: "Agent settings" })).toBeInTheDocument();
  });

  it("keeps provider choices separate for each agent profile", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(screen.getByRole("button", { name: "View agent settings" }));
    let settings = await screen.findByRole("complementary", { name: "Agent settings" });
    await fireEvent.click(within(settings).getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    let picker = within(settings).getByRole("dialog", { name: "Choose agent model" });
    await fireEvent.click(within(picker).getByRole("tab", { name: /^Claude:/ }));
    await fireEvent.click(within(picker).getByRole("option", { name: "Claude Opus 5" }));

    await fireEvent.click(screen.getByRole("button", { name: /Sales Outbound/ }));
    await fireEvent.click(screen.getByRole("button", { name: "View agent settings" }));
    settings = await screen.findByRole("complementary", { name: "Agent settings" });
    expect(within(settings).getByRole("button", { name: "Agent model: GPT-5.6 Luna" })).toBeEnabled();

    await fireEvent.click(within(settings).getByRole("button", { name: "Agent model: GPT-5.6 Luna" }));
    picker = within(settings).getByRole("dialog", { name: "Choose agent model" });
    await fireEvent.click(within(picker).getByRole("tab", { name: /^Claude:/ }));
    await fireEvent.click(within(picker).getByRole("option", { name: "Claude Opus 5" }));
    await waitFor(() =>
      expect(window.openbot.agent.updateAgent).toHaveBeenCalledWith({
        agentId: "sales-outbound",
        model: "claude-opus-5",
        provider: "claude",
        reasoningEffort: "medium",
      }),
    );
  });

  it("does not remount agent text fields or discard in-progress edits on agent list refresh", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(screen.getByRole("button", { name: "View agent settings" }));
    const name = await screen.findByRole("textbox", { name: "Agent name" });
    name.focus();
    let draft = "";
    let refresh = 0;
    for (const character of "Draft coordinator name") {
      draft += character;
      await fireEvent.input(name, { target: { value: draft } });
      refresh += 1;
      emitAgentEvent?.({
        type: "agents-changed",
        agents: AGENTS.map((agent) =>
          agent.id === "chief"
            ? { ...agent, preview: `Backend refresh ${refresh}`, notifications: refresh % 2 === 0 }
            : agent,
        ),
      });
      expect(name).toHaveValue(draft);
    }

    expect(screen.getByRole("textbox", { name: "Agent name" })).toBe(name);
    expect(name).toHaveValue("Draft coordinator name");

    const title = screen.getByRole("textbox", { name: "Agent title" });
    title.focus();
    draft = "";
    for (const character of "Research lead") {
      draft += character;
      await fireEvent.input(title, { target: { value: draft } });
      refresh += 1;
      emitAgentEvent?.({
        type: "agents-changed",
        agents: AGENTS.map((agent) =>
          agent.id === "chief"
            ? { ...agent, preview: `Backend refresh ${refresh}`, notifications: refresh % 2 === 0 }
            : agent,
        ),
      });
      expect(title).toHaveValue(draft);
    }
    expect(screen.getByRole("textbox", { name: "Agent title" })).toBe(title);

    const description = screen.getByRole("textbox", { name: "Agent instructions" });
    description.focus();
    draft = "";
    for (const character of "Tracks every research request.") {
      draft += character;
      await fireEvent.input(description, { target: { value: draft } });
      refresh += 1;
      emitAgentEvent?.({
        type: "agents-changed",
        agents: AGENTS.map((agent) =>
          agent.id === "chief"
            ? { ...agent, preview: `Backend refresh ${refresh}`, notifications: refresh % 2 === 0 }
            : agent,
        ),
      });
      expect(description).toHaveValue(draft);
    }
    expect(screen.getByRole("textbox", { name: "Agent instructions" })).toBe(description);
  });

  it("does not remount pinned agents when instructions refresh the agent list", async () => {
    window.localStorage.setItem(
      SIDEBAR_PINS_STORAGE_KEY,
      JSON.stringify({ local: [{ kind: "agent", id: "sales-outbound" }] }),
    );
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const pinnedAgent = screen.getByRole("button", { name: "Sales Outbound, pinned agent" });
    emitAgentEvent?.({
      type: "conversation-page",
      page: testConversationPage(
        "sales-outbound",
        [
          {
            id: "sales-reply",
            author: "assistant",
            text: "I found three prospects.",
            createdAt: "2026-09-18T09:00:00.000Z",
            status: "completed",
          },
        ],
        { readState: { unreadCount: 3, firstUnreadMessageId: "sales-reply", throughMessageId: null } },
      ),
    });
    const notificationCount = await within(pinnedAgent).findByText("3");

    emitAgentEvent?.({
      type: "agents-changed",
      agents: AGENTS.map((agent) =>
        agent.id === "chief" ? { ...agent, description: "Use the updated instructions." } : agent,
      ),
    });

    expect(screen.getByRole("button", { name: "Sales Outbound, pinned agent" })).toBe(pinnedAgent);
    expect(within(pinnedAgent).getByText("3")).toBe(notificationCount);
  });

  it("opens Settings with Command+,", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    expect(screen.queryByRole("dialog", { name: "General" })).not.toBeInTheDocument();
    await fireEvent.keyDown(document.body, { key: ",", metaKey: true });
    expect(await screen.findByRole("dialog", { name: "General" })).toBeInTheDocument();
  });

  it("opens Settings when main sends the Preferences menu event", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    expect(screen.queryByRole("dialog", { name: "General" })).not.toBeInTheDocument();
    const listener = vi.mocked(window.openbot.onOpenSettings).mock.calls[0]?.[0];
    if (!listener) throw new Error("Settings did not subscribe to the Preferences menu event.");
    listener();
    expect(await screen.findByRole("dialog", { name: "General" })).toBeInTheDocument();
  });
});
