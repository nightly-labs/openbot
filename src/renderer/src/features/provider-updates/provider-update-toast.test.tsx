import type {
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

function runtimeHarness() {
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
    const runtimes = createProviderRuntimeStore(api);
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

/** A provider whose CLI the user installed: nothing managed on disk, and a newer version pinned. */
function systemCliHarness(startInstalled = true) {
  const status: ProviderRuntimeStatus = { phase: "not-downloaded", progress: null, message: null, version: null };
  let snapshot: ProviderRuntimeSnapshot = {
    revision: 1,
    providers: {
      codex: { ...status, availableVersion: "0.153.4" },
      claude: { ...status, availableVersion: null },
      grok: { ...status, availableVersion: null },
    },
  };
  let listener: ((snapshot: ProviderRuntimeSnapshot) => void) | undefined;
  const api: ProviderRuntimesDesktopApi = {
    getStatus: async () => snapshot,
    download: vi.fn(
      async (): Promise<ProviderRuntimeSnapshot> => ({
        ...snapshot,
        revision: snapshot.revision + 1,
        providers: { ...snapshot.providers, codex: { ...snapshot.providers.codex, phase: "downloading", progress: 0 } },
      }),
    ),
    cancel: async () => snapshot,
    onEvent: (callback) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
  const [installed, setInstalled] = createSignal<string | null>(startInstalled ? "0.146.0" : null);
  const [local, setLocal] = createSignal(true);
  let store: ReturnType<typeof createProviderRuntimeStore> | undefined;
  render(() => {
    store = createProviderRuntimeStore(api, {
      systemCliVersion: (provider) => (provider === "codex" ? installed() : null),
      isLocalServer: local,
    });
    return <Toaster />;
  });
  if (!store) throw new Error("The provider runtime store did not mount.");
  function emit(runtime: ProviderRuntimeStatus) {
    snapshot = { revision: snapshot.revision + 2, providers: { ...snapshot.providers, codex: runtime } };
    listener?.(snapshot);
    flush();
  }
  return { store, api, setInstalled, setLocal, emit };
}

it("downloads the pinned runtime when the running CLI belongs to the user", async () => {
  const { api, emit } = systemCliHarness();
  expect(await screen.findByText("ChatGPT update available")).toBeInTheDocument();
  expect(screen.getByText("v0.146.0 → v0.153.4")).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Update" }));
  await waitFor(() => expect(api.download).toHaveBeenCalledWith("codex"));
  emit({ phase: "downloading", progress: 25, message: null, version: null, availableVersion: "0.153.4" });
  expect(await screen.findByText("v0.146.0 → v0.153.4")).toBeInTheDocument();
  emit({ phase: "finishing", progress: null, message: null, version: "0.146.0", availableVersion: "0.153.4" });
  expect(screen.queryByText("ChatGPT is up to date")).not.toBeInTheDocument();
  emit({ phase: "ready", progress: 100, message: null, version: "0.153.4", availableVersion: null });
  expect(await screen.findByText("ChatGPT is up to date")).toBeInTheDocument();
  expect(screen.getByText("v0.153.4")).toBeInTheDocument();
});

it("reports a failed managed activation and retries its download", async () => {
  const { api, emit } = systemCliHarness();
  fireEvent.click(await screen.findByRole("button", { name: "Update" }));
  await waitFor(() => expect(api.download).toHaveBeenCalledOnce());
  emit({
    phase: "download-error",
    progress: null,
    message: "Candidate failed.",
    version: "0.146.0",
    availableVersion: "0.153.4",
  });
  expect(await screen.findByText("Candidate failed.")).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await waitFor(() => expect(api.download).toHaveBeenCalledTimes(2));
});

it("announces an offer that only becomes one once the agent status lands", async () => {
  const { setInstalled } = systemCliHarness(false);

  await waitFor(() => expect(screen.queryByRole("button", { name: "Close notification" })).not.toBeInTheDocument());

  setInstalled("0.146.0");
  flush();
  expect(await screen.findByText("ChatGPT update available")).toBeInTheDocument();
});

it("offers no CLI update while a workspace on another computer is open", async () => {
  const { store, api, setLocal } = systemCliHarness();
  setLocal(false);
  flush();

  // The runtimes this store reaches are on this computer, and the open workspace is not, so there is
  // nothing to offer and nothing an Update button here could put right. The offer itself is what the
  // notification would be raised from, so waiting for it is waiting for the moment it is not raised.
  await waitFor(() => expect(store.providerAvailableVersions().codex).toBe("0.153.4"));
  expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
  await expect(store.startProviderUpdate("codex")).rejects.toThrow(/computer that hosts them/u);
  expect(api.download).not.toHaveBeenCalled();

  setLocal(true);
  flush();
  expect(await screen.findByText("ChatGPT update available")).toBeInTheDocument();
});

it("keeps an offer the user closed closed when the workspace is opened again", async () => {
  systemCliHarness();
  fireEvent.click(await screen.findByRole("button", { name: "Close notification" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument());
  // A server switch disposes the store that raised the notification and builds a new one.
  cleanup();

  const { store } = systemCliHarness();
  await waitFor(() => expect(store.providerAvailableVersions().codex).toBe("0.153.4"));
  expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
});
