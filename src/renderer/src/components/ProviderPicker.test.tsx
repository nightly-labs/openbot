import type { ProviderRuntimeStatus } from "@openbot/contracts/ipc";
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

function renderPicker(options: ProviderPickerOption[], onSignInProvider = vi.fn()) {
  const view = render(() => (
    <ProviderPicker
      value="opencode"
      options={options}
      ariaLabel="AI providers"
      allowUnavailableSelection
      onChange={vi.fn()}
      onInstallProvider={vi.fn()}
      onSignInProvider={onSignInProvider}
    />
  ));
  return { view, onSignInProvider };
}

describe("ProviderPicker", () => {
  it("sends a user to no install page for OpenCode, and offers the optional key instead", () => {
    const { view, onSignInProvider } = renderPicker([claude, openCode]);

    // Claude is the control: the same state and the same handlers still produce an Install button,
    // so the missing one below is the descriptor's decision and not the test's setup.
    expect(view.getByRole("button", { name: "Install Claude" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Install OpenCode" })).toBeNull();

    const signIn = view.getByRole("button", { name: "Sign in to OpenCode" });
    fireEvent.click(signIn);
    expect(onSignInProvider).toHaveBeenCalledWith("opencode");
    // Claude asks for a sign-in only while it is signed out, which `not-installed` is not.
    expect(view.queryByRole("button", { name: "Sign in to Claude" })).toBeNull();
  });

  it("keeps the OpenCode key button on a downloaded row and drops it during the download", () => {
    const ready = renderPicker([{ ...openCode, state: "available", runtimeStatus: runtime({}) }]);
    expect(ready.view.getByRole("button", { name: "Sign in to OpenCode" })).toBeTruthy();

    const downloading = renderPicker([
      { ...openCode, runtimeStatus: runtime({ phase: "downloading", progress: 40, version: null }) },
    ]);
    expect(downloading.view.queryByRole("button", { name: "Sign in to OpenCode" })).toBeNull();
  });
});
