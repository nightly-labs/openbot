import type {
  ProviderRuntimeSnapshot,
  ProviderRuntimeStatus,
  ProviderRuntimesDesktopApi,
} from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { FALLBACK_UPDATE_STATUS } from "../../app-defaults";
import { Toaster } from "../../components/ui";
import { DEFAULT_GENERAL_SETTINGS } from "../settings/app-settings";
import { SettingsModal } from "../settings/SettingsModal";
import { createProviderRuntimeStore } from "./provider-runtime-store";
import type { ProviderUpdate } from "./provider-update";
import { dismissProviderUpdateToast } from "./provider-update-toast";

const offer: ProviderUpdate = {
  provider: "claude",
  name: "Claude",
  runtime: { phase: "ready", progress: null, message: null, version: "2.1.246" },
  availableVersion: "2.1.250",
};

afterEach(() => {
  dismissProviderUpdateToast("claude");
  dismissProviderUpdateToast("codex");
  vi.useRealTimers();
});

function runtimeHarness() {
  let snapshot: ProviderRuntimeSnapshot = {
    revision: 1,
    providers: {
      codex: { ...offer.runtime, availableVersion: null },
      claude: { ...offer.runtime, phase: "not-downloaded", availableVersion: offer.availableVersion },
      grok: { ...offer.runtime, availableVersion: null },
      opencode: { ...offer.runtime, availableVersion: null },
    },
    toolRuntimes: { bun: { ...offer.runtime } },
  };
  let listener: ((snapshot: ProviderRuntimeSnapshot) => void) | undefined;
  function emit(patch: Partial<ProviderRuntimeStatus>) {
    snapshot = {
      ...snapshot,
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
