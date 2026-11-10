/**
 * The parts of the NEAR Intents wallet: the logo, the site icon, the dialog frame of the Vault, the
 * sign-in choice, the agent list, the risk notice, the deposit address and the signature wait.
 */

import type { NearDepositAddress, NearDepositAsset, NearOwnerMethod, NearWalletStatus } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertContent,
  AlertDescription,
  Badge,
  Button,
  Checkbox,
  CopyButton,
  Dialog,
  Field,
  IconButton,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  NativeSelect,
  QrCode,
  RadioGroup,
  Search,
  Spinner,
  Switch,
  Text,
  X,
} from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, createStore, createUniqueId, For, onCleanup, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { type TextValue, useText } from "../../text";

/** An agent that can be allowed to pay: what the dock shows of it. */
export type NearWalletAgent = Pick<
  AgentProfile,
  "id" | "name" | "title" | "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl"
>;

/**
 * The wallet operations. Each owner action gives the status after it ends; a failure is in its
 * `error`, not thrown. Only `deposit` rejects.
 */
export interface NearWalletActions {
  setKey: (key: string) => Promise<NearWalletStatus>;
  create: (input: {
    ownerMethod: NearOwnerMethod;
    dailyBudgetUsd: string;
    agentIds: string[];
  }) => Promise<NearWalletStatus>;
  setBudget: (dailyBudgetUsd: string) => Promise<NearWalletStatus>;
  setAgents: (agentIds: string[]) => Promise<NearWalletStatus>;
  renewGrant: () => Promise<NearWalletStatus>;
  freeze: () => Promise<NearWalletStatus>;
  unfreeze: () => Promise<NearWalletStatus>;
  deposit: (assetId: string) => Promise<NearDepositAddress>;
  saveRule: (input: { domain: string; recipients: string[]; dailyUsd: number }) => Promise<NearWalletStatus>;
  removeRule: (domain: string) => Promise<NearWalletStatus>;
  /** Lets agents pay the domain of a payment that waits, up to `dailyUsd` a day. */
  allowPayment: (input: { requestId: string; dailyUsd: number }) => Promise<NearWalletStatus>;
  openSigning: () => Promise<void>;
  cancelSigning: () => Promise<NearWalletStatus>;
  disconnect: () => Promise<NearWalletStatus>;
}

/** The NEAR Intents mark. It is artwork, so it has no text. */
export function NearIntentsLogo() {
  return (
    <span class="vault-logo vault-card-logo near-wallet-logo" aria-hidden="true">
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path
          d="M17.6 3.6 14 9a.4.4 0 0 0 .6.5l3.6-3.1c.1-.1.3 0 .3.1v10c0 .2-.2.2-.3.1L7.4 3.6A1.9 1.9 0 0 0 6 3h-.4A1.9 1.9 0 0 0 3.7 4.9v14.2A1.9 1.9 0 0 0 5.6 21a1.9 1.9 0 0 0 1.6-.9L10.8 15a.4.4 0 0 0-.6-.5l-3.6 3.1c-.1.1-.3 0-.3-.1v-10c0-.2.2-.2.3-.1l10.8 13a1.9 1.9 0 0 0 1.4.6h.4a1.9 1.9 0 0 0 1.9-1.9V4.9A1.9 1.9 0 0 0 19.2 3a1.9 1.9 0 0 0-1.6.6Z"
          fill="#111"
        />
      </svg>
    </span>
  );
}

/** The site of a service domain: "api.exa.ai" is on "exa.ai". */
const siteOf = (domain: string) => domain.split(".").slice(-2).join(".");

/**
 * The icon of the site: the favicon of its site (an API host often has none), then its own favicon,
 * then the letter tile of the Vault. The request goes to the site that the agent pays, with no referrer.
 */
export function SiteIcon(props: { domain: string; class?: string | undefined }) {
  const sources = () => [...new Set([siteOf(props.domain), props.domain])].map((host) => `https://${host}/favicon.ico`);
  const [failed, setFailed] = createSignal<readonly string[]>([]);
  const source = () => sources().find((url) => !failed().includes(url));
  const letter = () => <span class="vault-letter">{siteOf(props.domain).charAt(0).toUpperCase()}</span>;
  return (
    <span class={`vault-logo integration-logo-tile near-site-icon ${props.class ?? ""}`} aria-hidden="true">
      <Show when={source()} keyed fallback={letter()}>
        {(url) => (
          <img
            src={url}
            alt=""
            decoding="async"
            referrerpolicy="no-referrer"
            onError={() => setFailed((list) => [...list, url])}
          />
        )}
      </Show>
    </span>
  );
}

