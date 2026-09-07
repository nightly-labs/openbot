import type {
  AgentEvent,
  AgentProviderStatus,
  ProviderRuntimeSnapshot,
  ProviderRuntimeStatus,
  ProviderRuntimesDesktopApi,
} from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { FALLBACK_UPDATE_STATUS } from "../../app-defaults";
import { TOAST_DURATION, Toaster } from "../../components/ui";
import { DEFAULT_GENERAL_SETTINGS } from "../settings/app-settings";
import { SettingsModal } from "../settings/SettingsModal";
import { createProviderFailureNotifications } from "./provider-failure-notifications";
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

it("opens a notification from Settings and follows only current snapshots", async () => {
  const { store, emit } = runtimeHarness();
  await waitFor(() => expect(store.providerAvailableVersions().claude).toBe("2.1.250"));
  expect(screen.queryByText("Claude update available")).not.toBeInTheDocument();
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

it.each<AgentProviderStatus["state"]>(["error", "not-installed", "outdated"])(
  "keeps a dismissed %s provider failure closed until it changes or recovers",
  async (state) => {
    render(() => <Toaster />);
    const failures = createProviderFailureNotifications({
      serverId: "local",
      remoteName: () => undefined,
      openSettings: () => {},
    });
    const status: AgentProviderStatus = {
      id: "grok",
      state,
      version: null,
      message: "token=abcdefgh123456 /Users/ada failed",
    };
    const event: Extract<AgentEvent, { type: "error" }> = {
      type: "error",
      code: state === "not-installed" ? "grok_runtime_missing" : "grok_start_failed",
      message: "raw provider message",
    };
    try {
      failures.sync([status]);
      expect(await screen.findByText("token=[redacted] ~ failed")).toBeInTheDocument();
      failures.handleError(event, [status]);
      flush();
      expect(screen.getByText("token=[redacted] ~ failed")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Close notification" })).toHaveLength(1);
      const close = screen.getByRole("button", { name: "Close notification" });
      close.focus();
      expect(close).toHaveFocus();
      fireEvent.click(close);
      await waitFor(() => expect(screen.queryByText("Grok could not start")).not.toBeInTheDocument());
      failures.sync([status]);
      failures.handleError(event, [status]);
      flush();
      expect(screen.queryByText("Grok could not start")).not.toBeInTheDocument();
      failures.sync([{ ...status, message: "A different failure" }]);
      expect(await screen.findByText("A different failure")).toBeInTheDocument();
      failures.sync([{ ...status, state: "available", message: null }]);
      await waitFor(() => expect(screen.queryByText("Grok could not start")).not.toBeInTheDocument());
      failures.handleError(event, []);
      expect(await screen.findByText(event.message)).toBeInTheDocument();
    } finally {
      failures.dispose();
    }
  },
);

it("labels a remote provider failure and removes it when the server scope ends", async () => {
  render(() => <Toaster />);
  const failures = createProviderFailureNotifications({
    serverId: "remote",
    remoteName: () => "Studio Mac",
    openSettings: () => {
      throw new Error("Remote providers cannot open local settings");
    },
  });
  const event: Extract<AgentEvent, { type: "error" }> = {
    type: "error",
    code: "grok_runtime_missing",
    message: "Grok is missing",
  };
  failures.handleError({ ...event, agentId: "chief" }, []);
  flush();
  expect(screen.queryByText("Grok is missing")).not.toBeInTheDocument();
  failures.handleError(event, []);
  expect(await screen.findByText("Grok could not start on Studio Mac")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();
  failures.dispose();
  await waitFor(() => expect(screen.queryByText("Grok could not start on Studio Mac")).not.toBeInTheDocument());
});

it("offers Settings only when the workspace is available", async () => {
  render(() => <Toaster />);
  let available = false;
  const failures = createProviderFailureNotifications({
    serverId: "local",
    remoteName: () => undefined,
    settingsAvailable: () => available,
    openSettings: (event) => event.preventDefault(),
  });
  const status: AgentProviderStatus = { id: "codex", state: "error", version: null, message: "Provider unavailable" };
  try {
    failures.sync([status]);
    expect(await screen.findByText("ChatGPT could not start")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();
    available = true;
    failures.sync([status]);
    expect(await screen.findByRole("button", { name: "Open Settings" })).toBeEnabled();
    available = false;
    failures.sync([status]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument());
  } finally {
    failures.dispose();
  }
});
