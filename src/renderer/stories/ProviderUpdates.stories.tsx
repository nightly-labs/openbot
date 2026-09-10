import { isManagedRuntimeProvider, type ManagedProviderId } from "@openbot/contracts/agent-providers";
import type { AgentProviderId, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { createEffect, createSignal, createUniqueId, onCleanup, Show } from "solid-js";
import { expect, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ProviderPicker, type ProviderPickerOption } from "../src/components/ProviderPicker";
import { Button, Checkbox, Heading, Text, Toaster } from "../src/components/ui";
import { type ProviderUpdate, providerUpdatesToAnnounce } from "../src/features/provider-updates/provider-update";
import {
  dismissProviderUpdateToast,
  reportProviderUpdateToast,
  showProviderUpdateToast,
} from "../src/features/provider-updates/provider-update-toast";

const PROVIDERS = ["codex", "claude", "grok", "opencode"] as const;
const NAMES: Record<ManagedProviderId, string> = {
  codex: "ChatGPT",
  claude: "Claude",
  grok: "Grok",
  opencode: "OpenCode",
};
const INSTALLED: Record<ManagedProviderId, string> = {
  codex: "0.149.1",
  claude: "2.1.246",
  grok: "1.0.5",
  opencode: "1.18.30",
};

/** Only Claude has a newer runtime: the quiet rows are half of what the flow has to show. */
const AVAILABLE: Record<ManagedProviderId, string | null> = {
  codex: "0.149.1",
  claude: "2.1.250",
  grok: null,
  opencode: null,
};

/** Fast enough that a play function settles in a couple of seconds, slow enough to read. */
const PROGRESS_STEP = 8;
const PROGRESS_INTERVAL = 120;
const FINISHING_DELAY = 500;

function readyRuntimes(): Record<ManagedProviderId, ProviderRuntimeStatus> {
  return {
    codex: { phase: "ready", progress: 100, message: null, version: INSTALLED.codex },
    claude: { phase: "ready", progress: 100, message: null, version: INSTALLED.claude },
    grok: { phase: "ready", progress: 100, message: null, version: INSTALLED.grok },
    opencode: { phase: "ready", progress: 100, message: null, version: INSTALLED.opencode },
  };
}

/**
 * The update flow with main simulated locally, the same way `OnboardingFlow.stories.tsx`
 * simulates a download: local signals, a `setInterval` progress tick and per-provider timer
 * cleanup. `mock-openbot.ts` still stubs `providerRuntimes` inert, and no contract carries
 * `availableVersion` yet, so props are the only honest source for these states today.
 */
function ProviderUpdateFlow(props: { failOnce?: boolean; controls?: boolean }) {
  const [runtimes, setRuntimes] = createSignal(readyRuntimes());
  const [provider, setProvider] = createSignal<AgentProviderId>("claude");
  // One update fails, and the flag is spent when it does, so the Retry after it succeeds. The
  // `UpdateFails` story starts it armed; the playground puts the same switch under the reader.
  const [failNext, setFailNext] = createSignal(Boolean(props.failOnce));
  const failToggleId = createUniqueId();
  const timers = new Set<number>();
  const running = new Set<AgentProviderId>();
  let announced: ProviderUpdate[] = [];

  const updates = (): ProviderUpdate[] =>
    PROVIDERS.map((id) => ({
      provider: id,
      name: NAMES[id],
      runtime: runtimes()[id],
      availableVersion: AVAILABLE[id],
    }));

  function setRuntime(id: AgentProviderId, patch: Partial<ProviderRuntimeStatus>): void {
    if (!isManagedRuntimeProvider(id)) return;
    setRuntimes((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  function clearTimers(): void {
    for (const timer of timers) {
      window.clearInterval(timer);
      window.clearTimeout(timer);
    }
    timers.clear();
  }

  function startUpdate(id: AgentProviderId): void {
    if (!isManagedRuntimeProvider(id)) return;
    clearTimers();
    const update = updates().find((update) => update.provider === id);
    if (update) showProviderUpdateToast(update, () => startUpdate(id));
    running.add(id);
    setRuntime(id, { phase: "downloading", progress: 0, message: null });
    let progress = 0;
    const interval = window.setInterval(() => {
      progress = Math.min(100, progress + PROGRESS_STEP);
      if (failNext() && progress >= 56) {
        setFailNext(false);
        clearTimers();
        setRuntime(id, { phase: "download-error", progress: 55, message: "The update was interrupted." });
        return;
      }
      setRuntime(id, { phase: "downloading", progress });
      if (progress < 100) return;
      clearTimers();
      setRuntime(id, { phase: "finishing", progress: 100 });
      timers.add(
        window.setTimeout(() => {
          setRuntime(id, { phase: "ready", progress: 100, version: AVAILABLE[id] ?? INSTALLED[id] });
        }, FINISHING_DELAY),
      );
    }, PROGRESS_INTERVAL);
    timers.add(interval);
  }

  /** The reverse state: the runtime the user already had is still installed and still usable. */
  function cancelUpdate(id: AgentProviderId): void {
    if (!isManagedRuntimeProvider(id)) return;
    clearTimers();
    running.delete(id);
    setRuntime(id, { phase: "ready", progress: 100, message: null, version: INSTALLED[id] });
    dismissProviderUpdateToast(id);
  }

  /**
   * Put every runtime back on the version it started from, so the offer can be watched more than
   * once without reloading the page. Clearing `announced` is what lets the toast fire again, and
   * the offer replaces whatever holds the same toast id, so nothing has to be dismissed by hand.
   */
  function replayFlow(): void {
    clearTimers();
    running.clear();
    announced = [];
    setRuntimes(readyRuntimes());
  }

  // The snapshot is the trigger, so the announcement is an effect on it. In the app the same two
  // calls sit in `applyProviderRuntimeSnapshot`, which main already drives.
  createEffect(
    () => updates(),
    (next) => {
      for (const update of providerUpdatesToAnnounce(announced, next)) {
        showProviderUpdateToast(update, () => startUpdate(update.provider));
      }
      for (const update of next) {
        if (!running.has(update.provider)) continue;
        reportProviderUpdateToast(update, () => startUpdate(update.provider));
        if (update.runtime.phase === "ready" || update.runtime.phase === "download-error") {
          running.delete(update.provider);
        }
      }
      announced = next;
    },
  );

  onCleanup(() => {
    clearTimers();
    for (const id of PROVIDERS) dismissProviderUpdateToast(id);
  });

  const options = (): ProviderPickerOption[] =>
    updates().map((update) => ({
      id: update.provider,
      name: update.name,
      state: "available",
      email: "person@example.com",
      runtimeStatus: update.runtime,
      availableVersion: update.availableVersion,
    }));

  return (
    <main class="foundation-story">
      <Heading as="h1" size="lg">
        Provider updates
      </Heading>
      <Text tone="secondary">The notification and the row offer the same update, and report the same progress.</Text>
      <Show when={props.controls}>
        <div class="foundation-story-row">
          <Button type="button" variant="outline" size="sm" onClick={replayFlow}>
            Offer the update again
          </Button>
          <label for={failToggleId} class="foundation-story-row">
            <Checkbox
              id={failToggleId}
              checked={failNext()}
              onChange={(event) => setFailNext(event.currentTarget.checked)}
            />
            <Text tone="secondary">Fail the next update</Text>
          </label>
        </div>
      </Show>
      <ProviderPicker
        value={provider()}
        options={options()}
        ariaLabel="Default provider"
        label="Default provider"
        onChange={setProvider}
        onUpdateProvider={startUpdate}
        onDownloadProvider={startUpdate}
        onCancelProviderDownload={cancelUpdate}
      />
      <Toaster />
    </main>
  );
}

const meta = {
  title: "Setup/ProviderUpdates",
  component: ProviderUpdateFlow,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ProviderUpdateFlow>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Drive it yourself. Nothing runs on its own here: the offer arrives on mount and the update starts
 * only when you press Update, on the notification or on the row. "Offer the update again" puts
 * Claude back on the version it started from, so the whole flow can be watched more than once, and
 * the switch beside it interrupts the next run to make the Retry path reachable.
 */
export const Playground: Story = {
  render: () => <ProviderUpdateFlow controls />,
};

/** The offer, on both surfaces at once. */
export const UpdateAvailable: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.findByRole("button", { name: "Update Claude to 2.1.250" })).resolves.toBeEnabled();
    await expect(body.findByRole("button", { name: "Update" })).resolves.toBeEnabled();
  },
};

/** The toast is the whole point: one click starts the update, and the same toast reports it. */
export const UpdateFromToast: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole("button", { name: "Update" }));

    await waitFor(() => expect(body.getByRole("button", { name: "Cancel Claude" })).toBeEnabled());
    await expect(body.findByText("Claude is up to date", undefined, { timeout: 8_000 })).resolves.toBeInTheDocument();
    // Neither surface still offers an update the user already took. Sonner merges by toast id, so
    // the settled notification keeps the offer's Update button unless the action is cleared by name.
    await expect(body.queryByRole("button", { name: "Update Claude to 2.1.250" })).toBeNull();
    await expect(body.queryByRole("button", { name: "Update" })).toBeNull();
  },
};

/** A failed update is not a dead end either: Retry is on the notification that reported the failure. */
export const UpdateFails: Story = {
  render: () => <ProviderUpdateFlow failOnce />,
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole("button", { name: "Update Claude to 2.1.250" }));

    await expect(body.findByText("Claude update failed", undefined, { timeout: 8_000 })).resolves.toBeInTheDocument();
    await userEvent.click(await body.findByRole("button", { name: "Retry" }));
    await expect(body.findByText("Claude is up to date", undefined, { timeout: 8_000 })).resolves.toBeInTheDocument();
  },
};
