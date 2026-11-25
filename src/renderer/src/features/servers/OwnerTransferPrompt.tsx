import type { AcceptedOwnerTransfer, OwnerTransfer } from "@openbot/contracts/owner-transfer";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Button,
  Crown,
  Dialog,
  TriangleAlert,
  toast,
} from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { ScrollEdgeBlur } from "@openbot/ui/components/ScrollEdgeBlur";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, onCleanup, Show } from "solid-js";

export interface OwnerTransferPromptCalls {
  list(): Promise<OwnerTransfer[]>;
  accept(transferId: string): Promise<AcceptedOwnerTransfer>;
  decline(transferId: string): Promise<void>;
}

interface OwnerTransferPromptState {
  transfers: OwnerTransfer[];
  postponed: string[];
  pending: "accept" | "decline" | null;
  error: string | null;
}

export function OwnerTransferPrompt(props: {
  calls: OwnerTransferPromptCalls;
  reloadKey: unknown;
  onAccepted: (accepted: AcceptedOwnerTransfer) => void;
}) {
  const { t, errorMessage } = useText();
  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  const [state, setState] = createStore<OwnerTransferPromptState>({
    transfers: [],
    postponed: [],
    pending: null,
    error: null,
  });
  const current = createMemo(
    () => state.transfers.find((transfer) => !state.postponed.includes(transfer.transferId)) ?? null,
  );
  const sender = (transfer: OwnerTransfer) => transfer.fromName ?? transfer.fromEmail;

  createEffect(
    () => props.reloadKey,
    () => {
      void props.calls
        .list()
        .then((transfers) =>
          setState((draft) => {
            draft.transfers = transfers;
          }),
        )
        .catch(() => undefined);
    },
  );

  function settle(transferId: string): void {
    setState((draft) => {
      draft.transfers = draft.transfers.filter((transfer) => transfer.transferId !== transferId);
      draft.pending = null;
      draft.error = null;
    });
  }

  function postpone(transferId: string): void {
    if (state.pending) return;
    setState((draft) => {
      draft.postponed = [...draft.postponed, transferId];
      draft.error = null;
    });
  }

  async function answer(transfer: OwnerTransfer, choice: "accept" | "decline"): Promise<void> {
    if (state.pending) return;
    setState((draft) => {
      draft.pending = choice;
      draft.error = null;
    });
    try {
      if (choice === "accept") {
        const accepted = await props.calls.accept(transfer.transferId);
        settle(transfer.transferId);
        toast.success(t("server.ownerTransfer.accepted", { server: accepted.hostName }));
        props.onAccepted(accepted);
      } else {
        await props.calls.decline(transfer.transferId);
        settle(transfer.transferId);
      }
    } catch (error) {
      setState((draft) => {
        draft.pending = null;
        draft.error = errorMessage(
          error,
          choice === "accept" ? t("server.ownerTransfer.acceptFailed") : t("server.ownerTransfer.declineFailed"),
        );
      });
    }
  }

  return (
    <Show when={current()}>
      {(transfer) => (
        <Dialog.Root open onOpenChange={(open) => !open && postpone(transfer().transferId)}>
          <Dialog.Portal>
            <Dialog.Overlay class="ui-confirm-dialog-overlay">
              <Dialog.Content class="ui-confirm-dialog" data-tone="default">
                <div
                  class={["ui-confirm-dialog-main", fades.classes()]}
                  ref={(element) => fades.bind(element)}
                  onScroll={fades.measure}
                >
                  <span class="ui-confirm-dialog-icon" aria-hidden="true">
                    <Crown />
                  </span>
                  <div class="ui-confirm-dialog-content" ref={(element) => fades.watch(element)}>
                    <Dialog.Title as="h2" class="ui-confirm-dialog-title">
                      {t("server.ownerTransfer.incomingTitle", { server: transfer().hostName })}
                    </Dialog.Title>
                    <Dialog.Description class="ui-confirm-dialog-description">
                      {t("server.ownerTransfer.incomingDescription", {
                        name: sender(transfer()),
                        server: transfer().hostName,
                      })}
                    </Dialog.Description>
                    <div class="ui-confirm-dialog-body">
                      <ul>
                        <li>{t("server.ownerTransfer.incomingYours")}</li>
                        <li>{t("server.ownerTransfer.incomingPrevious", { name: sender(transfer()) })}</li>
                        <li>{t("server.ownerTransfer.incomingStays")}</li>
                        <li>{t("server.ownerTransfer.incomingMachine")}</li>
                      </ul>
                    </div>
                    <Show when={state.error}>
                      {(message) => (
                        <Alert tone="danger" report={false} role="alert" class="ui-confirm-dialog-error">
                          <AlertIcon>
                            <TriangleAlert />
                          </AlertIcon>
                          <AlertContent>
                            <AlertDescription>{message()}</AlertDescription>
                          </AlertContent>
                        </Alert>
                      )}
                    </Show>
                  </div>
                </div>
                <ScrollEdgeBlur fades={fades} />
                <footer class="ui-confirm-dialog-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={state.pending !== null}
                    onClick={() => postpone(transfer().transferId)}
                  >
                    {t("server.ownerTransfer.later")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={state.pending === "accept"}
                    loading={state.pending === "decline"}
                    onClick={() => void answer(transfer(), "decline")}
                  >
                    {t("server.ownerTransfer.decline")}
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    disabled={state.pending === "decline"}
                    loading={state.pending === "accept"}
                    onClick={() => void answer(transfer(), "accept")}
                  >
                    {t("server.ownerTransfer.accept")}
                  </Button>
                </footer>
              </Dialog.Content>
            </Dialog.Overlay>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </Show>
  );
}
