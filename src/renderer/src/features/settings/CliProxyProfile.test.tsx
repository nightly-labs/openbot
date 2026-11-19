// @vitest-environment jsdom
import {
  CLIPROXY_DEFAULT_BASE_URL,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type SaveCliProxyProfileInput,
} from "@openbot/contracts/ipc";
import type { ProviderPickerOption } from "@openbot/ui/components/ProviderPicker";
import type { ProviderAccountActions } from "@openbot/ui/components/provider-accounts";
import { ProviderSettingsPage } from "@openbot/ui/features/settings/ProviderSettingsPage";
import { TextProvider } from "@openbot/ui/text";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

function expectInput(element: HTMLElement): HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) throw new Error("Expected HTMLInputElement");
  return element;
}

function expectButton(element: HTMLElement): HTMLButtonElement {
  if (!(element instanceof HTMLButtonElement)) throw new Error("Expected HTMLButtonElement");
  return element;
}

function makeOption(
  id: ProviderPickerOption["id"],
  name: string,
  extraAccounts: ProviderPickerOption["accounts"] = [],
): ProviderPickerOption {
  return {
    id,
    name,
    state: "available",
    email: "native@example.com",
    accounts: [
      {
        id: DEFAULT_PROVIDER_ACCOUNT_ID,
        label: null,
        email: "native@example.com",
        state: "connected",
        message: null,
      },
      ...(extraAccounts ?? []),
    ],
  };
}

function makeAccountActions(
  saveCliProxyProfile: (input: SaveCliProxyProfileInput) => Promise<void>,
): ProviderAccountActions {
  return {
    connect: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    saveCliProxyProfile,
    local: true,
  };
}

describe("ProviderSettingsPage CLIProxy profile creation", () => {
  it("shows Add CLIProxy on Claude, pre-fills defaults, validates URL, and submits", async () => {
    const saved: SaveCliProxyProfileInput[] = [];
    const actions = makeAccountActions(async (input) => {
      saved.push(input);
    });

    const view = render(() => (
      <TextProvider locale="en">
        <ProviderSettingsPage options={[makeOption("claude", "Claude")]} accountActions={actions} />
      </TextProvider>
    ));

    // Open Claude detail page from the Providers list.
    fireEvent.click(view.getByRole("button", { name: /Claude/ }));

    const addBtn = await view.findByRole("button", { name: "Add a Claude CLIProxy profile" });
    fireEvent.click(addBtn);

    // Pre-filled defaults: "Claude (CLIProxy)" and "http://127.0.0.1:8317"
    const nameInput = expectInput(await screen.findByLabelText("Profile name"));
    const urlInput = expectInput(screen.getByLabelText("CLIProxy URL"));
    const keyInput = expectInput(screen.getByLabelText("API key (optional)"));

    expect(nameInput.value).toBe("Claude (CLIProxy)");
    expect(urlInput.value).toBe(CLIPROXY_DEFAULT_BASE_URL);

    // Invalid URL disables submit and shows validation alert
    fireEvent.input(urlInput, { target: { value: "not-a-url" } });
    const submitBtn = expectButton(screen.getByRole("button", { name: "Create profile" }));
    expect(submitBtn.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Enter a valid http:// or https:// URL.");

    // Valid URL + optional API key submits cleanly
    fireEvent.input(urlInput, { target: { value: "http://127.0.0.1:8317/" } });
    fireEvent.input(keyInput, { target: { value: "sk-cliproxy-test" } });
    expect(submitBtn.disabled).toBe(false);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(saved).toEqual([
        {
          provider: "claude",
          accountId: null,
          label: "Claude (CLIProxy)",
          baseUrl: "http://127.0.0.1:8317",
          apiKey: "sk-cliproxy-test",
        },
      ]);
    });
  });

  it("renders CLIProxy badge and base URL for existing CLIProxy profiles and hides Add CLIProxy on non-CLIProxy providers", async () => {
    const actions = makeAccountActions(async () => undefined);
    const view = render(() => (
      <TextProvider locale="en">
        <ProviderSettingsPage
          options={[
            makeOption("codex", "ChatGPT", [
              {
                id: "a0000000000000009",
                label: "Codex (CLIProxy)",
                email: null,
                state: "connected",
                message: null,
                proxy: { kind: "cliproxy", baseUrl: "http://127.0.0.1:8317" },
              },
            ]),
            makeOption("cursor", "Cursor"),
          ]}
          accountActions={actions}
        />
      </TextProvider>
    ));

    fireEvent.click(view.getByRole("button", { name: /ChatGPT/ }));

    expect(await view.findByText("Codex (CLIProxy)")).toBeTruthy();
    expect(view.getByText("CLIProxy")).toBeTruthy();
    expect(view.getByText("http://127.0.0.1:8317")).toBeTruthy();

    cleanup();

    const cursorView = render(() => (
      <TextProvider locale="en">
        <ProviderSettingsPage options={[makeOption("cursor", "Cursor")]} accountActions={actions} />
      </TextProvider>
    ));
    fireEvent.click(cursorView.getByRole("button", { name: /Cursor/ }));
    await cursorView.findByRole("heading", { name: "Accounts" });
    expect(cursorView.queryByRole("button", { name: /CLIProxy/ })).toBeNull();
  });
});
