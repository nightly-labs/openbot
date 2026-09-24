import type { AgentProviderId, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { freeModelsReady, type ProviderPickerOption } from "@openbot/ui/components/ProviderPicker";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ProviderPicker } from "./ProviderPicker";

/*
 * The two provider rows OpenBot treats differently.
 *
 * Claude keeps an install guide and a signed-out sign-in button. OpenCode has neither: OpenBot
 * downloads the CLI, and its free models work with no account, so the only thing an account adds is
 * the paid catalog. Both facts are only visible as buttons, so they are asserted as buttons.
 */
const openCode: ProviderPickerOption = {
  id: "opencode",
  name: "OpenCode",
  state: "not-installed",
  message: null,
};

const claude: ProviderPickerOption = {
  id: "claude",
  name: "Claude",
  state: "not-installed",
  message: null,
};

function runtime(status: Partial<ProviderRuntimeStatus>): ProviderRuntimeStatus {
  return { phase: "ready", progress: null, message: null, version: "1.18.30", ...status };
}

function renderPicker(
  options: ProviderPickerOption[],
  onSignInProvider = vi.fn(),
  onConnectProvider?: (provider: AgentProviderId) => void | Promise<void>,
) {
  const view = render(() => (
    <ProviderPicker
      value="opencode"
      options={options}
      ariaLabel="AI providers"
      allowUnavailableSelection
      onChange={vi.fn()}
      onInstallProvider={vi.fn()}
      onConnectProvider={onConnectProvider}
      onSignInProvider={onSignInProvider}
    />
  ));
  return { view, onSignInProvider, onConnectProvider };
}

