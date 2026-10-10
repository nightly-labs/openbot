import { Mic, Tabs } from "@openbot/ui";
import { SettingsDialogShell } from "@openbot/ui/features/settings/SettingsDialogShell";
import {
  type OlderVoiceModel,
  SettingsVoiceTab,
  type VoiceModelInfo,
  type VoiceModelState,
} from "@openbot/ui/features/settings/SettingsVoiceTab";
import { currentText } from "@openbot/ui/text";
import { createSignal, onCleanup } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { navItems } from "../src/features/settings/settings-tabs";

const PARAKEET: VoiceModelInfo = {
  name: "Parakeet TDT 0.6B v3",
  publisher: "NVIDIA",
  languageCount: 25,
  sizeBytes: 670_478_772,
};
const LOADED_MEMORY_BYTES = 1_483 * 1024 ** 2;
const LOCATION = "~/Library/Application Support/OpenBot/runtimes/voice/parakeet-tdt-0.6b-v3-int8";
const WHISPER: OlderVoiceModel = { id: "whisper", name: "Whisper base", sizeBytes: 147_964_211 };
const DOWNLOAD_STEP_BYTES = 24 * 1024 ** 2;

/**
 * The Voice tab inside the real settings dialog. The other tabs are in the list for placement only.
 * The buttons work: Download fills the bar, Remove asks first, Unload frees the memory.
 */
function VoiceSettingsStory(props: { state: VoiceModelState; olderModels?: OlderVoiceModel[] }) {
  const { t } = currentText();
  const [state, setState] = createSignal<VoiceModelState>(props.state);
  const [olderModels, setOlderModels] = createSignal(props.olderModels ?? []);
  let timer: number | undefined;
  onCleanup(() => window.clearInterval(timer));

  function download(): void {
    window.clearInterval(timer);
    setState({ phase: "downloading", receivedBytes: 0 });
    timer = window.setInterval(() => {
      const current = state();
      if (current.phase !== "downloading") return;
      const receivedBytes = current.receivedBytes + DOWNLOAD_STEP_BYTES;
      if (receivedBytes < PARAKEET.sizeBytes) return setState({ phase: "downloading", receivedBytes });
      window.clearInterval(timer);
      setState({ phase: "installed", memoryBytes: null });
    }, 120);
  }

  const tabs = [
    ...navItems.slice(0, 2),
    {
      value: "voice",
      titleKey: "settings.tab.voice.title",
      descriptionKey: "settings.tab.voice.description",
      icon: Mic,
    } as const,
    ...navItems.slice(2),
  ];

  return (
    <Tabs.Root value="voice" orientation="vertical" class="settings-modal-tabs-root">
      <SettingsDialogShell
        class="app-settings-modal-shell"
        open
        onOpenChange={() => undefined}
        title={t("settings.tab.voice.title")}
        description={t("settings.tab.voice.description")}
        contentKey="voice"
        sidebar={
          <Tabs.List class="settings-modal-nav" aria-label={t("settings.sections.label")}>
            {tabs.map((item) => {
              const NavIcon = item.icon;
              return (
                <Tabs.Trigger
                  class="settings-modal-nav-item"
                  value={item.value}
                  aria-current={item.value === "voice" ? "page" : undefined}
                >
                  <NavIcon aria-hidden="true" />
                  <span>{t(item.titleKey)}</span>
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>
        }
      >
        <Tabs.Content value="voice" class="settings-modal-tab-panel" data-tab="voice">
          <SettingsVoiceTab
            model={PARAKEET}
            state={state()}
            idleUnloadMinutes={1}
            location={LOCATION}
            olderModels={olderModels()}
            onDownload={download}
            onRemove={async () => {
              await new Promise((resolve) => window.setTimeout(resolve, 700));
              setState({ phase: "missing" });
            }}
            onUnload={() => setState({ phase: "installed", memoryBytes: null })}
            onReveal={() => undefined}
            onRemoveOlder={(id) => setOlderModels((current) => current.filter((older) => older.id !== id))}
          />
        </Tabs.Content>
      </SettingsDialogShell>
    </Tabs.Root>
  );
}

const meta = {
  title: "Settings/Voice",
  component: VoiceSettingsStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof VoiceSettingsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The model is on disk and in memory, a few seconds after a recording. */
export const Loaded: Story = {
  args: { state: { phase: "installed", memoryBytes: LOADED_MEMORY_BYTES } },
};

/** The model is on disk, but no recording ran in the last minute. */
export const Installed: Story = {
  args: { state: { phase: "installed", memoryBytes: null } },
};

/** A new install, or after Remove. */
export const NotInstalled: Story = {
  args: { state: { phase: "missing" } },
};

export const Downloading: Story = {
  args: { state: { phase: "downloading", receivedBytes: 287 * 1024 ** 2 } },
};

export const DownloadFailed: Story = {
  args: {
    state: { phase: "failed", message: "The download stopped. Check your internet connection and try again." },
  },
};

/** Whisper files that an earlier version left, for example when the automatic removal failed. */
export const OlderModelLeft: Story = {
  args: { state: { phase: "installed", memoryBytes: null }, olderModels: [WHISPER] },
};
