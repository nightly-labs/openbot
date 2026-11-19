import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  Field,
  Input,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";
import { DangerZone, type IntegrationStatus, UNKNOWN_STATUS } from "./IntegrationLayout";

export interface VaultStatus {
  status: IntegrationStatus;
  label: AppTextKey;
}

export function vaultHeader(statusError: string | null | undefined, status: VaultStatus): VaultStatus {
  return statusError ? UNKNOWN_STATUS : status;
}

export function vaultFailure(title: string, statusError: string | null | undefined, error: string | null) {
  return statusError || !error ? null : { title, message: error };
}

export function VaultDangerZone(props: {
  show: boolean;
  title: string;
  description: string;
  action: string;
  busy: boolean;
  onDisconnect: () => void;
}) {
  return (
    <Show when={props.show}>
      <DangerZone
        title={props.title}
        description={props.description}
        action={props.action}
        busy={props.busy}
        confirm
        onAction={() => props.onDisconnect()}
      />
    </Show>
  );
}

export function VaultSecretForm(props: {
  label: string;
  placeholder?: string | undefined;
  submitLabel: string;
  busy: boolean;
  onSubmit: (secret: string) => void;
  cancelVisible?: boolean | undefined;
  onCancel?: (() => void) | undefined;
}) {
  const { t } = useText();
  const [secret, setSecret] = createSignal("");
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const value = secret().trim();
    if (!value || props.busy) return;
    setSecret("");
    props.onSubmit(value);
  };
  return (
    <form class="vault-secret-form" onSubmit={submit}>
      <Field label={props.label}>
        <Input
          type="password"
          size="sm"
          autocomplete="off"
          spellcheck={false}
          placeholder={props.placeholder}
          value={secret()}
          onInput={(event) => setSecret(event.currentTarget.value)}
        />
      </Field>
      <div class="vault-secret-actions">
        <Button type="submit" size="sm" loading={props.busy} disabled={!secret().trim()}>
          {props.submitLabel}
        </Button>
        <Show when={props.cancelVisible && props.onCancel}>
          {(cancel) => (
            <Button type="button" size="sm" variant="ghost" onClick={() => cancel()()}>
              {t("common.cancel")}
            </Button>
          )}
        </Show>
      </div>
    </form>
  );
}

export function SharedVaultSection(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <SettingsSection title={props.title} description={props.description}>
      <ItemGroup class="settings-modal-card">{props.children}</ItemGroup>
    </SettingsSection>
  );
}

export function VaultRow(props: { title: string; description?: string | undefined }) {
  return (
    <Item class="settings-modal-row">
      <ItemContent>
        <ItemTitle>{props.title}</ItemTitle>
        <Show when={props.description}>{(description) => <ItemDescription>{description()}</ItemDescription>}</Show>
      </ItemContent>
    </Item>
  );
}
