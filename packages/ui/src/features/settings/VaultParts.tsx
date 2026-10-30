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

/*
 * The parts that the password vault pages (1Password, Bitwarden) share. Their setup is different, but
 * the status, the failure, the secret form, the shared vault and Disconnect look the same on both.
 */

/** One state of a vault connection, as its page header and every list of connectors show it. */
export interface VaultStatus {
  status: IntegrationStatus;
  label: AppTextKey;
}

/** The header status: not known after a failed read, else the entry of the vault's status table. */
export function vaultHeader(statusError: string | null | undefined, status: VaultStatus): VaultStatus {
  return statusError ? UNKNOWN_STATUS : status;
}

/** The last action that failed. With the state not known, the read error shows instead. */
export function vaultFailure(title: string, statusError: string | null | undefined, error: string | null) {
  return statusError || !error ? null : { title, message: error };
}

/** Disconnect, after a confirmation, while the vault is connected and its state is known. */
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

/**
 * One secret, such as a token or a session key, with its label and the button that sends it. The field
 * clears when the secret is sent, so the page keeps no copy. The form sends nothing while `busy`.
 */
export function VaultSecretForm(props: {
  label: string;
  placeholder?: string | undefined;
  submitLabel: string;
  busy: boolean;
  onSubmit: (secret: string) => void;
  /** Shows Cancel next to the submit button while true. */
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

/** The vaults or folders that OpenBot reads, as one card of `VaultRow`s and notes. */
export function SharedVaultSection(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <SettingsSection title={props.title} description={props.description}>
      <ItemGroup class="settings-modal-card">{props.children}</ItemGroup>
    </SettingsSection>
  );
}

/** One vault, folder or server: its name, and what is known about it. */
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
