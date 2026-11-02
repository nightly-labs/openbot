import type { VaultSaveInput } from "@openbot/contracts/ipc";
import type { UiBlockStatus, UiBlockValue, UiVaultRequestKind, UiVaultSavedItem } from "@openbot/contracts/ui-blocks";
import type { AppTextKey } from "@openbot/i18n";
import { Button, CircleCheck, CreditCard, IconButton, KeyRound, UserRound, X } from "@openbot/ui";
import { createSignal, createUniqueId, Match, onCleanup, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { UiBlockOutcome } from "../conversation/ui-blocks/UiBlockCard";
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
 * The chat card of an agent's request for a Vault item. One row: what the item is for, and a button
 * that opens the Vault dialog with the fields that the agent filled in. The user types the secrets,
 * which go to the Vault and never to the agent. Once saved, the row shows the item.
 */
export function VaultRequestCard(props: VaultRequestCardProps) {
  const { t } = useText();
  const titleId = createUniqueId();
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

  return (
    <article
      ref={(element) => props.elementRef?.(element)}
      class="conversation-interaction-card vault-request"
      data-status={props.status}
      aria-labelledby={titleId}
    >
      <div class="vault-request-row">
        <Show when={props.saved} fallback={<KindTile kind={props.kind} />}>
          {(saved) => <SavedLogo kind={props.kind} saved={saved()} values={props.values} />}
        </Show>
        <div class="vault-request-text">
          <h2 id={titleId} class="vault-request-title">
            {props.saved?.name || props.title}
          </h2>
          <Switch>
            <Match when={pending()}>
              <p class="vault-request-detail">
                {props.agentName
                  ? t("vault.request.private", { agent: props.agentName })
                  : t("vault.request.privateUnnamed")}
              </p>
            </Match>
            <Match when={props.saved}>
              {(saved) => (
                <Show when={savedDetail(saved())}>{(detail) => <p class="vault-request-detail">{detail()}</p>}</Show>
              )}
            </Match>
          </Switch>
        </div>
        <Switch>
          <Match when={pending()}>
            <Button size="sm" disabled={!props.onSave || props.busy} onClick={() => setDialogOpen(true)}>
              {t(ADD_LABEL[props.kind])}
            </Button>
            <Show when={props.onSkip}>
              {(skip) => (
                <IconButton
                  label={t("vault.request.notNow")}
                  variant="ghost"
                  disabled={props.busy}
                  onClick={() => skip()()}
                >
                  <X />
                </IconButton>
              )}
            </Show>
          </Match>
          <Match when={props.status === "answered" && props.saved}>
            <span class="vault-request-done">
              <CircleCheck aria-hidden="true" />
              {t("vault.request.saved")}
            </span>
          </Match>
        </Switch>
      </div>
      <Show when={props.status === "expired" || props.status === "closed"}>
        <UiBlockOutcome status={props.status} />
      </Show>
      <Show when={pending() && props.error}>
        <p class="ui-block-error" role="alert">
          {props.error}
        </p>
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
    </article>
  );
}
