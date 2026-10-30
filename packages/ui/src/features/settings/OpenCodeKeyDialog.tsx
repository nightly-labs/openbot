/**
 * The optional OpenCode Go key.
 *
 * OpenCode's free models run with no account, so this dialog is an addition and never a gate: it
 * says so first, and it opens from a provider row that is already usable. A saved key is reported
 * as a fact and never read back into the input -- main has no getter for it, and a renderer that
 * could show a key would carry it into every screenshot and crash report that follows.
 */

import { isKeyOnlyProvider } from "@openbot/contracts/agent-providers";
import type {
  AgentProviderId,
  ExternalDestination,
  ProviderApiKeyState,
  ProviderApiKeyStatus,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
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
} from "@openbot/ui";
import { createSignal, onSettled, Show } from "solid-js";
import { useText } from "../../text";

/**
 * The text of each provider whose key this dialog saves. Muse, Gemini, Claude and Codex also sign in
 * without a key. Codex keeps its key in its own login, not in OpenBot's store.
 */
const KEY_TEXT = {
  opencode: {
    name: "OpenCode Go",
    title: "provider.openCodeKey.title",
    description: "provider.openCodeKey.description",
    label: "provider.openCodeKey.label",
  },
  muse: {
    name: "Muse",
    title: "provider.museKey.title",
    description: "provider.museKey.description",
    label: "provider.museKey.label",
  },
  antigravity: {
    name: "Gemini",
    title: "provider.geminiKey.title",
    description: "provider.geminiKey.description",
    label: "provider.geminiKey.label",
  },
  claude: {
    name: "Claude",
    title: "provider.claudeKey.title",
    description: "provider.claudeKey.description",
    label: "provider.claudeKey.label",
  },
  codex: {
    name: "OpenAI",
    title: "provider.codexKey.title",
    description: "provider.codexKey.description",
    label: "provider.codexKey.label",
  },
  inception: {
    name: "Inception",
    title: "provider.inceptionKey.title",
    description: "provider.inceptionKey.description",
    label: "provider.inceptionKey.label",
  },
  deepseek: {
    name: "DeepSeek",
    title: "provider.deepseekKey.title",
    description: "provider.deepseekKey.description",
    label: "provider.deepseekKey.label",
  },
  openrouter: {
    name: "OpenRouter",
    title: "provider.openrouterKey.title",
    description: "provider.openrouterKey.description",
    label: "provider.openrouterKey.label",
  },
} as const satisfies Record<string, { name: string; title: AppTextKey; description: AppTextKey; label: AppTextKey }>;

/** A provider whose API key this dialog saves. */
export type KeyDialogProvider = keyof typeof KEY_TEXT;

/** Whether `provider` has a key in this dialog. */
export function isKeyDialogProvider(provider: AgentProviderId): provider is KeyDialogProvider {
  return Object.hasOwn(KEY_TEXT, provider);
}

/** The provider-key half of the desktop API, narrowed so a test can pass four functions. */
export interface ProviderKeyApi {
  /**
   * Whether the host gives a saved Claude key to the Claude CLI: this computer, or a joined server
   * with `claude-api-key-v1`. An older host stores the key and never reads it.
   */
  readsClaudeKey?: boolean | undefined;
  getProviderApiKeyState: (provider: AgentProviderId) => Promise<ProviderApiKeyState>;
  setProviderApiKey: (input: { provider: AgentProviderId; key: string }) => Promise<unknown>;
  clearProviderApiKey: (provider: AgentProviderId) => Promise<unknown>;
  openExternal: (destination: ExternalDestination) => Promise<void>;
}

export interface OpenCodeKeyDialogProps {
  api: ProviderKeyApi;
  provider?: KeyDialogProvider;
  onClose: () => void;
  /**
   * Retries the connection without touching credentials. Without it a failed free provider with
   * no stored key could never retry from here: saving needs a key, removing needs one saved,
   * and closing answers nothing.
   */
  onReconnect?: (() => void | Promise<void>) | undefined;
}

type DialogPhase = "idle" | "loading" | "saving" | "removing";

