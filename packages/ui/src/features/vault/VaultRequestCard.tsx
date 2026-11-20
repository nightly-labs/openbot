import { VAULT_API_KEY_LIMIT, type VaultItemKind, type VaultSaveInput } from "@openbot/contracts/ipc";
import {
  UI_API_KEY_SCOPE_FIELD_ID,
  type UiBlockStatus,
  type UiBlockValue,
  type UiVaultSavedItem,
} from "@openbot/contracts/ui-blocks";
import type { AppTextKey } from "@openbot/i18n";
import { Button, CreditCard, Field, KeyRound, NativeSelect, UserRound } from "@openbot/ui";
import { createSignal, createUniqueId, For, Match, onCleanup, Show, Switch, untrack } from "solid-js";
import { useText } from "../../text";
import { UiBlockCard } from "../conversation/ui-blocks/UiBlockCard";
import {
  VAULT_BRAND_NAME,
  VaultCardLogo,
  VaultContactLogo,
  VaultRequestDialog,
  type VaultRequestScope,
  VaultSecretInput,
  VaultSiteLogo,
} from "./VaultPanel";

export interface VaultRequestCardProps {
  kind: VaultItemKind;
  title: string;
  agentName?: string | undefined;
  prefill: Readonly<Record<string, string>>;
  scope?: VaultRequestScope | undefined;
  keyPlaceholder?: string | undefined;
  submitLabel?: string | undefined;
  status: UiBlockStatus;
  saved?: UiVaultSavedItem | undefined;
  closedOutcome?: string | undefined;
  values?: Readonly<Record<string, UiBlockValue>> | undefined;
  error?: string | undefined;
  busy?: boolean | undefined;
  onSave?: ((input: VaultSaveInput, scope?: string) => Promise<void>) | undefined;
  onSkip?: (() => void) | undefined;
  elementRef?: ((element: HTMLElement | undefined) => void) | undefined;
}

const ADD_LABEL = {
  login: "vault.request.addLogin",
  card: "vault.request.addCard",
  contact: "vault.request.addContact",
  apiKey: "vault.request.addApiKey",
} as const satisfies Record<VaultItemKind, AppTextKey>;

const text = (values: Readonly<Record<string, UiBlockValue>> | undefined, key: string) => {
  const value = values?.[key];
  return typeof value === "string" ? value.trim() : "";
};

function KindTile(props: { kind: VaultItemKind }) {
  return (
    <span class="vault-logo integration-logo-tile" aria-hidden="true">
      <Switch>
        <Match when={props.kind === "card"}>
          <CreditCard />
        </Match>
        <Match when={props.kind === "contact"}>
          <UserRound />
        </Match>
        <Match when={props.kind === "login" || props.kind === "apiKey"}>
          <KeyRound />
        </Match>
      </Switch>
    </span>
  );
}

function SavedLogo(props: { kind: VaultItemKind; saved: UiVaultSavedItem; values: VaultRequestCardProps["values"] }) {
  return (
    <Switch>
      <Match when={props.kind === "card"}>
        <VaultCardLogo brand={props.saved.brand ?? null} />
      </Match>
      <Match when={props.kind === "contact"}>
        <VaultContactLogo name={text(props.values, "fullName") || props.saved.name} />
      </Match>
      <Match when={props.kind === "login"}>
        <VaultSiteLogo website={text(props.values, "website") || props.saved.name} />
      </Match>
      <Match when={props.kind === "apiKey"}>
        <KindTile kind="apiKey" />
      </Match>
    </Switch>
  );
}