/** The frame of the Vault item dialog: the logo, the title and a close button, a body and actions. */
export function NearWalletDialog(props: {
  title: string;
  busy?: boolean | undefined;
  /** The dialog opens on its search field, not on Close. */
  focusSearch?: boolean | undefined;
  onClose: () => void;
  onSubmit?: (() => void) | undefined;
  children: JSX.Element;
  actions: JSX.Element;
}) {
  const { t } = useText();
  let content: HTMLElement | undefined;
  return (
    <Dialog.Root open={true} onOpenChange={(open) => !open && !props.busy && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay class="ui-confirm-dialog-overlay">
          <Dialog.Content
            as="section"
            class="ui-confirm-dialog vault-dialog near-wallet-dialog"
            ref={(element) => {
              content = element;
            }}
            onOpenAutoFocus={(event) => {
              const search = props.focusSearch ? content?.querySelector<HTMLElement>("input[type=search]") : null;
              if (!search) return;
              event.preventDefault();
              search.focus({ preventScroll: true });
            }}
          >
            <form
              class="vault-dialog-form"
              onSubmit={(event) => {
                event.preventDefault();
                props.onSubmit?.();
              }}
            >
              <header class="vault-dialog-header">
                <NearIntentsLogo />
                <Dialog.Title as="h2" class="vault-dialog-title">
                  {props.title}
                </Dialog.Title>
                <IconButton label={t("common.close")} variant="ghost" disabled={props.busy} onClick={props.onClose}>
                  <X />
                </IconButton>
              </header>
              <div class="vault-dialog-body">{props.children}</div>
              <footer class="ui-confirm-dialog-actions">{props.actions}</footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** While the owner signs in the browser: open the signing page again, or stop waiting. */
export function NearSigningWait(props: { onOpenAgain: () => Promise<void>; onCancel: () => Promise<unknown> }) {
  const { t } = useText();
  return (
    <div class="near-wallet-waiting" role="status">
      <Spinner />
      <Text tone="muted">{t("vault.near.waiting")}</Text>
      <div class="near-wallet-waiting-actions">
        <Button type="button" size="sm" variant="outline" onClick={() => void props.onOpenAgain()}>
          {t("vault.near.openAgain")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => void props.onCancel()}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Runs one wallet action: busy while it runs, then its failure as a sentence. An owner action gives
 * the status, and its `error` is the failure.
 */
export function createNearRun() {
  const { t, errorMessage, sourceText } = useText();
  const [ui, setUi] = createStore<{ busy: boolean; failure: string | null }>({ busy: false, failure: null });
  async function run(action: () => Promise<NearWalletStatus | undefined>): Promise<boolean> {
    if (ui.busy) return false;
    setUi((draft) => {
      draft.busy = true;
      draft.failure = null;
    });
    try {
      const status = await action();
      const error = status ? status.error : null;
      setUi((draft) => {
        draft.failure = error ? sourceText(error) : null;
      });
      return error === null;
    } catch (error) {
      setUi((draft) => {
        draft.failure = errorMessage(error, t("vault.near.failed"));
      });
      return false;
    } finally {
      setUi((draft) => {
        draft.busy = false;
      });
    }
  }
  return {
    busy: () => ui.busy,
    failure: () => ui.failure,
    clear: () =>
      setUi((draft) => {
        draft.failure = null;
      }),
    run,
  };
}

/** A failure in a dialog, in the danger colour of the Vault. */
export function NearFailure(props: { text: string | null }) {
  return (
    <Show when={props.text}>
      {(text) => (
        <Text as="p" variant="body-sm" class="vault-link-error" role="alert">
          {text()}
        </Text>
      )}
    </Show>
  );
}

/** How the owner signs: radio cards with the recommended passkey first. */
export function OwnerMethodChoice(props: { value: NearOwnerMethod; onChange: (value: NearOwnerMethod) => void }) {
  const { t } = useText();
  const methods = [
    { value: "passkey", name: "vault.near.method.passkey", detail: "vault.near.method.passkeyDetail" },
    { value: "evm", name: "vault.near.method.evm", detail: "vault.near.method.evmDetail" },
  ] as const;
  return (
    <RadioGroup.Root
      class="settings-mobile-route-choice"
      aria-label={t("vault.near.signWith")}
      value={props.value}
      onChange={(value) => {
        const method = methods.find((item) => item.value === value);
        if (method) props.onChange(method.value);
      }}
    >
      <For each={methods}>
        {(method) => (
          <RadioGroup.Item class="settings-mobile-route-option" value={method.value}>
            <RadioGroup.ItemInput />
            <RadioGroup.ItemControl class="settings-mobile-route-card">
              <span class="settings-mobile-route-dot" aria-hidden="true" />
              <span class="settings-mobile-route-text">
                <RadioGroup.ItemLabel class="settings-mobile-route-name">
                  {t(method.name)}
                  <Show when={method.value === "passkey"}>
                    <Badge variant="info-light">{t("vault.near.recommended")}</Badge>
                  </Show>
                </RadioGroup.ItemLabel>
                <RadioGroup.ItemDescription class="settings-mobile-route-hint">
                  {t(method.detail)}
                </RadioGroup.ItemDescription>
              </span>
            </RadioGroup.ItemControl>
          </RadioGroup.Item>
        )}
      </For>
    </RadioGroup.Root>
  );
}

const matches = (query: string, text: string) => text.toLowerCase().includes(query.trim().toLowerCase());

/**
 * The agents as the dock has them: the search field of the dock "Add agent" menu, then one row for
 * each agent with its avatar, name, role and a switch, as Settings → Agent dock lists them.
 */
export function AgentPicker(props: {
  agents: readonly NearWalletAgent[];
  label: string;
  checked: (agentId: string) => boolean;
  set: (agentIds: readonly string[], on: boolean) => void;
}) {
  const { t } = useText();
  const [search, setSearch] = createSignal("");
  const id = `near-agent-picker-${createUniqueId()}`;
  const shown = () => props.agents.filter((agent) => matches(search(), `${agent.name} ${agent.title ?? ""}`));
  const shownIds = () => shown().map((agent) => agent.id);
  const allOn = () => shown().length > 0 && shown().every((agent) => props.checked(agent.id));
  const allLabel = () =>
    search().trim()
      ? t("vault.near.allMatches", { count: shown().length })
      : t("vault.near.allAgents", { count: props.agents.length });
  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  const none = () => (
    <Text as="p" variant="body-sm" tone="muted" class="near-wallet-picker-none">
      {t("vault.near.noAgentMatch", { query: search().trim() })}
    </Text>
  );
  return (
    <ItemGroup class="settings-modal-card near-wallet-picker" role="group" aria-label={props.label}>
      <div class="ui-search-select-search near-wallet-picker-search">
        <Search aria-hidden="true" />
        <Input
          type="search"
          class="ui-search-select-input near-wallet-picker-input"
          aria-label={t("vault.near.searchAgents")}
          placeholder={t("vault.near.searchAgents")}
          autocomplete="off"
          spellcheck={false}
          value={search()}
          onInput={(event) => {
            setSearch(event.currentTarget.value);
            fades.remeasure();
          }}
        />
      </div>
      <Show when={shown().length > 0} fallback={none()}>
        <div
          class={["near-wallet-picker-list", fades.classes()]}
          ref={(element) => fades.bind(element)}
          onScroll={fades.measure}
        >
          <Item class="near-wallet-picker-all">
            <ItemContent>
              <ItemTitle id={`${id}-all`}>{allLabel()}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <Switch checked={allOn()} onChange={(on) => props.set(shownIds(), on)} aria-labelledby={`${id}-all`} />
            </ItemActions>
          </Item>
          <For each={shown()} keyed={(agent) => agent.id}>
            {(agent) => (
              <Item>
                <ItemMedia class="settings-agent-dock-avatar" aria-hidden="true">
                  <AgentAvatar agent={agent()} motion="idle" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle id={`${id}-${agent().id}`}>{agent().name}</ItemTitle>
                  <Show when={agent().title}>{(title) => <ItemDescription>{title()}</ItemDescription>}</Show>
                </ItemContent>
                <ItemActions>
                  <Switch
                    checked={props.checked(agent().id)}
                    onChange={(on) => props.set([agent().id], on)}
                    aria-labelledby={`${id}-${agent().id}`}
                  />
                </ItemActions>
              </Item>
            )}
          </For>
        </div>
      </Show>
    </ItemGroup>
  );
}

/** Small avatars of the first agents, one over the next, as the Marketplace "On 12 of 50" button has. */
export function AgentStack(props: { agents: readonly NearWalletAgent[]; ids: readonly string[] }) {
  const shown = () => props.agents.filter((agent) => props.ids.includes(agent.id)).slice(0, 3);
  return (
    <span class="marketplace-skill-stack" aria-hidden="true">
      <For each={shown()} keyed={(agent) => agent.id}>
        {(agent) => (
          <span class="marketplace-avatar" data-size="xs">
            <AgentAvatar agent={agent()} motion="idle" />
          </span>
        )}
      </For>
    </span>
  );
}

/** The required risk notice and the owner's acceptance. */
export function RiskAccept(props: { accepted: boolean; onChange: (accepted: boolean) => void }) {
  const { t } = useText();
  const id = `near-wallet-accept-${createUniqueId()}`;
  return (
    <Alert tone="warning" report={false} class="near-wallet-risk">
      <AlertContent>
        <AlertDescription>{t("vault.near.risk")}</AlertDescription>
        <div class="near-wallet-accept">
          <Checkbox
            id={id}
            checked={props.accepted}
            onChange={(event) => props.onChange(event.currentTarget.checked)}
          />
          <label for={id}>{t("vault.near.accept")}</label>
          <a href="https://docs.agentsonintents.com" target="_blank" rel="noreferrer">
            {t("vault.near.terms")}
          </a>
        </div>
      </AlertContent>
    </Alert>
  );
}

/** The chain of a deposit asset, as the Agent API names it: "near", "eth", "base". */
export const chainName = (blockchain: string) => blockchain.toUpperCase();

/** One asset as a choice: "USDC on NEAR". */
export function assetLabel(t: TextValue["t"], asset: NearDepositAsset) {
  return t("vault.near.assetOn", { symbol: asset.symbol, chain: chainName(asset.blockchain) });
}

/** An asset, its deposit address as a QR code and as text, its memo and the smallest deposit. */
export function AddFundsFields(props: {
  assets: readonly NearDepositAsset[];
  deposit: (assetId: string) => Promise<NearDepositAddress>;
}) {
  const { t, errorMessage } = useText();
  const [assetId, setAssetId] = createSignal(props.assets[0]?.assetId ?? "");
  const [address, setAddress] = createSignal<NearDepositAddress | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const asset = () => props.assets.find((item) => item.assetId === assetId()) ?? props.assets[0];
  createEffect(
    () => asset()?.assetId,
    (id) => {
      if (!id) return;
      let live = true;
      setAddress(null);
      setFailure(null);
      props.deposit(id).then(
        (result) => {
          if (live) setAddress(result);
        },
        (error: unknown) => {
          if (live) setFailure(errorMessage(error, t("vault.near.failed")));
        },
      );
      return () => {
        live = false;
      };
    },
  );
  const loading = () => (
    <Show when={!failure()}>
      <div class="near-wallet-waiting" role="status">
        <Spinner />
      </div>
    </Show>
  );
  return (
    <Show when={asset()}>
      {(current) => (
        <div class="near-wallet-funds">
          <Field label={t("vault.near.asset")}>
            <NativeSelect value={current().assetId} onChange={(event) => setAssetId(event.currentTarget.value)}>
              <For each={props.assets}>{(item) => <option value={item.assetId}>{assetLabel(t, item)}</option>}</For>
            </NativeSelect>
          </Field>
          <NearFailure text={failure()} />
          <Show when={address()} fallback={loading()}>
            {(deposit) => (
              <>
                <div class="near-wallet-qr">
                  <QrCode
                    value={deposit().address}
                    size={168}
                    label={t("vault.near.depositQr", { symbol: current().symbol })}
                  />
                </div>
                <Field
                  label={t("vault.near.addressOn", {
                    symbol: current().symbol,
                    chain: chainName(current().blockchain),
                  })}
                >
                  <div class="near-wallet-address">
                    <Input readonly class="near-wallet-address-input" value={deposit().address} />
                    <CopyButton value={deposit().address} iconOnly variant="outline" />
                  </div>
                </Field>
                <Show when={deposit().memo}>
                  {(memo) => (
                    <Field label={t("vault.near.memo")}>
                      <div class="near-wallet-address">
                        <Input readonly class="near-wallet-address-input" value={memo()} />
                        <CopyButton value={memo()} iconOnly variant="outline" />
                      </div>
                    </Field>
                  )}
                </Show>
                <Text variant="caption" tone="muted">
                  <Show when={deposit().minAmount}>
                    {(amount) => <>{t("vault.near.minimum", { amount: amount(), symbol: current().symbol })} </>}
                  </Show>
                  {t("vault.near.onlyAsset", { symbol: current().symbol, chain: chainName(current().blockchain) })}
                </Text>
              </>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}

/** "Chief", "Chief and Research", "Chief, Research, and 3 more" are left to `format.list`. */
export function agentNames(format: TextValue["format"], agents: readonly NearWalletAgent[], ids: readonly string[]) {
  return format.list(ids.map((id) => agents.find((agent) => agent.id === id)?.name ?? id));
}

/** A USD amount that the Agent API gives as decimal text. */
export const usdNumber = (text: string | null | undefined) => {
  const value = Number(text ?? 0);
  return Number.isFinite(value) ? value : 0;
};
