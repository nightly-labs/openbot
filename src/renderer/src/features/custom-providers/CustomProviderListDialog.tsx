import type { CustomProviderSummary } from "@openbot/contracts/ipc";
import { For, onSettled, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import {
  Button,
  Dialog,
  Heading,
  IconButton,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SlidersHorizontal,
  Text,
  Trash2,
  X,
} from "../../components/ui";

interface CustomProviderListDialogProps {
  open: boolean;
  providers: readonly CustomProviderSummary[];
  /** The ID being removed, so only that row's button is busy. */
  removing: string | null;
  /** The last outcome of a removal, shown here while this dialog holds the screen. */
  note: string | null;
  /** Without it the rows are listed but not removable, which is what a remote server shows. */
  onDelete?: (provider: CustomProviderSummary) => void;
  onClose: () => void;
}

/**
 * The endpoints the user has saved, and the only place they are removed.
 *
 * The list left the AI providers section for this dialog because it repeated what the Custom
 * provider row already says and grew without limit inside a section of fixed rows.
 *
 * Removing the last endpoint leaves this open on its empty state rather than closing by itself: a
 * dialog that vanishes under the hand reads as a crash, and the outcome message is here. The count
 * button that opened it is gone by then, so focus falls back to the document after the close - which
 * is cheaper to accept than a focus handle on the picker for this one case.
 */
export function CustomProviderListDialog(props: CustomProviderListDialogProps) {
  const fades = createScrollFades();
  onSettled(() => fades.stop);
  const busy = () => props.removing !== null;

  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay class="custom-provider-backdrop">
          <Dialog.Content as="section" class="custom-provider-dialog" aria-busy={busy() ? "true" : undefined}>
            <Dialog.Title class="sr-only">Custom providers</Dialog.Title>
            <Dialog.Description class="sr-only">
              The endpoints you have saved. Remove the ones you no longer use.
            </Dialog.Description>

            <header class="custom-provider-header">
              <span class="custom-provider-mark" aria-hidden="true">
                <SlidersHorizontal />
              </span>
              <div class="custom-provider-title">
                <Heading as="h2" size="md">
                  Custom providers
                </Heading>
                <Text tone="muted" variant="caption">
                  Your own model endpoints.
                </Text>
              </div>
              <IconButton class="custom-provider-close" label="Close" variant="ghost" onClick={props.onClose}>
                <X />
              </IconButton>
            </header>

            <div class="custom-provider-body">
              <div class={["custom-provider-list", fades.classes()]} ref={fades.bind} onScroll={fades.measure}>
                <Show
                  when={props.providers.length > 0}
                  fallback={
                    <Text class="custom-provider-list-empty" tone="muted" variant="caption">
                      No custom endpoints yet.
                    </Text>
                  }
                >
                  <ItemGroup surface="subtle" aria-label="Custom endpoints">
                    <For each={props.providers}>
                      {(provider) => (
                        <Item>
                          <ItemContent>
                            <ItemTitle>{provider.name}</ItemTitle>
                            <ItemDescription>
                              {provider.baseUrl}
                              {provider.hasApiKey ? " · API key saved" : ""}
                            </ItemDescription>
                          </ItemContent>
                          <Show when={props.onDelete}>
                            {(onDelete) => (
                              <ItemActions>
                                <Button
                                  variant="destructive-ghost"
                                  size="sm"
                                  aria-label={`Delete ${provider.name}`}
                                  disabled={busy()}
                                  onClick={() => onDelete()(provider)}
                                >
                                  <Trash2 size={14} aria-hidden="true" />
                                  Delete
                                </Button>
                              </ItemActions>
                            )}
                          </Show>
                        </Item>
                      )}
                    </For>
                  </ItemGroup>
                </Show>
              </div>

              <footer class="custom-provider-actions">
                <Show when={props.note}>
                  {(message) => (
                    <Text tone="muted" variant="caption" role="status">
                      {message()}
                    </Text>
                  )}
                </Show>
                <Button type="button" variant="default" onClick={props.onClose}>
                  Done
                </Button>
              </footer>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
