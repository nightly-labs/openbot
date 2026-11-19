import type { VaultItemKind, VaultSaveInput } from "@openbot/contracts/ipc";
import {
  UI_API_KEY_SCOPE_FIELD_ID,
  type UiBlockStatus,
  type UiBlockValue,
  type UiVaultSavedItem,
} from "@openbot/contracts/ui-blocks";
import type { AppTextKey } from "@openbot/i18n";
import { Button, CreditCard, KeyRound, UserRound } from "@openbot/ui";
import { createSignal, Match, onCleanup, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { UiBlockCard } from "../conversation/ui-blocks/UiBlockCard";
import {
  VAULT_BRAND_NAME,
  VaultCardLogo,
  VaultContactLogo,
  VaultRequestDialog,
  type VaultRequestScope,
  VaultSiteLogo,
} from "./VaultPanel";

export interface VaultRequestCardProps {
  kind: VaultItemKind;
  title: string;
  agentName?: string | undefined;
  prefill: Readonly<Record<string, string>>;
  scope?: VaultRequestScope | undefined;
  keyPlaceholder?: string | undefined;
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

export function VaultRequestCard(props: VaultRequestCardProps) {
  const { t } = useText();
  const [dialogOpen, setDialogOpen] = createSignal(false);
  onCleanup(() => props.elementRef?.(undefined));
  const pending = () => props.status === "pending";

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
      inlineActions
      busy={props.busy}
      error={props.error}
      onSkip={props.onSkip}
      actions={
        <Button size="sm" disabled={!props.onSave || props.busy} onClick={() => setDialogOpen(true)}>
          {t(ADD_LABEL[props.kind])}
        </Button>
      }
    >
      <Show when={dialogOpen() && pending() ? props.onSave : undefined}>
        {(save) => (
          <VaultRequestDialog
            kind={props.kind}
            title={props.title}
            prefill={props.prefill}
            scope={props.scope}
            keyPlaceholder={props.keyPlaceholder}
            onSave={(input, scope) => save()(input, scope)}
            onClose={() => setDialogOpen(false)}
          />
        )}
      </Show>
    </UiBlockCard>
  );
}