describe("ProviderPicker", () => {
  it("sends a user to no install page for OpenCode, and falls back to Sign in with no runtime", () => {
    const { view, onSignInProvider } = renderPicker([claude, openCode]);

    // Claude is the control: the same state and the same handlers still produce an Install button,
    // so the missing one below is the descriptor's decision and not the test's setup.
    expect(view.getByRole("button", { name: "Install Claude" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Install OpenCode" })).toBeNull();

    // No runtime on the row, so no Reconnect to carry the dialog: the fallback Sign in does.
    const signIn = view.getByRole("button", { name: "Sign in to OpenCode" });
    fireEvent.click(signIn);
    expect(onSignInProvider).toHaveBeenCalledWith("opencode");
    // Claude asks for a sign-in only while it is signed out, which `not-installed` is not.
    expect(view.queryByRole("button", { name: "Sign in to Claude" })).toBeNull();
  });

  it("reads free models as ready only once the OpenCode runtime is on disk", () => {
    const signedOut = { ...openCode, freeModels: true, state: "sign-in-required" as const };
    // Setup must not continue on a runtime status that has not arrived: nothing would start it.
    expect(freeModelsReady(signedOut)).toBe(false);
    expect(freeModelsReady({ ...signedOut, runtimeStatus: runtime({ phase: "not-downloaded" }) })).toBe(false);
    expect(freeModelsReady({ ...signedOut, runtimeStatus: runtime({}) })).toBe(true);
  });

  it("opens the OpenCode key dialog from Reconnect, with no second Sign in button", () => {
    const onConnectProvider = vi.fn();
    const { view, onSignInProvider } = renderPicker(
      [{ ...openCode, state: "available", runtimeStatus: runtime({}) }],
      vi.fn(),
      onConnectProvider,
    );

    // One key button on a downloaded row: Reconnect carries the dialog, so Sign in stays away.
    expect(view.queryByRole("button", { name: "Sign in to OpenCode" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Reconnect OpenCode" }));
    expect(onSignInProvider).toHaveBeenCalledWith("opencode");
    expect(onConnectProvider).not.toHaveBeenCalled();
  });

  it("keeps Connect and Restart on the provider connection, with the dialog only on Reconnect", () => {
    const onSignInProvider = vi.fn();
    const onConnectProvider = vi.fn();
    const renderRow = (option: ProviderPickerOption) => renderPicker([option], onSignInProvider, onConnectProvider);

    // A failed provider offers a retry that needs no key, beside the dialog that replaces the
    // key blocking startup.
    const failed = renderRow({ ...openCode, state: "error", runtimeStatus: runtime({}) });
    fireEvent.click(failed.view.getByRole("button", { name: "Connect OpenCode" }));
    expect(onConnectProvider).toHaveBeenCalledWith("opencode");
    fireEvent.click(failed.view.getByRole("button", { name: "Sign in to OpenCode" }));
    expect(onSignInProvider).toHaveBeenCalledWith("opencode");

    // A connecting provider offers a restart that needs no key either.
    const restarting = renderRow({
      ...openCode,
      state: "available",
      connectionState: "connecting",
      runtimeStatus: runtime({}),
    });
    fireEvent.click(restarting.view.getByRole("button", { name: "Restart OpenCode" }));
    expect(onConnectProvider).toHaveBeenCalledWith("opencode");
    fireEvent.click(restarting.view.getByRole("button", { name: "Sign in to OpenCode" }));
    expect(onSignInProvider).toHaveBeenCalledTimes(2);
  });

  it("keeps only Cancel on a downloading OpenCode row", () => {
    const downloading = renderPicker([
      { ...openCode, runtimeStatus: runtime({ phase: "downloading", progress: 40, version: null }) },
    ]);
    expect(downloading.view.queryByRole("button", { name: "Sign in to OpenCode" })).toBeNull();
    expect(downloading.view.getByRole("button", { name: "Cancel OpenCode" })).toBeTruthy();
  });

  it("offers the code sign-in on a connected row, and not while the runtime is still downloading", () => {
    const onSignInWithCodeProvider = vi.fn();
    const codex: ProviderPickerOption = { id: "codex", name: "ChatGPT", state: "available", message: null };
    const menu = (option: ProviderPickerOption) =>
      render(() => (
        <ProviderPicker
          value="codex"
          options={[option]}
          ariaLabel="AI providers"
          allowUnavailableSelection
          onChange={vi.fn()}
          onSignInProvider={vi.fn()}
          onSignInWithCodeProvider={onSignInWithCodeProvider}
        />
      )).queryByRole("button", { name: "More actions for ChatGPT" });

    // Signed in is not a reason to hide it: this is the way to a second account.
    expect(menu(codex)).toBeTruthy();
    expect(menu({ ...codex, state: "sign-in-required" })).toBeTruthy();
    // Nothing to ask for a code with until the CLI is on the computer.
    expect(
      menu({ ...codex, runtimeStatus: runtime({ phase: "downloading", progress: 40, version: null }) }),
    ).toBeNull();
    // Claude has no code sign-in, so its row has no menu to hold one.
    expect(
      render(() => (
        <ProviderPicker
          value="claude"
          options={[{ ...claude, state: "available" }]}
          ariaLabel="AI providers"
          allowUnavailableSelection
          onChange={vi.fn()}
          onSignInProvider={vi.fn()}
          onSignInWithCodeProvider={onSignInWithCodeProvider}
        />
      )).queryByRole("button", { name: "More actions for Claude" }),
    ).toBeNull();
  });

  it("offers Update in every downloaded row's actions menu, and a check where no newer version is known", async () => {
    const onUpdateProvider = vi.fn();
    const view = render(() => (
      <ProviderPicker
        value="claude"
        options={[
          {
            ...claude,
            state: "available",
            runtimeStatus: runtime({ version: "2.1.246" }),
            availableVersion: "2.1.250",
          },
          { ...openCode, state: "available", runtimeStatus: runtime({}), availableVersion: null },
          { ...openCode, id: "grok", name: "Grok", runtimeStatus: runtime({ phase: "not-downloaded", version: null }) },
        ]}
        ariaLabel="AI providers"
        allowUnavailableSelection
        onChange={vi.fn()}
        onUpdateProvider={onUpdateProvider}
      />
    ));
    const openMenu = (name: string) =>
      fireEvent.pointerDown(view.getByRole("button", { name: `More actions for ${name}` }), { button: 0 });

    // Nothing on the computer to update yet.
    expect(view.queryByRole("button", { name: "More actions for Grok" })).toBeNull();

    await openMenu("OpenCode");
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Check for updates" }), { button: 0 });
    await waitFor(() => expect(onUpdateProvider).toHaveBeenCalledWith("opencode"));

    await openMenu("Claude");
    await fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "Update to 2.1.250" }), { button: 0 });
    await waitFor(() => expect(onUpdateProvider).toHaveBeenCalledWith("claude"));
  });

  it("badges the tier and connection state without doubling them", () => {
    // A saved key leaves the runtime "Connected" to speak for the row: no second chip.
    expect(renderPicker([{ ...openCode, keyStatus: "saved" }]).view.queryByText("Free")).toBeNull();

    // Keyless rows read as free, including when the key is unreadable.
    expect(renderPicker([{ ...openCode, keyStatus: "missing" }]).view.getByText("Free")).toBeTruthy();
    expect(renderPicker([{ ...openCode, keyStatus: "unreadable" }]).view.getByText("Free")).toBeTruthy();

    // Unknown until the first read: no badge rather than a wrong one, and never on another row.
    expect(renderPicker([openCode, { ...claude, keyStatus: "saved" }]).view.queryByText("Free")).toBeNull();

    // Steady and signed in: the runtime badge alone, printed once.
    const steady = renderPicker([{ ...openCode, state: "available", runtimeStatus: runtime({}), keyStatus: "saved" }]);
    expect(steady.view.getAllByText("Connected")).toHaveLength(1);

    // Steady and keyless: the Free tier badge beside the runtime one.
    const keyless = renderPicker([
      { ...openCode, state: "available", runtimeStatus: runtime({}), keyStatus: "missing" },
    ]);
    expect(keyless.view.getByText("Free")).toBeTruthy();
    expect(keyless.view.getByText("Connected")).toBeTruthy();

    // Busy states still report, with no tier chip beside them once signed in. Main holds the
    // provider "connecting" for the whole install, so the row reports the download, not the word.
    const downloading = renderPicker([
      {
        ...openCode,
        connectionState: "connecting",
        runtimeStatus: runtime({ phase: "downloading", progress: 40, version: null }),
        keyStatus: "saved",
      },
    ]);
    expect(downloading.view.getByText("40%")).toBeTruthy();
    expect(downloading.view.queryByText("Free")).toBeNull();
    expect(downloading.view.queryByText("Connecting")).toBeNull();
  });

  it("keeps the managed download reachable while the providers are being checked", async () => {
    const onDownloadProvider = vi.fn();
    const view = render(() => (
      <ProviderPicker
        value="opencode"
        options={[
          { ...claude, runtimeStatus: runtime({ phase: "not-downloaded", version: null }) },
          { ...openCode, state: "available", runtimeStatus: runtime({}) },
        ]}
        ariaLabel="AI providers"
        allowUnavailableSelection
        refreshingProviders
        onChange={vi.fn()}
        onDownloadProvider={onDownloadProvider}
        onConnectProvider={vi.fn()}
      />
    ));

    // The download is a file transfer main's runtime store owns, so a provider check that has not
    // finished - or never will - must not take it away: it is what ends the check.
    const download = view.getByRole("button", { name: "Download Claude" });
    expect(download).toBeEnabled();
    await fireEvent.click(download);
    expect(onDownloadProvider).toHaveBeenCalledWith("claude");

    // The CLI is what a reconnect asks, so that one still waits.
    expect(view.getByRole("button", { name: "Reconnect OpenCode" })).toBeDisabled();
  });
});
