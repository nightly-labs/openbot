import { ProviderLogo } from "@openbot/brand";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { Button, Dialog, IconButton, Input, SlidersHorizontal, X } from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../text";

interface MoreProvidersEntry {
  id: AgentProviderId;
  name: string;
  description?: string | null;
}

export interface MoreProvidersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The providers that the list does not show, in the order to list them. */
  providers: readonly MoreProvidersEntry[];
  /** Adds the custom provider entry below a divider. */
  custom?: boolean;
  onChoose: (provider: AgentProviderId) => void;
  onChooseCustom?: (() => void) | undefined;
  /** Kobalte calls it when the dialog closes, before it moves the focus back to the trigger. */
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
}

/** The search field shows only when the list is long enough to need it. */
const SEARCH_FROM = 8;

/**
 * The providers that are not in the list: a title and one plain list. Each row is the full target,
 * so there are no group labels, cards or "Add" buttons. The custom provider is last, below a line.
 */
export function MoreProvidersDialog(props: MoreProvidersDialogProps) {
  const { t } = useText();
  const [query, setQuery] = createSignal("");
  const searchable = () => props.providers.length >= SEARCH_FROM;
  const matches = () => {
    const text = query().trim().toLowerCase();
    if (!text || !searchable()) return props.providers;
    return props.providers.filter((provider) =>
      `${provider.name} ${provider.description ?? ""}`.toLowerCase().includes(text),
    );
  };
  const close = () => {
    props.onOpenChange(false);
    setQuery("");
  };
  const choose = (provider: AgentProviderId) => {
    props.onChoose(provider);
    close();
  };
  const chooseCustom = () => {
    props.onChooseCustom?.();
    close();
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay class="custom-provider-backdrop provider-more-backdrop">
          <Dialog.Content
            as="section"
            class="custom-provider-dialog provider-more-dialog"
            onCloseAutoFocus={props.onCloseAutoFocus}
          >
            <header class="provider-more-header">
              <Dialog.Title as="h2" class="provider-more-title">
                {t("onboarding.provider.more")}
              </Dialog.Title>
              <IconButton label={t("common.close")} variant="ghost" onClick={close}>
                <X />
              </IconButton>
            </header>
            <Show when={searchable()}>
              <Input
                type="search"
                class="provider-more-search"
                placeholder={t("common.search")}
                aria-label={t("onboarding.provider.moreSearch")}
                autocomplete="off"
                value={query()}
                onValueChange={setQuery}
              />
            </Show>
            <div class="provider-more-list">
              <For each={matches()} keyed={false}>
                {(provider) => (
                  <Button type="button" variant="ghost" class="provider-more-row" onClick={() => choose(provider().id)}>
                    <ProviderLogo provider={provider().id} class="provider-picker-logo" />
                    <span class="provider-picker-identity">
                      <span class="provider-picker-name">{provider().name}</span>
                      <Show when={provider().description}>
                        {(description) => <small class="provider-picker-email">{description()}</small>}
                      </Show>
                    </span>
                  </Button>
                )}
              </For>
              <Show when={query().trim() && matches().length === 0}>
                <p class="provider-more-empty">{t("onboarding.provider.moreNoMatch", { query: query().trim() })}</p>
              </Show>
              <Show when={props.custom}>
                <hr class="provider-more-divider" />
                <Button type="button" variant="ghost" class="provider-more-row" onClick={chooseCustom}>
                  <SlidersHorizontal class="provider-picker-custom-mark" aria-hidden="true" />
                  <span class="provider-picker-identity">
                    <span class="provider-picker-name">{t("provider.custom.name")}</span>
                    <small class="provider-picker-email">{t("provider.custom.description")}</small>
                  </span>
                </Button>
              </Show>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
