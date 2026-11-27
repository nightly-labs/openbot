import { isManagedRuntimeProvider, type ManagedProviderId } from "@openbot/contracts/agent-providers";
import type { AgentProviderId, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Button, Checkbox, Heading, Text, Toaster, toast } from "@openbot/ui";
import type { ProviderPickerOption } from "@openbot/ui/components/ProviderPicker";
import { ProviderPicker } from "@openbot/ui/components/ProviderPicker";
import { type ProviderUpdate, providerUpdatesToAnnounce } from "@openbot/ui/features/provider-updates/provider-update";
import { createEffect, createSignal, createUniqueId, onCleanup, onSettled, Show, untrack } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  dismissProviderUpdateToast,
  reportProviderUpdateToast,
  showProviderUpdateToast,
} from "../src/features/provider-updates/provider-update-toast";

const PROVIDERS = [
  "codex",
  "claude",
  "grok",
  "opencode",
  "antigravity",
  "cursor",
  "cline",
  "kimi",
  "pi",
  "muse",
  "devin",
  "copilot",
  "mistral",
] as const;
const NAMES: Record<ManagedProviderId, string> = {
  codex: "ChatGPT",
  claude: "Claude",
  grok: "Grok",
  opencode: "OpenCode",
  antigravity: "Gemini",
  cursor: "Cursor",
  cline: "Cline",
  kimi: "Kimi",
  pi: "Pi",
  muse: "Muse",
  devin: "Devin",
  copilot: "GitHub Copilot",
  mistral: "Mistral",
};
const INSTALLED: Record<ManagedProviderId, string> = {
  codex: "0.149.1",
  claude: "2.1.246",
  grok: "1.0.5",
  opencode: "1.18.30",
  antigravity: "1.2.1",
  cursor: "2026.09.28-64d2043",
  cline: "3.0.68",
  kimi: "1.52.0",
  pi: "1.1.0",
  muse: "1.4.4-R5419.1",
  devin: "3000.11.234",
  copilot: "1.0.105",
  mistral: "3.1.0",
};

const AVAILABLE: Record<ManagedProviderId, string | null> = {
  codex: "0.149.1",
  claude: "2.1.250",
  grok: null,
  opencode: null,
  antigravity: null,
  cursor: null,
  cline: null,
  kimi: null,
  pi: null,
  muse: null,
  devin: null,
  copilot: null,
  mistral: null,
};

const PROGRESS_STEP = 8;
const PROGRESS_INTERVAL = 120;
const FINISHING_DELAY = 500;

function readyRuntimes(): Record<ManagedProviderId, ProviderRuntimeStatus> {
  return {
    codex: { phase: "ready", progress: 100, message: null, version: INSTALLED.codex },
    claude: { phase: "ready", progress: 100, message: null, version: INSTALLED.claude },
    grok: { phase: "ready", progress: 100, message: null, version: INSTALLED.grok },
    opencode: { phase: "ready", progress: 100, message: null, version: INSTALLED.opencode },
    antigravity: { phase: "ready", progress: 100, message: null, version: INSTALLED.antigravity },
    cursor: { phase: "ready", progress: 100, message: null, version: INSTALLED.cursor },
    cline: { phase: "ready", progress: 100, message: null, version: INSTALLED.cline },
    kimi: { phase: "ready", progress: 100, message: null, version: INSTALLED.kimi },
    pi: { phase: "ready", progress: 100, message: null, version: INSTALLED.pi },
    muse: { phase: "ready", progress: 100, message: null, version: INSTALLED.muse },
    devin: { phase: "ready", progress: 100, message: null, version: INSTALLED.devin },
    copilot: { phase: "ready", progress: 100, message: null, version: INSTALLED.copilot },
    mistral: { phase: "ready", progress: 100, message: null, version: INSTALLED.mistral },
  };
}

function ProviderUpdateFlow(props: { controls?: boolean; failure?: string; companions?: boolean; waitMs?: number }) {
  const [runtimes, setRuntimes] = createSignal(readyRuntimes());
  const [provider, setProvider] = createSignal<AgentProviderId>("claude");
  const [failNext, setFailNext] = createSignal(untrack(() => props.failure !== undefined));
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
    runDownload(id, props.waitMs);
  }

  function runDownload(id: ManagedProviderId, waitMs?: number): void {
    setRuntime(id, { phase: "downloading", progress: 0, message: null });
    let progress = 0;
    const interval = window.setInterval(() => {
      progress = Math.min(100, progress + PROGRESS_STEP);
      if (failNext() && progress >= 56) {
        setFailNext(false);
        clearTimers();
        setRuntime(id, {
          phase: "download-error",
          progress: 55,
          message: props.failure ?? "The update was interrupted.",
        });
        return;
      }
      setRuntime(id, { phase: "downloading", progress });
      if (progress < 100) return;
      clearTimers();
      const finish = () => {
        setRuntime(id, { phase: "finishing", progress: 100, message: null });
        timers.add(
          window.setTimeout(() => {
            setRuntime(id, { phase: "ready", progress: 100, version: AVAILABLE[id] ?? INSTALLED[id] });
          }, FINISHING_DELAY),
        );
      };
      if (waitMs === undefined) {
        finish();
        return;
      }
      setRuntime(id, { phase: "downloading", progress: 100, message: sourceText("status.provider.updateWaiting") });
      timers.add(window.setTimeout(finish, waitMs));
    }, PROGRESS_INTERVAL);
    timers.add(interval);
  }

  function cancelUpdate(id: AgentProviderId): void {
    if (!isManagedRuntimeProvider(id)) return;
    clearTimers();
    running.delete(id);
    setRuntime(id, { phase: "ready", progress: 100, message: null, version: INSTALLED[id] });
    dismissProviderUpdateToast(id);
  }

  function replayFlow(): void {
    clearTimers();
    running.clear();
    announced = [];
    setRuntimes(readyRuntimes());
  }

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

  onSettled(() => {
    if (!props.companions) return;
    toast.info("New model available", {
      id: "provider-update-companion-model",
      description: "Open model settings to review its capabilities before you switch.",
      duration: Number.POSITIVE_INFINITY,
    });
    toast.success("Workspace saved", {
      id: "provider-update-companion-saved",
      duration: Number.POSITIVE_INFINITY,
    });
  });

  onCleanup(() => {
    clearTimers();
    for (const id of PROVIDERS) dismissProviderUpdateToast(id);
    toast.dismiss("provider-update-companion-model");
    toast.dismiss("provider-update-companion-saved");
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
  parameters: {
    layout: "fullscreen",
    viewport: {
      options: {
        toastNarrow: {
          name: "Toast — 420 × 760",
          styles: { width: "420px", height: "760px" },
        },
      },
    },
  },
} satisfies Meta<typeof ProviderUpdateFlow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => <ProviderUpdateFlow controls />,
};

export const UpdateAvailable: Story = {};

export const WaitsForTurn: Story = {
  render: () => <ProviderUpdateFlow controls waitMs={3_000} />,
};

const LONG_FAILURE =
  "OpenBot could not update the Claude CLI. The registry at https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-2.1.250.tgz answered with a checksum that does not match the published package, so the download stopped before it replaced the version you have.";

export const LongFailure: Story = {
  render: () => <ProviderUpdateFlow controls failure={LONG_FAILURE} />,
};

export const LongFailureStacked: Story = {
  render: () => <ProviderUpdateFlow controls companions failure={LONG_FAILURE} />,
};

export const LongFailureNarrow: Story = {
  globals: { viewport: "toastNarrow" },
  render: () => <ProviderUpdateFlow controls companions failure={LONG_FAILURE} />,
};