export function OpenCodeKeyDialog(props: OpenCodeKeyDialogProps) {
  const { t, errorMessage } = useText();
  const provider = () => props.provider ?? "opencode";
  const text = () => KEY_TEXT[provider()];
  const [key, setKey] = createSignal("");
  const [stored, setStored] = createSignal<ProviderApiKeyStatus>("missing");
  const [phase, setPhase] = createSignal<DialogPhase>("loading");
  const [error, setError] = createSignal<string | null>(null);
  const busy = () => phase() !== "idle";

  onSettled(() => {
    void readState();
  });

  async function readState(): Promise<void> {
    // Codex keeps its key in its own login, so OpenBot's store has no state for it. Disconnect removes it.
    if (provider() === "codex") {
      setPhase("idle");
      return;
    }
    setPhase("loading");
    try {
      setStored((await props.api.getProviderApiKeyState(provider())).status);
    } catch (cause) {
      setError(errorMessage(cause, t("provider.openCodeKey.readFailed")));
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
      await props.api.setProviderApiKey({ provider: provider(), key: value });
      // The typed key is dropped rather than kept as a draft: OpenCode has restarted with it, and
      // the dialog keeps no copy of a secret it no longer needs.
      setKey("");
      props.onClose();
    } catch (cause) {
      setError(errorMessage(cause, t("provider.openCodeKey.saveFailed")));
      setPhase("idle");
    }
  }

  async function remove(): Promise<void> {
    if (busy()) return;
    setPhase("removing");
    setError(null);
    try {
      await props.api.clearProviderApiKey(provider());
      setKey("");
      props.onClose();
    } catch (cause) {
      setError(errorMessage(cause, t("provider.openCodeKey.removeFailed")));
      setPhase("idle");
    }
  }

  async function reconnect(): Promise<void> {
    if (!props.onReconnect) return;
    try {
      await props.onReconnect();
    } catch (cause) {
      setError(errorMessage(cause, t("provider.openCodeKey.reconnectFailed")));
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
              <Dialog.Title class="opencode-key-title">{t(text().title)}</Dialog.Title>
              {/* One line that is always the dialog's whole message: the default pitch, the saved
                  fact, or the unreadable warning. A second text block would repeat it. */}
              <Dialog.Description class="opencode-key-description">
                <Show
                  when={stored() === "saved"}
                  fallback={
                    <Show when={stored() === "unreadable"} fallback={t(text().description)}>
                      {t("provider.openCodeKey.unreadable")}
                    </Show>
                  }
                >
                  <span class="opencode-key-status-dot" aria-hidden="true" />
                  {t("provider.openCodeKey.saved")}
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
              <Field label={t(text().label)}>
                <Input
                  type="password"
                  autocomplete="off"
                  spellcheck={false}
                  placeholder={t("provider.openCodeKey.placeholder")}
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
                      <AlertTitle>{text().name}</AlertTitle>
                      <AlertDescription>{message()}</AlertDescription>
                    </AlertContent>
                  </Alert>
                )}
              </Show>

              <footer class="opencode-key-actions">
                <Button type="button" variant="ghost" disabled={busy()} onClick={props.onClose}>
                  {t("common.cancel")}
                </Button>
                {/* Gemini's and Claude's reconnect is an account sign-in, which a saved key
                    overrides. The row's Connect offers it once the key is removed. Codex's is the
                    ChatGPT sign-in, which replaces the key. A key-only provider, such as Inception,
                    has nothing to reconnect with until a key is saved. */}
                <Show
                  when={
                    props.onReconnect &&
                    provider() !== "antigravity" &&
                    provider() !== "claude" &&
                    provider() !== "codex" &&
                    !(isKeyOnlyProvider(provider()) && stored() === "missing")
                  }
                >
                  <Button type="button" variant="ghost" disabled={busy()} onClick={() => void reconnect()}>
                    {t("provider.action.reconnect")}
                  </Button>
                </Show>
                <Show when={stored() !== "missing"}>
                  <Button
                    type="button"
                    variant="destructive-ghost"
                    loading={phase() === "removing"}
                    loadingLabel={t("common.removing")}
                    disabled={busy()}
                    data-cuelume-tap="close"
                    data-cuelume-emphasis="strong"
                    onClick={() => void remove()}
                  >
                    {t("provider.openCodeKey.remove")}
                  </Button>
                </Show>
                <Button
                  type="submit"
                  variant="default"
                  loading={phase() === "saving"}
                  loadingLabel={t("common.saving")}
                  disabled={busy() || !key().trim()}
                >
                  {t("provider.openCodeKey.save")}
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
