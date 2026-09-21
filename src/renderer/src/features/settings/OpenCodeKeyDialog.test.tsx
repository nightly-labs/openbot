import { OpenCodeKeyDialog, type ProviderKeyApi } from "@openbot/ui/features/settings/OpenCodeKeyDialog";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

/*
 * The one place a user's OpenCode Go key enters OpenBot.
 *
 * Two things are asserted about the secret itself: exactly what reaches `setProviderApiKey`, and
 * that a key already saved never comes back into the input. Main keeps no getter for a stored key,
 * so a dialog that could show one would be inventing it -- and would then carry it into every
 * screenshot after that.
 */
function createApi(overrides: Partial<ProviderKeyApi> = {}) {
  return {
    getProviderApiKeyState: vi.fn(async () => ({ provider: "opencode" as const, status: "missing" as const })),
    setProviderApiKey: vi.fn(async () => undefined),
    clearProviderApiKey: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    ...overrides,
  };
}

// Queried through `screen`, not the render container: the dialog is a portal, so its content is a
// child of the document body rather than of the element `render` returns.
function renderDialog(api: ProviderKeyApi, onReconnect?: () => void | Promise<void>) {
  const onClose = vi.fn();
  render(() => <OpenCodeKeyDialog api={api} onClose={onClose} onReconnect={onReconnect} />);
  return { onClose };
}

describe("OpenCodeKeyDialog", () => {
  it("saves the pasted key once, without the whitespace a paste carries", async () => {
    const api = createApi();
    const { onClose } = renderDialog(api);

    // The input is disabled until the dialog has read whether a key is stored already, so the wait
    // is for that state and not for a moment in time. Typing sooner is dropped by the browser.
    const input = screen.getByLabelText("OpenCode Go key");
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.input(input, { target: { value: "  go-key-value  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() => expect(api.setProviderApiKey).toHaveBeenCalledTimes(1));
    expect(api.setProviderApiKey).toHaveBeenCalledWith({ provider: "opencode", key: "go-key-value" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("reports a saved key without reading it back into the input", async () => {
    const api = createApi({
      getProviderApiKeyState: vi.fn(async () => ({ provider: "opencode" as const, status: "saved" as const })),
    });
    renderDialog(api);

    await screen.findByText("Key saved. Paste a new one to replace it.");
    expect(screen.getByLabelText("OpenCode Go key")).toHaveValue("");
  });

  it("states that a saved key could not be read, and offers to remove it", async () => {
    const api = createApi({
      getProviderApiKeyState: vi.fn(async () => ({ provider: "opencode" as const, status: "unreadable" as const })),
    });
    const { onClose } = renderDialog(api);

    // Without this the user sees the free list with no reason, while a key they paid for is still
    // on disk and still the file the next save replaces.
    await screen.findByText("Saved key is unreadable. Paste it again, or remove it.");
    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));

    await waitFor(() => expect(api.clearProviderApiKey).toHaveBeenCalledWith("opencode"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("removes the saved key on request", async () => {
    const api = createApi({
      getProviderApiKeyState: vi.fn(async () => ({ provider: "opencode" as const, status: "saved" as const })),
    });
    const { onClose } = renderDialog(api);

    fireEvent.click(await screen.findByRole("button", { name: "Remove key" }));

    await waitFor(() => expect(api.clearProviderApiKey).toHaveBeenCalledWith("opencode"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps the dialog open and states why a save failed", async () => {
    const api = createApi({
      setProviderApiKey: vi.fn(async () => {
        throw new Error("OpenCode rejected the key.");
      }),
    });
    const { onClose } = renderDialog(api);

    const input = screen.getByLabelText("OpenCode Go key");
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.input(input, { target: { value: "not-a-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() => expect(api.setProviderApiKey).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toHaveTextContent("OpenCode rejected the key.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers no reconnect action without a reconnect handler", async () => {
    renderDialog(createApi());

    await screen.findByLabelText("OpenCode Go key");
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  });

  it("reconnects without touching credentials and leaves the dialog open", async () => {
    const api = createApi();
    const onReconnect = vi.fn(async () => undefined);
    const { onClose } = renderDialog(api, onReconnect);

    // The input is disabled until the dialog has read whether a key is stored already.
    const input = await screen.findByLabelText("OpenCode Go key");
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(onReconnect).toHaveBeenCalledTimes(1));
    // A reconnect answers the failure; the dialog stays for the key.
    expect(onClose).not.toHaveBeenCalled();
    expect(api.setProviderApiKey).not.toHaveBeenCalled();
    expect(api.clearProviderApiKey).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and states why a reconnect failed", async () => {
    const onReconnect = vi.fn(async () => {
      throw new Error("OpenCode did not answer.");
    });
    renderDialog(createApi(), onReconnect);

    const input = await screen.findByLabelText("OpenCode Go key");
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("OpenCode did not answer.");
  });
});
