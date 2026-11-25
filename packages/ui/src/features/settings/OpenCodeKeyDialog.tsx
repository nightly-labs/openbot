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
import { createSignal, onCleanup, onSettled, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { ScrollEdgeBlur } from "../../components/ScrollEdgeBlur";
import { useText } from "../../text";

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
    descriptionHost: "provider.geminiKey.descriptionHost",
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
    descriptionHost: "provider.codexKey.descriptionHost",
    label: "provider.codexKey.label",
  },
  inception: {
    name: "Inception",
    title: "provider.inceptionKey.title",
    description: "provider.inceptionKey.description",
    descriptionHost: "provider.inceptionKey.descriptionHost",
    label: "provider.inceptionKey.label",
  },
  deepseek: {
    name: "DeepSeek",
    title: "provider.deepseekKey.title",
    description: "provider.deepseekKey.description",
    descriptionHost: "provider.deepseekKey.descriptionHost",
    label: "provider.deepseekKey.label",
  },
  openrouter: {
    name: "OpenRouter",
    title: "provider.openrouterKey.title",
    description: "provider.openrouterKey.description",
    descriptionHost: "provider.openrouterKey.descriptionHost",
    label: "provider.openrouterKey.label",
  },
} as const satisfies Record<string, KeyDialogText>;

export interface KeyDialogText {
  name: string;
  title: AppTextKey;
  description: AppTextKey;
  descriptionHost?: AppTextKey;
  label: AppTextKey;
}

export type KeyDialogProvider = keyof typeof KEY_TEXT;

export function isKeyDialogProvider(provider: AgentProviderId): provider is KeyDialogProvider {
  return Object.hasOwn(KEY_TEXT, provider);
}

export interface ProviderKeyApi {
  readsClaudeKey?: boolean | undefined;
  readsCodexKey?: boolean | undefined;
  onHost?: boolean | undefined;
  getProviderApiKeyState: (provider: AgentProviderId) => Promise<ProviderApiKeyState>;
  setProviderApiKey: (input: { provider: AgentProviderId; key: string }) => Promise<unknown>;
  clearProviderApiKey: (provider: AgentProviderId) => Promise<unknown>;
  openExternal: (destination: ExternalDestination) => Promise<void>;
}

export interface OpenCodeKeyDialogProps {
  api: ProviderKeyApi;
  provider?: KeyDialogProvider;
  text?: KeyDialogText | undefined;
  onClose: () => void;
  onReconnect?: (() => void | Promise<void>) | undefined;
}

type DialogPhase = "idle" | "loading" | "saving" | "removing";

export function OpenCodeKeyDialog(props: OpenCodeKeyDialogProps) {
  const { t, errorMessage } = useText();
  const provider = () => props.provider ?? "opencode";
  const text = (): KeyDialogText => props.text ?? KEY_TEXT[provider()];
  const description = (): AppTextKey => {
    const entry = text();
    return (props.api.onHost ? entry.descriptionHost : undefined) ?? entry.description;
  };
  const [key, setKey] = createSignal("");
  const [stored, setStored] = createSignal<ProviderApiKeyStatus>("missing");
  const [phase, setPhase] = createSignal<DialogPhase>("loading");
  const [error, setError] = createSignal<string | null>(null);
  const busy = () => phase() !== "idle";

  onSettled(() => {
    void readState();
  });
  const fades = createScrollFades();
  onCleanup(() => fades.stop());

  async function readState(): Promise<void> {
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
          <Dialog.Content
            class={["opencode-key-dialog", fades.classes()]}
            as="section"
            ref={(element: HTMLElement) => fades.bind(element)}
            onScroll={fades.measure}
          >
            <header class="opencode-key-header">
              <Dialog.Title class="opencode-key-title">{t(text().title)}</Dialog.Title>
              <Dialog.Description class="opencode-key-description">
                <Show
                  when={stored() === "saved"}
                  fallback={
                    <Show when={stored() === "unreadable"} fallback={t(description())}>
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
              ref={(element) => fades.watch(element)}
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
          <ScrollEdgeBlur fades={fades} />
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
