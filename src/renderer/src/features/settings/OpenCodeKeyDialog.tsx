/**
 * The optional OpenCode Go key.
 *
 * OpenCode's free models run with no account, so this dialog is an addition and never a gate: it
 * says so first, and it opens from a provider row that is already usable. A saved key is reported
 * as a fact and never read back into the input -- main has no getter for it, and a renderer that
 * could show a key would carry it into every screenshot and crash report that follows.
 */

import type {
  AgentProviderId,
  ExternalDestination,
  ProviderApiKeyState,
  ProviderApiKeyStatus,
} from "@openbot/contracts/ipc";
import { createSignal, onSettled, Show } from "solid-js";
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
} from "../../components/ui";
import { errorMessage } from "../../error-message";

/** The provider-key half of the desktop API, narrowed so a test can pass four functions. */
export interface ProviderKeyApi {
  getProviderApiKeyState: (provider: AgentProviderId) => Promise<ProviderApiKeyState>;
  setProviderApiKey: (input: { provider: AgentProviderId; key: string }) => Promise<unknown>;
  clearProviderApiKey: (provider: AgentProviderId) => Promise<unknown>;
  openExternal: (destination: ExternalDestination) => Promise<void>;
}

export interface OpenCodeKeyDialogProps {
  api: ProviderKeyApi;
  onClose: () => void;
}

type DialogPhase = "idle" | "loading" | "saving" | "removing";

export function OpenCodeKeyDialog(props: OpenCodeKeyDialogProps) {
  const [key, setKey] = createSignal("");
  const [stored, setStored] = createSignal<ProviderApiKeyStatus>("missing");
  const [phase, setPhase] = createSignal<DialogPhase>("loading");
  const [error, setError] = createSignal<string | null>(null);
  const busy = () => phase() !== "idle";

  onSettled(() => {
    void readState();
  });

  async function readState(): Promise<void> {
    setPhase("loading");
    try {
      setStored((await props.api.getProviderApiKeyState("opencode")).status);
    } catch (cause) {
      setError(errorMessage(cause, "Could not read the saved key."));
    } finally {
      setPhase("idle");
    }
  }

  async function save(): Promise<void> {
    const value = key().trim();
    if (busy() || !value) return;
    setPhase("saving");
    setError(null);
    try {
      await props.api.setProviderApiKey({ provider: "opencode", key: value });
      // The typed key is dropped rather than kept as a draft: OpenCode has restarted with it, and
      // the dialog keeps no copy of a secret it no longer needs.
      setKey("");
      props.onClose();
    } catch (cause) {
      setError(errorMessage(cause, "Could not save the key."));
      setPhase("idle");
    }
  }

  async function remove(): Promise<void> {
    if (busy()) return;
    setPhase("removing");
    setError(null);
    try {
      await props.api.clearProviderApiKey("opencode");
      setKey("");
      props.onClose();
    } catch (cause) {
      setError(errorMessage(cause, "Could not remove the key."));
      setPhase("idle");
    }
  }
  return (
    <Dialog.Root
      open={true}
      onOpenChange={(open) => {
        if (!open && !busy()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="opencode-key-backdrop">
          <Dialog.Content class="opencode-key-dialog" as="section">
            <header class="opencode-key-header">
              <Dialog.Title class="opencode-key-title">Sign in to OpenCode Go</Dialog.Title>
              {/* One line that is always the dialog's whole message: the default pitch, the saved
                  fact, or the unreadable warning. A second text block would repeat it. */}
              <Dialog.Description class="opencode-key-description">
                <Show
                  when={stored() === "saved"}
                  fallback={
                    <Show
                      when={stored() === "unreadable"}
                      fallback={"Free models need no account. A key unlocks the paid Go models."}
                    >
                      Saved key is unreadable. Paste it again, or remove it.
                    </Show>
                  }
                >
                  <span class="opencode-key-status-dot" aria-hidden="true" />
                  Key saved. Paste a new one to replace it.
                </Show>
              </Dialog.Description>
            </header>

            <form
              class="opencode-key-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <Field label="OpenCode Go key">
                <Input
                  type="password"
                  autocomplete="off"
                  spellcheck={false}
                  placeholder="Paste your key"
                  value={key()}
                  disabled={busy()}
                  onValueChange={setKey}
                />
              </Field>

              <Show when={error()}>
                {(message) => (
                  <Alert class="opencode-key-alert" tone="danger" role="alert">
                    <AlertIcon>
                      <OctagonX />
                    </AlertIcon>
                    <AlertContent>
                      <AlertTitle>OpenCode Go</AlertTitle>
                      <AlertDescription>{message()}</AlertDescription>
                    </AlertContent>
                  </Alert>
                )}
              </Show>

              <footer class="opencode-key-actions">
                <Button type="button" variant="ghost" disabled={busy()} onClick={props.onClose}>
                  Cancel
                </Button>
                <Show when={stored() !== "missing"}>
                  <Button
                    type="button"
                    variant="destructive-ghost"
                    loading={phase() === "removing"}
                    loadingLabel="Removing…"
                    disabled={busy()}
                    onClick={() => void remove()}
                  >
                    Remove key
                  </Button>
                </Show>
                <Button
                  type="submit"
                  variant="default"
                  loading={phase() === "saving"}
                  loadingLabel="Saving…"
                  disabled={busy() || !key().trim()}
                >
                  Save key
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