function ApiKeyRequestForm(props: {
  formId: string;
  name: string;
  placeholder?: string | undefined;
  scope?: VaultRequestScope | undefined;
  apiKey: string;
  scopeChoice: string;
  onKeyChange: (key: string) => void;
  onScopeChange: (scope: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      id={props.formId}
      class="ui-block-form-fields"
      novalidate
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <Field label={props.name}>
        <VaultSecretInput
          field="key"
          saved={false}
          value={props.apiKey}
          maxlength={VAULT_API_KEY_LIMIT}
          placeholder={props.placeholder}
          onChange={props.onKeyChange}
          onReveal={() => Promise.resolve("")}
          onRevealFailed={() => undefined}
        />
      </Field>
      <Show when={props.scope}>
        {(choice) => (
          <Field label={choice().label}>
            <NativeSelect
              value={props.scopeChoice}
              onChange={(event) => props.onScopeChange(event.currentTarget.value)}
            >
              <For each={choice().options}>{(option) => <option value={option}>{option}</option>}</For>
            </NativeSelect>
          </Field>
        )}
      </Show>
    </form>
  );
}

export function VaultRequestCard(props: VaultRequestCardProps) {
  const { t, errorMessage } = useText();
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const formId = createUniqueId();
  const [apiKey, setApiKey] = createSignal("");
  const [scopeChoice, setScopeChoice] = createSignal(untrack(() => props.scope?.value ?? ""));
  const [saveFailure, setSaveFailure] = createSignal<string>();
  onCleanup(() => props.elementRef?.(undefined));
  const pending = () => props.status === "pending";
  const keyForm = () => props.kind === "apiKey" && pending();

  async function saveApiKey(): Promise<void> {
    const save = props.onSave;
    if (!save || props.busy || apiKey().trim() === "") return;
    setSaveFailure(undefined);
    try {
      await save(
        { kind: "apiKey", id: null, name: props.prefill.name ?? "", notes: "", key: apiKey() },
        props.scope ? scopeChoice() : undefined,
      );
      setApiKey("");
    } catch (cause) {
      setSaveFailure(errorMessage(cause, t("vault.failed")));
    }
  }

  const saved = () => props.status === "answered" && (props.saved !== undefined || props.kind === "apiKey");

  const savedDetail = (saved: UiVaultSavedItem | undefined) => {
    switch (props.kind) {
      case "apiKey":
        return [props.prefill.name, text(props.values, UI_API_KEY_SCOPE_FIELD_ID)].filter(Boolean).join(" · ");
      case "card": {
        if (!saved) return "";
        const masked =
          saved.last4 === undefined
            ? ""
            : t("vault.maskedCard", {
                brand: saved.brand ? VAULT_BRAND_NAME[saved.brand] : t("vault.kind.card"),
                last4: saved.last4,
              });
        return [masked, text(props.values, "expiry")].filter(Boolean).join(" · ");
      }
      case "login":
        return text(props.values, "username") || text(props.values, "website");
      case "contact":
        return (
          [text(props.values, "address"), text(props.values, "city"), text(props.values, "postalCode")]
            .filter(Boolean)
            .join(", ") ||
          text(props.values, "email") ||
          text(props.values, "phone")
        );
    }
  };

  const subtitle = () => {
    if (pending() && props.kind === "apiKey") return t("vault.request.apiKeyPrivate");
    if (pending())
      return props.agentName
        ? t("vault.request.private", { agent: props.agentName })
        : t("vault.request.privateUnnamed");
    return saved() ? savedDetail(props.saved) || undefined : undefined;
  };

  return (
    <UiBlockCard
      elementRef={(element) => props.elementRef?.(element)}
      class="vault-request"
      status={props.status}
      title={props.saved?.name || props.title}
      subtitle={subtitle()}
      icon={
        <span class="ui-block-icon vault-request-logo" aria-hidden="true">
          <Show when={props.saved} fallback={<KindTile kind={props.kind} />}>
            {(saved) => <SavedLogo kind={props.kind} saved={saved()} values={props.values} />}
          </Show>
        </span>
      }
      outcome={saved() ? t("vault.request.saved") : props.status === "closed" ? props.closedOutcome : undefined}
      outcomeBadge
      inlineActions={!keyForm()}
      busy={props.busy}
      error={props.error ?? saveFailure()}
      onSkip={props.onSkip}
      actions={
        <Show
          when={props.kind === "apiKey"}
          fallback={
            <Button size="sm" disabled={!props.onSave || props.busy} onClick={() => setDialogOpen(true)}>
              {t(ADD_LABEL[props.kind])}
            </Button>
          }
        >
          <Button
            type="submit"
            size="sm"
            form={formId}
            disabled={!props.onSave || props.busy || apiKey().trim() === ""}
          >
            {props.submitLabel ?? t("common.save")}
          </Button>
        </Show>
      }
    >
      <Show when={keyForm()}>
        <ApiKeyRequestForm
          formId={formId}
          name={props.prefill.name ?? ""}
          placeholder={props.keyPlaceholder}
          scope={props.scope}
          apiKey={apiKey()}
          scopeChoice={scopeChoice()}
          onKeyChange={setApiKey}
          onScopeChange={setScopeChoice}
          onSubmit={() => void saveApiKey()}
        />
      </Show>
      <Show when={dialogOpen() && pending() ? props.onSave : undefined}>
        {(save) => (
          <VaultRequestDialog
            kind={props.kind}
            title={props.title}
            prefill={props.prefill}
            onSave={(input) => save()(input)}
            onClose={() => setDialogOpen(false)}
          />
        )}
      </Show>
    </UiBlockCard>
  );
}
