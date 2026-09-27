import {
  Badge,
  Bot,
  Button,
  ChevronRight,
  Dialog,
  Globe2,
  HardDrive,
  Heading,
  IconButton,
  Plus,
  Text,
  X,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import type { CustomProviderPresetId, LocalServerProbe } from "./custom-provider-presets";

interface CustomProviderPresetDialogProps {
  open: boolean;
  /**
   * What the host found at each local server's default address. A missing entry shows no status,
   * so a host that does not probe shows the plain list.
   */
  probes?: Partial<Record<"ollama" | "lmstudio", LocalServerProbe>>;
  onChoose: (preset: CustomProviderPresetId) => void;
  onCancel: () => void;
}

interface PresetRow {
  id: CustomProviderPresetId;
  icon: () => JSX.Element;
  title: () => string;
  description: () => string;
}

function ProbeBadge(badge: { probe: LocalServerProbe }) {
  const { t } = useText();
  return (
    <Show
      when={badge.probe.status === "running" ? badge.probe : undefined}
      fallback={<Badge variant="secondary">{t("customProvider.probe.checking")}</Badge>}
    >
      {(running) => (
        <Badge variant="success-light">{t("customProvider.probe.running", { count: running().models })}</Badge>
      )}
    </Show>
  );
}

function PresetGroup(group: {
  label: string;
  rows: readonly PresetRow[];
  probe: (id: CustomProviderPresetId) => LocalServerProbe | undefined;
  onChoose: (preset: CustomProviderPresetId) => void;
}) {
  return (
    <section class="custom-provider-preset-group" aria-label={group.label}>
      <Text variant="label-sm" tone="muted">
        {group.label}
      </Text>
      <ul class="custom-provider-presets">
        <For each={group.rows}>
          {(row) => (
            <li>
              <Button
                type="button"
                variant="ghost"
                class="custom-provider-preset"
                onClick={() => group.onChoose(row.id)}
              >
                <span class="custom-provider-preset-icon" aria-hidden="true">
                  {row.icon()}
                </span>
                <span class="custom-provider-preset-copy">
                  <span class="custom-provider-preset-title">{row.title()}</span>
                  <span class="custom-provider-preset-description">{row.description()}</span>
                </span>
                <Show when={group.probe(row.id)}>{(state) => <ProbeBadge probe={state()} />}</Show>
                <ChevronRight class="custom-provider-preset-chevron" aria-hidden="true" />
              </Button>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

export function CustomProviderPresetDialog(props: CustomProviderPresetDialogProps) {
  const { t } = useText();

  const modelRows: readonly PresetRow[] = [
    {
      id: "ollama",
      icon: () => <HardDrive />,
      title: () => t("customProvider.preset.ollama"),
      description: () => t("customProvider.preset.ollamaDescription"),
    },
    {
      id: "lmstudio",
      icon: () => <HardDrive />,
      title: () => t("customProvider.preset.lmstudio"),
      description: () => t("customProvider.preset.lmstudioDescription"),
    },
    {
      id: "openai-compatible",
      icon: () => <Globe2 />,
      title: () => t("customProvider.preset.openaiCompatible"),
      description: () => t("customProvider.preset.openaiCompatibleDescription"),
    },
  ];

  const agentRows: readonly PresetRow[] = [
    {
      id: "acp",
      icon: () => <Bot />,
      title: () => t("customProvider.preset.acp"),
      description: () => t("customProvider.preset.acpDescription"),
    },
  ];

  const probe = (id: CustomProviderPresetId): LocalServerProbe | undefined =>
    id === "ollama" || id === "lmstudio" ? props.probes?.[id] : undefined;

  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => !open && props.onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay class="custom-provider-backdrop">
          <Dialog.Content as="section" class="custom-provider-dialog">
            <Dialog.Title class="sr-only">{t("customProvider.preset.title")}</Dialog.Title>
            <Dialog.Description class="sr-only">{t("customProvider.preset.description")}</Dialog.Description>

            <header class="custom-provider-header">
              <span class="custom-provider-mark" aria-hidden="true">
                <Plus />
              </span>
              <div class="custom-provider-title">
                <Heading as="h2" size="md">
                  {t("customProvider.preset.heading")}
                </Heading>
                <Text tone="muted" variant="caption">
                  {t("customProvider.preset.subtitle")}
                </Text>
              </div>
              <IconButton
                class="custom-provider-close"
                label={t("common.close")}
                variant="ghost"
                onClick={props.onCancel}
              >
                <X />
              </IconButton>
            </header>

            <div class="custom-provider-list">
              <PresetGroup
                label={t("customProvider.preset.models")}
                rows={modelRows}
                probe={probe}
                onChoose={props.onChoose}
              />
              <PresetGroup
                label={t("customProvider.preset.agents")}
                rows={agentRows}
                probe={probe}
                onChoose={props.onChoose}
              />
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
