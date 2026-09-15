import type { AgentProviderId, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { fireEvent, render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ProviderPicker, type ProviderPickerOption } from "./ProviderPicker";

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

  it("keeps only Cancel on a downloading OpenCode row", () => {
    const downloading = renderPicker([
      { ...openCode, runtimeStatus: runtime({ phase: "downloading", progress: 40, version: null }) },
    ]);
    expect(downloading.view.queryByRole("button", { name: "Sign in to OpenCode" })).toBeNull();
    expect(downloading.view.getByRole("button", { name: "Cancel OpenCode" })).toBeTruthy();
  });

  it("badges the OpenCode row with the free tier, and only while keyless", () => {
    // A saved key leaves the runtime "Connected" to speak for the row: no second chip.
    const saved = renderPicker([{ ...openCode, keyStatus: "saved" }]);
    expect(saved.view.queryByText("Free")).toBeNull();

    const missing = renderPicker([{ ...openCode, keyStatus: "missing" }]);
    expect(missing.view.getByText("Free")).toBeTruthy();

    // An unreadable key runs keyless, so it reads as free as well.
    const unreadable = renderPicker([{ ...openCode, keyStatus: "unreadable" }]);
    expect(unreadable.view.getByText("Free")).toBeTruthy();

    // Unknown until the first read: no badge rather than a wrong one, and never on another row.
    const unknown = renderPicker([openCode, { ...claude, keyStatus: "saved" }]);
    expect(unknown.view.queryByText("Free")).toBeNull();
  });

  it("prints Connected once on a signed-in OpenCode row, and keeps busy states reporting", () => {
    // Steady and signed in: the runtime badge alone, no key chip beside it.
    const steady = renderPicker([{ ...openCode, state: "available", runtimeStatus: runtime({}), keyStatus: "saved" }]);
    expect(steady.view.getAllByText("Connected")).toHaveLength(1);

    // Steady and keyless: the Free tier badge beside the runtime one.
    const keyless = renderPicker([
      { ...openCode, state: "available", runtimeStatus: runtime({}), keyStatus: "missing" },
    ]);
    expect(keyless.view.getByText("Free")).toBeTruthy();
    expect(keyless.view.getByText("Connected")).toBeTruthy();

    // Busy states still report, with no tier chip beside them once signed in.
    const downloading = renderPicker([
      {
        ...openCode,
        runtimeStatus: runtime({ phase: "downloading", progress: 40, version: null }),
        keyStatus: "saved",
      },
    ]);
    expect(downloading.view.getByText("40%")).toBeTruthy();
    expect(downloading.view.queryByText("Free")).toBeNull();
  });
});
