import type {
  AgentProviderId,
  ProviderRuntimeSnapshot,
  ProviderRuntimeStatus,
  ProviderRuntimesDesktopApi,
} from "@openbot/contracts/ipc";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { FALLBACK_UPDATE_STATUS } from "../../app-defaults";
import { TOAST_DURATION, Toaster } from "../../components/ui";
import { DEFAULT_GENERAL_SETTINGS } from "../settings/app-settings";
import { SettingsModal } from "../settings/SettingsModal";
import { createProviderRuntimeStore } from "./provider-runtime-store";
import type { ProviderUpdate } from "./provider-update";
import {
  dismissProviderUpdateToast,
  reportProviderUpdateToast,
  showProviderUpdateToast,
} from "./provider-update-toast";

const offer: ProviderUpdate = {
  provider: "claude",
  name: "Claude",
  runtime: { phase: "ready", progress: null, message: null, version: "2.1.246" },
  availableVersion: "2.1.250",
};
const running: ProviderUpdate = { ...offer, runtime: { ...offer.runtime, phase: "downloading", progress: 42 } };
const completed: ProviderUpdate = { ...offer, runtime: { ...offer.runtime, version: offer.availableVersion } };
const update = () => {};

afterEach(() => {
  dismissProviderUpdateToast("claude");
  dismissProviderUpdateToast("codex");
  vi.useRealTimers();
});

