/**
 * Quick dialog to create or edit a dedicated CLIProxy profile on Claude, Codex, or Antigravity.
 *
 * Pre-fills the conventional "<Provider> (CLIProxy)" profile name and local CLIProxy URL so users
 * can add an isolated CLIProxy profile in two clicks without touching their native login. Any API
 * key travels only to the host's encrypted store and is never read back into the renderer.
 */

import {
  CLIPROXY_DEFAULT_BASE_URL,
  type CliProxyProviderId,
  cliProxyDefaultLabel,
  normalizeCliProxyBaseUrl,
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  type SaveCliProxyProfileInput,
} from "@openbot/contracts/ipc";
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
import { createSignal, Show } from "solid-js";
import type { ProviderPickerAccount } from "../../components/provider-accounts";
import { useText } from "../../text";

export interface CliProxyProfileDialogProps {
  provider: CliProxyProviderId;
  providerName: string;
  /** Null creates a new profile; an existing CLIProxy account edits its label, URL, or API key. */
  account: ProviderPickerAccount | null;
  onSave: (input: SaveCliProxyProfileInput) => Promise<void>;
  onClose: () => void;
}

export function CliProxyProfileDialog(props: CliProxyProfileDialogProps) {
  const { t, errorMessage } = useText();
  const isEditing = () => props.account !== null;
  const [label, setLabel] = createSignal(props.account?.label ?? cliProxyDefaultLabel(props.provider));
  const [baseUrl, setBaseUrl] = createSignal(props.account?.proxy?.baseUrl ?? CLIPROXY_DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = createSignal("");
  const [clearKey, setClearKey] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const normalizedUrl = () => normalizeCliProxyBaseUrl(baseUrl());
  const urlInvalid = () => baseUrl().trim().length > 0 && normalizedUrl() === null;
  const canSubmit = () => !saving() && normalizedUrl() !== null;

  async function submit(): Promise<void> {
    const validUrl = normalizedUrl();
    if (saving() || !validUrl) {
      if (!validUrl) setError(t("provider.cliproxy.invalidUrl"));
      return;
    }
    setSaving(true);
    setError(null);
    const trimmedLabel = label().trim().slice(0, PROVIDER_ACCOUNT_LABEL_MAX_LENGTH);
    const trimmedKey = apiKey().trim();
    const keyPayload: string | null | undefined = isEditing()
      ? clearKey()
        ? ""
        : trimmedKey
          ? trimmedKey
          : undefined
      : trimmedKey || undefined;
    try {
      await props.onSave({
        provider: props.provider,
        accountId: props.account?.id ?? null,
        label: trimmedLabel || cliProxyDefaultLabel(props.provider),
        baseUrl: validUrl,
        ...(keyPayload !== undefined ? { apiKey: keyPayload } : {}),
      });
      setApiKey("");
      props.onClose();
    } catch (cause) {
      setError(errorMessage(cause, t("provider.account.actionFailed", { name: props.providerName })));
      setSaving(false);
    }
  }

  return (
    <Dialog.Root
      open={true}
      onOpenChange={(open) => {
        if (!open && !saving()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="opencode-key-backdrop">
          <Dialog.Content class="opencode-key-dialog" as="section">
            <header class="opencode-key-header">
              <Dialog.Title class="opencode-key-title">
                {t(isEditing() ? "provider.cliproxy.editTitle" : "provider.cliproxy.createTitle", {
                  name: props.providerName,
                })}
              </Dialog.Title>
              <Dialog.Description class="opencode-key-description">
                {t("provider.cliproxy.description", { name: props.providerName })}
              </Dialog.Description>
            </header>

            <form
              class="opencode-key-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <Field label={t("provider.cliproxy.nameLabel")}>
                <Input
                  type="text"
                  autocomplete="off"
                  maxlength={PROVIDER_ACCOUNT_LABEL_MAX_LENGTH}
                  placeholder={cliProxyDefaultLabel(props.provider)}
                  value={label()}
                  disabled={saving()}
                  onValueChange={setLabel}
                />
              </Field>

              <Field label={t("provider.cliproxy.urlLabel")}>
                <Input
                  type="url"
                  autocomplete="off"
                  spellcheck={false}
                  placeholder={CLIPROXY_DEFAULT_BASE_URL}
                  value={baseUrl()}
                  disabled={saving()}
                  onValueChange={(value) => {
                    setBaseUrl(value);
                    if (error()) setError(null);
                  }}
                />
              </Field>

              <Field label={t("provider.cliproxy.keyLabel")}>
                <Input
                  type="password"
                  autocomplete="off"
                  spellcheck={false}
                  placeholder={t(
                    isEditing() ? "provider.cliproxy.keyEditPlaceholder" : "provider.cliproxy.keyPlaceholder",
                  )}
                  value={apiKey()}
                  disabled={saving() || clearKey()}
                  onValueChange={(value) => {
                    setApiKey(value);
                    if (value.trim()) setClearKey(false);
                  }}
                />
              </Field>

              <Show when={isEditing()}>
                <div>
                  <Button
                    type="button"
                    variant={clearKey() ? "destructive-ghost" : "ghost"}
                    size="sm"
                    disabled={saving()}
                    aria-pressed={clearKey() ? "true" : "false"}
                    onClick={() => {
                      const next = !clearKey();
                      setClearKey(next);
                      if (next) setApiKey("");
                    }}
                  >
                    {t("provider.cliproxy.clearKey")}
                  </Button>
                </div>
              </Show>

              <Show when={error() ?? (urlInvalid() ? t("provider.cliproxy.invalidUrl") : null)}>
                {(message) => (
                  <Alert class="opencode-key-alert" tone="danger" role="alert">
                    <AlertIcon>
                      <OctagonX />
                    </AlertIcon>
                    <AlertContent>
                      <AlertTitle>{props.providerName}</AlertTitle>
                      <AlertDescription>{message()}</AlertDescription>
                    </AlertContent>
                  </Alert>
                )}
              </Show>

              <footer class="opencode-key-actions">
                <Button type="button" variant="ghost" disabled={saving()} onClick={props.onClose}>
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="default"
                  loading={saving()}
                  loadingLabel={t("provider.cliproxy.saving")}
                  disabled={!canSubmit()}
                >
                  {t(isEditing() ? "provider.cliproxy.save" : "provider.cliproxy.create")}
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
