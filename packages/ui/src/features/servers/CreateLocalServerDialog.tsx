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
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";

export interface CreateLocalServerDialogProps {
  onClose: () => void;
  /** This computer has `LOCAL_SERVER_LIMIT` servers. The dialog says so and does not create one. */
  limitReached: boolean;
  /** Resolves when the server runs and the desktop is connected to it. A failure stays in the dialog. */
  onCreate: (name: string) => Promise<void>;
}

/** Asks for the name of a new server that runs on this computer, with its own agents, chats and files. */
export function CreateLocalServerDialog(props: CreateLocalServerDialogProps) {
  const { t, errorMessage } = useText();
  const [name, setName] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const trimmedName = () => name().trim();
  const nameTooShort = () => trimmedName().length < INPUT_LIMITS.serverNameMin;

  async function create(): Promise<void> {
    if (creating() || nameTooShort() || props.limitReached) return;
    setCreating(true);
    setError(null);
    try {
      await props.onCreate(trimmedName());
      props.onClose();
    } catch (cause) {
      setError(errorMessage(cause, t("server.local.createFailed")));
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
          <Dialog.Content class="create-local-server-dialog" as="section" aria-busy={creating() ? "true" : undefined}>
            <header class="create-local-server-header">
              <Dialog.Title class="create-local-server-title">{t("server.local.createTitle")}</Dialog.Title>
              <Dialog.Description class="create-local-server-description">
                {t("server.local.createDescription")}
              </Dialog.Description>
            </header>

            <form
              class="create-local-server-form"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <Field label={t("server.local.nameLabel")} htmlFor="create-local-server-name">
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
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
