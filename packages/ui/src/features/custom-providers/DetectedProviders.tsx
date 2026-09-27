import type { CustomProviderRestart } from "@openbot/contracts/ipc";
import {
  Badge,
  Bot,
  Button,
  HardDrive,
  IconButton,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  RefreshCw,
  Spinner,
  Text,
  X,
} from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { DetectedProviderSetup } from "./DetectedProviderSetup";
import {
  type DetectedProvider,
  type DetectedProviderApi,
  detectedLocation,
  type ProviderDetection,
} from "./detected-providers";

interface DetectedProvidersProps {
  detection: ProviderDetection;
  api: DetectedProviderApi;
  /** Saved IDs, so a duplicate is a field error in the form before a round trip. */
  takenProviderIds?: readonly string[] | undefined;
  takenAgentIds?: readonly string[] | undefined;
  disabled?: boolean | undefined;
  /** After an Add or an Edit, so the host can say when the new models appear. */
  onSaved?: ((kind: DetectedProvider["kind"], restart: CustomProviderRestart | undefined) => void) | undefined;
}

export function DetectedProviders(props: DetectedProvidersProps) {
  const { t } = useText();
  /** The row whose form is open. Add and Edit open the same filled form. */
  const [setupFor, setSetupFor] = createSignal<DetectedProvider | null>(null);
  const hidden = () => props.detection.hidden ?? 0;

  const title = (provider: DetectedProvider) =>
    provider.kind === "agent" && provider.version
      ? t("customProvider.detected.nameVersion", { name: provider.name, version: provider.version })
      : provider.name;

  const detail = (provider: DetectedProvider) =>
    provider.kind === "models"
      ? t("customProvider.detected.modelsDetail", {
          count: provider.models.length,
          location: detectedLocation(provider),
        })
      : t("customProvider.detected.agentDetail", { location: detectedLocation(provider) });

  return (
    <section
      class="detected-providers"
      aria-label={t("customProvider.detected.title")}
      aria-busy={props.detection.scanning ? "true" : "false"}
    >
      <div class="detected-providers-heading">
        <Text variant="label-sm" tone="muted">
          {t("customProvider.detected.title")}
        </Text>
        <Show when={props.detection.scanning}>
          <span class="detected-providers-scanning" role="status">
            <Spinner size="sm" />
            <Text variant="caption" tone="muted">
              {t("customProvider.detected.scanning")}
            </Text>
          </span>
        </Show>
        <Show when={!props.detection.scanning ? props.api.scan : undefined}>
          {(scan) => (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              class="detected-providers-scan"
              disabled={props.disabled}
              onClick={() => scan()()}
            >
              <RefreshCw />
              {t("customProvider.detected.scanAgain")}
            </Button>
          )}
        </Show>
      </div>
      <Show
        when={props.detection.found.length > 0}
        fallback={
          <Show when={!props.detection.scanning && hidden() === 0}>
            <Text class="detected-providers-empty" variant="caption" tone="muted">
              {t("customProvider.detected.empty")}
            </Text>
          </Show>
        }
      >
        <ItemGroup surface="subtle">
          {/* Keyed by the detection key, so a store update keeps the row and the focus of its Edit button. */}
          <For each={props.detection.found} keyed={(row) => row.key}>
            {(provider) => (
              <Item size="compact">
                <ItemMedia class="detected-providers-icon" aria-hidden="true">
                  <Show when={provider().kind === "agent"} fallback={<HardDrive />}>
                    <Bot />
                  </Show>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{title(provider())}</ItemTitle>
                  <ItemDescription>{detail(provider())}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Show
                    when={!provider().added}
                    fallback={
                      <>
                        <Badge variant="success-light">{t("customProvider.detected.added")}</Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          aria-label={t("customProvider.detected.editLabel", { name: provider().name })}
                          disabled={props.disabled}
                          onClick={() => setSetupFor(provider())}
                        >
                          {t("customProvider.detected.edit")}
                        </Button>
                      </>
                    }
                  >
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      aria-label={t("customProvider.detected.addLabel", { name: provider().name })}
                      disabled={props.disabled}
                      onClick={() => setSetupFor(provider())}
                    >
                      {t("customProvider.detected.add")}
                    </Button>
                    <IconButton
                      label={t("customProvider.detected.hide", { name: provider().name })}
                      variant="ghost"
                      size="icon-xs"
                      disabled={props.disabled}
                      onClick={() => props.api.hide(provider())}
                    >
                      <X />
                    </IconButton>
                  </Show>
                </ItemActions>
              </Item>
            )}
          </For>
        </ItemGroup>
      </Show>
      <Show when={hidden() > 0}>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          class="detected-providers-show-hidden"
          disabled={props.disabled}
          onClick={() => props.api.showHidden()}
        >
          {t("customProvider.detected.showHidden", { count: hidden() })}
        </Button>
      </Show>
      <DetectedProviderSetup
        provider={setupFor()}
        api={props.api}
        takenProviderIds={props.takenProviderIds}
        takenAgentIds={props.takenAgentIds}
        onClose={() => setSetupFor(null)}
        onSaved={props.onSaved}
      />
    </section>
  );
}
