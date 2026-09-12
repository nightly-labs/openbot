/**
 * The optional OpenCode Zen key.
 *
 * OpenCode's free models run with no account, so this dialog is an addition and never a gate: it
 * says so first, and it opens from a provider row that is already usable. A saved key is reported
 * as a fact and never read back into the input -- main has no getter for it, and a renderer that
 * could show a key would carry it into every screenshot and crash report that follows.
 */

import { ProviderLogo } from "@openbot/brand";
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
  ExternalLink,
  Field,
  Input,
  OctagonX,
  Text,
} from "../../components/ui";
import { errorMessage } from "../../error-message";
import { useI18n } from "../i18n/i18n-context";

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
  const i18n = useI18n();
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
      setError(errorMessage(cause, i18n.t("settings.openCode.readError")));
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
      setError(errorMessage(cause, i18n.t("settings.openCode.saveError")));
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
      setError(errorMessage(cause, i18n.t("settings.openCode.removeError")));
      setPhase("idle");
    }
  }

  function openPage(destination: ExternalDestination): void {
    props.api.openExternal(destination).catch((cause: unknown) => {
      setError(errorMessage(cause, i18n.t("settings.openCode.openError")));
    });
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
              <ProviderLogo provider="opencode" class="opencode-key-logo" />
              <Dialog.Title class="opencode-key-title">{i18n.t("settings.openCode.title")}</Dialog.Title>
              <Dialog.Description class="opencode-key-description">
                {i18n.t("settings.openCode.description")}
              </Dialog.Description>
            </header>

            <Show when={stored() === "saved"}>
              <Text class="opencode-key-saved" variant="body-sm" tone="secondary">
                {i18n.t("settings.openCode.saved")}
              </Text>
            </Show>
            <Show when={stored() === "unreadable"}>
              <Text class="opencode-key-saved" variant="body-sm" tone="secondary">
                {i18n.t("settings.openCode.unreadable")}
              </Text>
            </Show>

            <form
              class="opencode-key-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <Field
                label={i18n.t("settings.openCode.keyLabel")}
                description={i18n.t("settings.openCode.keyDescription")}
              >
                <Input
                  type="password"
                  autocomplete="off"
                  spellcheck={false}
                  placeholder={i18n.t("settings.openCode.placeholder")}
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
                      <AlertTitle>{i18n.t("settings.openCode.title")}</AlertTitle>
                      <AlertDescription>{message()}</AlertDescription>
                    </AlertContent>
                  </Alert>
                )}
              </Show>

              <footer class="opencode-key-actions">
                <Button
                  type="submit"
                  variant="default"
                  loading={phase() === "saving"}
                  loadingLabel={i18n.t("settings.saving")}
                  disabled={busy() || !key().trim()}
                >
                  {i18n.t("settings.openCode.save")}
                </Button>
                <Show when={stored() !== "missing"}>
                  <Button
                    type="button"
                    variant="outline"
                    loading={phase() === "removing"}
                    loadingLabel={i18n.t("settings.openCode.removing")}
                    disabled={busy()}
                    onClick={() => void remove()}
                  >
                    {i18n.t("settings.openCode.remove")}
                  </Button>
                </Show>
                <Button type="button" variant="ghost" disabled={busy()} onClick={props.onClose}>
                  {i18n.t("settings.cancel")}
                </Button>
              </footer>
            </form>

            <div class="opencode-key-links">
              <Button type="button" variant="outline" size="sm" onClick={() => openPage("opencode-auth")}>
                <ExternalLink size={13} aria-hidden="true" />
                {i18n.t("settings.openCode.getKey")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => openPage("opencode-install")}>
                {i18n.t("settings.openCode.learnMore")}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
