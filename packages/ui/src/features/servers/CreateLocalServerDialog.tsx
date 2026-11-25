import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { LOCAL_SERVER_LIMIT } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Dialog,
  Field,
  Input,
  OctagonX,
  TriangleAlert,
} from "@openbot/ui";
import { createSignal, onCleanup, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { ScrollEdgeBlur } from "../../components/ScrollEdgeBlur";
import { useText } from "../../text";

export interface CreateLocalServerDialogProps {
  onClose: () => void;
  limitReached: boolean;
  onCreate: (name: string) => Promise<void>;
}

export function CreateLocalServerDialog(props: CreateLocalServerDialogProps) {
  const { t, errorMessage } = useText();
  const [name, setName] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const trimmedName = () => name().trim();
  const nameTooShort = () => trimmedName().length < INPUT_LIMITS.serverNameMin;
  const fades = createScrollFades();
  onCleanup(() => fades.stop());

  async function create(): Promise<void> {
    if (creating() || nameTooShort() || props.limitReached) return;
    setCreating(true);
    setError(null);
    try {
      await props.onCreate(trimmedName());
      props.onClose();
    } catch (cause) {
      setError(errorMessage(cause, t("server.local.createFailedRetry")));
      setCreating(false);
    }
  }

  return (
    <Dialog.Root
      open={true}
      onOpenChange={(open) => {
        if (!open && !creating()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay>
          <Dialog.Content
            class={["create-local-server-dialog", fades.classes()]}
            as="section"
            aria-busy={creating() ? "true" : undefined}
            ref={(element: HTMLElement) => fades.bind(element)}
            onScroll={fades.measure}
          >
            <header class="create-local-server-header">
              <Dialog.Title class="create-local-server-title">{t("server.local.createTitle")}</Dialog.Title>
              <Dialog.Description class="create-local-server-description">
                {t("server.local.createDescription")}
              </Dialog.Description>
            </header>

            <form
              class="create-local-server-form"
              ref={(element) => fades.watch(element)}
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <Field
                label={t("server.local.nameLabel")}
                htmlFor="create-local-server-name"
                error={
                  trimmedName() && nameTooShort()
                    ? t("server.settings.nameTooShort", { limit: INPUT_LIMITS.serverNameMin })
                    : undefined
                }
              >
                <Input
                  id="create-local-server-name"
                  autocomplete="off"
                  value={name()}
                  maxlength={INPUT_LIMITS.serverName}
                  disabled={creating() || props.limitReached}
                  onValueChange={(value) => {
                    setName(value);
                    setError(null);
                  }}
                  required
                />
              </Field>

              <Show when={props.limitReached}>
                <Alert class="create-local-server-alert" tone="warning" role="status">
                  <AlertIcon>
                    <TriangleAlert />
                  </AlertIcon>
                  <AlertContent>
                    <AlertDescription>{t("server.local.limitReached", { limit: LOCAL_SERVER_LIMIT })}</AlertDescription>
                  </AlertContent>
                </Alert>
              </Show>

              <Show when={error()}>
                {(message) => (
                  <Alert class="create-local-server-alert" tone="danger" role="alert">
                    <AlertIcon>
                      <OctagonX />
                    </AlertIcon>
                    <AlertContent>
                      <AlertTitle>{t("server.local.createFailed")}</AlertTitle>
                      <AlertDescription>{message()}</AlertDescription>
                    </AlertContent>
                  </Alert>
                )}
              </Show>

              <footer class="create-local-server-actions">
                <Button type="button" variant="ghost" disabled={creating()} onClick={props.onClose}>
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="default"
                  loading={creating()}
                  loadingLabel={t("server.local.creating")}
                  disabled={creating() || nameTooShort() || props.limitReached}
                >
                  {t("server.local.create")}
                </Button>
              </footer>
            </form>
          </Dialog.Content>
          <ScrollEdgeBlur fades={fades} />
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
