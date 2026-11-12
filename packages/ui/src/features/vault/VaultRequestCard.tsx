import type { VaultSaveInput } from "@openbot/contracts/ipc";
import type { UiBlockStatus, UiBlockValue, UiVaultRequestKind, UiVaultSavedItem } from "@openbot/contracts/ui-blocks";
import type { AppTextKey } from "@openbot/i18n";
import { Button, CreditCard, KeyRound, UserRound } from "@openbot/ui";
import { createSignal, Match, onCleanup, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { UiBlockCard } from "../conversation/ui-blocks/UiBlockCard";
import { VAULT_BRAND_NAME, VaultCardLogo, VaultContactLogo, VaultRequestDialog, VaultSiteLogo } from "./VaultPanel";

export interface VaultRequestCardProps {
  kind: UiVaultRequestKind;
  /** What the agent asks for, in its own words. */
  title: string;
  /** The agent that asks. Absent when the app does not know it. */
  agentName?: string | undefined;
  /** The fields that the agent filled in. A secret field is never one of them. */
  prefill: Readonly<Record<string, string>>;
  status: UiBlockStatus;
  /** The item that the user saved. */
  saved?: UiVaultSavedItem | undefined;
  /** The values of the saved item that are not secret, for its summary line. */
  values?: Readonly<Record<string, UiBlockValue>> | undefined;
  /** Why the last answer failed, such as a skip that did not go through. */
  error?: string | undefined;
  /** The answer is on its way. */
  busy?: boolean | undefined;
  /** Saves the item. A failure stays in the dialog, so the user can correct a value. Absent in the history. */
  onSave?: ((input: VaultSaveInput) => Promise<void>) | undefined;
  /** Closes the request with nothing saved. */
  onSkip?: (() => void) | undefined;
  elementRef?: ((element: HTMLElement | undefined) => void) | undefined;
}

const ADD_LABEL = {
  login: "vault.request.addLogin",
  card: "vault.request.addCard",
  contact: "vault.request.addContact",
} as const satisfies Record<UiVaultRequestKind, AppTextKey>;

const text = (values: Readonly<Record<string, UiBlockValue>> | undefined, key: string) => {
  const value = values?.[key];
  return typeof value === "string" ? value.trim() : "";
};

function KindTile(props: { kind: UiVaultRequestKind }) {
  return (
    <span class="vault-logo integration-logo-tile" aria-hidden="true">
      <Switch>
        <Match when={props.kind === "card"}>
          <CreditCard />
        </Match>
        <Match when={props.kind === "contact"}>
          <UserRound />
        </Match>
        <Match when={props.kind === "login"}>
          <KeyRound />
        </Match>
      </Switch>
    </span>
  );
}

function SavedLogo(props: {
  kind: UiVaultRequestKind;
  saved: UiVaultSavedItem;
  values: VaultRequestCardProps["values"];
}) {
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
    </Switch>
  );
}

/**
 * The chat card of an agent's request for a Vault item: what the item is for, and a button that
 * opens the Vault dialog with the fields that the agent filled in. The user types the secrets,
 * which go to the Vault and never to the agent. Once saved, the card shows the item.
 */
export function VaultRequestCard(props: VaultRequestCardProps) {
  const { t } = useText();
  const [dialogOpen, setDialogOpen] = createSignal(false);
  onCleanup(() => props.elementRef?.(undefined));
  const pending = () => props.status === "pending";

  const savedDetail = (saved: UiVaultSavedItem) => {
    switch (props.kind) {
      case "card": {
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
    if (pending())
      return props.agentName
        ? t("vault.request.private", { agent: props.agentName })
        : t("vault.request.privateUnnamed");
    return props.saved ? savedDetail(props.saved) || undefined : undefined;
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
      outcome={props.status === "answered" && props.saved ? t("vault.request.saved") : undefined}
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
            onSave={(input) => save()(input)}
            onClose={() => setDialogOpen(false)}
          />
        )}
      </Show>
    </UiBlockCard>
  );
}