it("keeps a closed update hidden through progress and completion until another explicit offer", async () => {
  render(() => <Toaster />);
  showProviderUpdateToast(offer, update);
  reportProviderUpdateToast(running, update);
  fireEvent.click(await screen.findByRole("button", { name: "Close notification" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Close notification" })).not.toBeInTheDocument());

  reportProviderUpdateToast(running, update);
  reportProviderUpdateToast(completed, update);
  flush();
  expect(screen.queryByText("Claude is up to date")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Close notification" })).not.toBeInTheDocument();

  showProviderUpdateToast(offer, update);
  expect(await screen.findByRole("button", { name: "Update" })).toBeEnabled();
});

it("keeps a new offer open after the previous success deadline", async () => {
  vi.useFakeTimers();
  render(() => <Toaster />);
  showProviderUpdateToast(offer, update);
  reportProviderUpdateToast(completed, update);
  flush();
  expect(screen.getByText("Claude is up to date")).toBeInTheDocument();

  showProviderUpdateToast(offer, update);
  flush();
  await vi.advanceTimersByTimeAsync(TOAST_DURATION * 2);
  flush();
  expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();
});

function runtimeHarness(local?: () => boolean) {
  let snapshot: ProviderRuntimeSnapshot = {
    revision: 1,
    providers: {
      codex: { ...offer.runtime, availableVersion: null },
      claude: { ...offer.runtime, phase: "not-downloaded", availableVersion: offer.availableVersion },
      grok: { ...offer.runtime, availableVersion: null },
    },
  };
  let listener: ((snapshot: ProviderRuntimeSnapshot) => void) | undefined;
  function emit(patch: Partial<ProviderRuntimeStatus>) {
    snapshot = {
      revision: snapshot.revision + 1,
      providers: { ...snapshot.providers, claude: { ...snapshot.providers.claude, ...patch } },
    };
    listener?.(snapshot);
    return snapshot;
  }
  const api: ProviderRuntimesDesktopApi = {
    getStatus: async () => snapshot,
    download: vi.fn(async () => emit({ phase: "downloading", progress: 0, message: null })),
    cancel: async () => emit({ phase: "not-downloaded", progress: null }),
    onEvent: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };
  const onOpenChange = vi.fn();
  let store: ReturnType<typeof createProviderRuntimeStore> | undefined;
  render(() => {
    const runtimes = createProviderRuntimeStore(api, { isLocalServer: local });
    store = runtimes;
    return (
      <>
        <SettingsModal
          open
          onOpenChange={onOpenChange}
          value={DEFAULT_GENERAL_SETTINGS}
          onValueChange={() => {}}
          appInfo={null}
          updateStatus={FALLBACK_UPDATE_STATUS}
          onUpdateAction={async () => {}}
          account={{ id: "test", name: "Test", email: "test@example.com", avatarUrl: null }}
          onUpdateAccountName={async () => {}}
          onUpdateAccountAvatar={async () => {}}
          providerRuntimeStatuses={runtimes.providerRuntimeStatuses()}
          providerAvailableVersions={runtimes.providerAvailableVersions()}
          onUpdateProvider={runtimes.downloadProviderRuntime}
          onDownloadProvider={runtimes.downloadProviderRuntime}
          onCancelProviderDownload={runtimes.cancelProviderRuntimeDownload}
        />
        <Toaster />
      </>
    );
  });
  if (!store) throw new Error("The provider runtime store did not mount.");
  return { store, api, emit, onOpenChange };
}

it("announces an offer and follows only current snapshots", async () => {
  const { store, emit } = runtimeHarness();
  await waitFor(() => expect(store.providerAvailableVersions().claude).toBe("2.1.250"));
  expect(await screen.findByText("Claude update available")).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Update Claude to 2.1.250" }));
  expect(await screen.findByText("Updating Claude")).toBeInTheDocument();
  const stale = emit({ phase: "downloading", progress: 42 });
  emit({ phase: "ready", version: "2.1.250", availableVersion: null });
  store.applyProviderRuntimeSnapshot(stale);
  expect(await screen.findByText("Claude is up to date")).toBeInTheDocument();
  expect(store.providerAvailableVersions().claude).toBeNull();
});

it("retries an update from the failure notification", async () => {
  const { store, api, emit } = runtimeHarness();
  await waitFor(() => expect(store.providerAvailableVersions().claude).toBe("2.1.250"));
  await store.downloadProviderRuntime("claude");
  emit({ phase: "download-error", message: "Connection lost." });
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Updating Claude")).toBeInTheDocument();
  expect(api.download).toHaveBeenCalledTimes(2);
  emit({ phase: "ready", version: "2.1.250", availableVersion: null });
  expect(await screen.findByText("Claude is up to date")).toBeInTheDocument();
});

it("offers retry when the update request fails before progress starts", async () => {
  const { store, api } = runtimeHarness();
  await waitFor(() => expect(store.providerAvailableVersions().claude).toBe("2.1.250"));
  vi.mocked(api.download).mockRejectedValueOnce(new Error("IPC request failed"));
  await store.downloadProviderRuntime("claude");
  expect(await screen.findByRole("button", { name: "Retry" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Updating Claude")).toBeInTheDocument();
  await store.cancelProviderRuntimeDownload("claude");
  await waitFor(() => expect(screen.queryByText("Updating Claude")).not.toBeInTheDocument());
  expect(store.providerAvailableVersions().claude).toBe("2.1.250");
});

it("keeps Settings open when the update notification is closed", async () => {
  const { store, onOpenChange } = runtimeHarness();
  await waitFor(() => expect(store.providerAvailableVersions().claude).toBe("2.1.250"));
  fireEvent.click(await screen.findByRole("button", { name: "Update Claude to 2.1.250" }));
  const close = await screen.findByRole("button", { name: "Close notification" });
  await waitFor(() => {
    fireEvent.pointerDown(document.body, { pointerType: "mouse", button: 0 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  onOpenChange.mockClear();
  fireEvent.pointerDown(close, { pointerType: "mouse", button: 0 });
  fireEvent.click(close);
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Close settings" })).toBeInTheDocument();
});

/**
 * A provider whose CLI the user installed: nothing managed on disk, and a newer version pinned for
 * the managed copy the provider does not run.
 */
function systemCliHarness(
  updateSystemCli: (provider: AgentProviderId) => Promise<void>,
  installedAfterUpdate = "0.153.4",
) {
  const status: ProviderRuntimeStatus = { phase: "not-downloaded", progress: null, message: null, version: null };
  const snapshot: ProviderRuntimeSnapshot = {
    revision: 1,
    providers: {
      codex: { ...status, availableVersion: "0.153.4" },
      claude: { ...status, availableVersion: null },
      grok: { ...status, availableVersion: null },
    },
  };
  const api: ProviderRuntimesDesktopApi = {
    getStatus: async () => snapshot,
    download: vi.fn(async () => snapshot),
    cancel: async () => snapshot,
    onEvent: () => () => {},
  };
  // A signal, because this is what the agent status is: it lands on its own, after the snapshot as
  // often as before it.
  const [installed, setInstalled] = createSignal<string | null>("0.146.0");
  // The workspace on screen, which decides whether the CLIs this store reaches are the ones the user
  // is looking at. Every one of them is on this computer.
  const [local, setLocal] = createSignal(true);
  let store: ReturnType<typeof createProviderRuntimeStore> | undefined;
  render(() => {
    store = createProviderRuntimeStore(api, {
      systemCliVersion: (provider) => (provider === "codex" ? installed() : null),
      updateSystemCli: async (provider) => {
        await updateSystemCli(provider);
        setInstalled(installedAfterUpdate);
      },
      isLocalServer: local,
    });
    return <Toaster />;
  });
  if (!store) throw new Error("The provider runtime store did not mount.");
  return { store, api, setInstalled, setLocal };
}

it("offers no update for a CLI the user installed", async () => {
  const updateSystemCli = vi.fn(async () => {});
  const { store } = systemCliHarness(updateSystemCli);

  // Main pins a newer version for the managed copy, and the provider runs the user's install
  // instead. That install answers to its own updater, so OpenBot names no version for it and has
  // nothing to announce.
  await waitFor(() => expect(store.providerRuntimeStatuses().codex.availableVersion).toBe("0.153.4"));
  expect(store.providerAvailableVersions().codex).toBeNull();
  expect(screen.queryByRole("button", { name: "Close notification" })).not.toBeInTheDocument();
  expect(updateSystemCli).not.toHaveBeenCalled();
});

it("updates a CLI the user installed when asked, and reports the version it came back on", async () => {
  let finishUpdate: (() => void) | undefined;
  const updateSystemCli = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishUpdate = resolve;
      }),
  );
  const { store, api } = systemCliHarness(updateSystemCli);

  const finished = store.startProviderUpdate("codex");

  expect(await screen.findByText("Updating ChatGPT")).toBeInTheDocument();
  finishUpdate?.();
  await finished;
  expect(updateSystemCli).toHaveBeenCalledWith("codex");
  expect(await screen.findByText("ChatGPT is up to date")).toBeInTheDocument();
  expect(screen.getByText("v0.153.4")).toBeInTheDocument();
  expect(api.download).not.toHaveBeenCalled();
});

it("reports the version an updater left where it was, and offers it no update after that", async () => {
  const updateSystemCli = vi.fn(async () => {});
  // The CLI reports the version it started on: its own channel had nothing newer for it.
  const { store } = systemCliHarness(updateSystemCli, "0.146.0");

  await store.startProviderUpdate("codex");

  expect(await screen.findByText("ChatGPT is up to date")).toBeInTheDocument();
  expect(screen.getByText("v0.146.0")).toBeInTheDocument();
  expect(store.providerAvailableVersions().codex).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});

it("keeps the CLI's own reason on the notification and retries from it", async () => {
  const updateSystemCli = vi
    .fn<(provider: AgentProviderId) => Promise<void>>()
    .mockRejectedValueOnce(new Error("OpenBot could not update the ChatGPT CLI. Installed by Homebrew."))
    .mockResolvedValue(undefined);
  const { store } = systemCliHarness(updateSystemCli);

  await store.startProviderUpdate("codex");
  expect(
    await screen.findByText("OpenBot could not update the ChatGPT CLI. Installed by Homebrew."),
  ).toBeInTheDocument();

  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  expect(await screen.findByText("ChatGPT is up to date")).toBeInTheDocument();
  expect(updateSystemCli).toHaveBeenCalledTimes(2);
});

it("reports an update that was refused before either updater could report it", async () => {
  const updateSystemCli = vi.fn(async () => {});
  const { store, setLocal } = systemCliHarness(updateSystemCli);
  setLocal(false);
  flush();

  // The runtimes this store reaches are on this computer, and the open workspace is not. The user
  // pressed a button, so the refusal belongs on the notification: it used to be thrown away.
  await expect(store.startProviderUpdate("codex")).rejects.toThrow(/computer that hosts them/u);

  expect(await screen.findByText("ChatGPT update failed")).toBeInTheDocument();
  expect(screen.getByText("Provider CLI updates run on the computer that hosts them.")).toBeInTheDocument();
  expect(updateSystemCli).not.toHaveBeenCalled();

  setLocal(true);
  flush();
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await waitFor(() => expect(updateSystemCli).toHaveBeenCalledWith("codex"));
  expect(await screen.findByText("ChatGPT is up to date")).toBeInTheDocument();
});

it("announces no offer while a workspace on another computer is open", async () => {
  const [local, setLocal] = createSignal(false);
  const { store } = runtimeHarness(local);

  // Every runtime this store reaches is on this computer, and the workspace on screen is not, so an
  // Update button raised here would change a runtime the user is not looking at.
  await waitFor(() => expect(store.providerAvailableVersions().claude).toBe("2.1.250"));
  expect(screen.queryByText("Claude update available")).not.toBeInTheDocument();

  setLocal(true);
  flush();
  expect(await screen.findByText("Claude update available")).toBeInTheDocument();
});

it("keeps an offer the user closed closed when the workspace is opened again", async () => {
  const first = runtimeHarness();
  await waitFor(() => expect(first.store.providerAvailableVersions().claude).toBe("2.1.250"));
  fireEvent.click(await screen.findByRole("button", { name: "Close notification" }));
  await waitFor(() => expect(screen.queryByText("Claude update available")).not.toBeInTheDocument());
  // A server switch disposes the store that raised the notification and builds a new one.
  cleanup();

  const { store } = runtimeHarness();
  await waitFor(() => expect(store.providerAvailableVersions().claude).toBe("2.1.250"));
  expect(screen.queryByText("Claude update available")).not.toBeInTheDocument();
});
