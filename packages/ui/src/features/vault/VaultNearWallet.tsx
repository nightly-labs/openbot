/**
 * The NEAR Intents wallet of this computer in the Vault: one row in the Crypto tab, and a page with
 * the balance, the daily budget, the domains that agents pay without asking, the agents that can pay,
 * and Pause and Disconnect. Agents pay; the owner signs each policy change in the browser.
 */

import type { NearPayRule, NearWalletStatus } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  buttonVariants,
  ChevronRight,
  ConfirmDialog,
  DropdownMenu,
  Ellipsis,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Pencil,
  Plus,
  Progress,
  SettingsSection,
  Spinner,
  Text,
  Trash2,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, createUniqueId, For, Show } from "solid-js";
import { useText } from "../../text";
import {
  NearAddFundsDialog,
  NearAgentsDialog,
  NearBudgetDialog,
  NearDomainDialog,
  NearSetupDialog,
} from "./near-wallet-dialogs";
import {
  AgentStack,
  agentNames,
  chainName,
  createNearRun,
  NearIntentsLogo,
  type NearWalletActions,
  type NearWalletAgent,
  SiteIcon,
  usdNumber,
} from "./near-wallet-parts";

export { NearSetupDialog } from "./near-wallet-dialogs";
export type { NearWalletActions, NearWalletAgent } from "./near-wallet-parts";

export interface VaultNearWalletProps {
  status: NearWalletStatus;
  /** The agents of this computer. */
  agents: readonly NearWalletAgent[];
  actions: NearWalletActions;
}

/** Agents can pay, or could before a pause: the wallet has a page. */
export const nearWalletConnected = (status: NearWalletStatus) => status.state === "ready" || status.state === "frozen";

/** The USD value of every asset that has a price. */
const totalUsd = (status: NearWalletStatus) =>
  status.balances.reduce((sum, balance) => sum + (balance.usd === null ? 0 : usdNumber(balance.usd)), 0);

/** A grant that ends in this time gets a Renew button. */
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60_000;

/** True once `iso` is in the past. It changes when that time comes. */
function createPassed(iso: () => string | null) {
  const [passed, setPassed] = createSignal(true);
  createEffect(iso, (at) => {
    const wait = at === null ? 0 : Date.parse(at) - Date.now();
    if (!Number.isFinite(wait) || wait <= 0) {
      setPassed(true);
      return;
    }
    setPassed(false);
    const timer = setTimeout(() => setPassed(true), wait);
    return () => clearTimeout(timer);
  });
  return passed;
}

/** The Crypto tab row. A connected wallet opens its page; otherwise the row starts the setup. */
export function VaultNearWalletRow(props: VaultNearWalletProps & { onOpen: () => void }) {
  const { t, format, sourceText } = useText();
  const [setup, setSetup] = createSignal(false);
  const connected = () => nearWalletConnected(props.status);
  const detail = () => {
    if (props.status.signing) return t("vault.near.waiting");
    if (props.status.error) return sourceText(props.status.error);
    if (!connected()) return "";
    const total = format.currencyUsd(totalUsd(props.status));
    const account = props.status.account;
    if (!account) return total;
    const spent = t("vault.near.spentOf", {
      spent: format.currencyUsd(usdNumber(account.spentTodayUsd)),
      limit: format.currencyUsd(usdNumber(account.dailyBudgetUsd)),
    });
    return `${total} · ${spent}`;
  };
  const detailClass = () =>
    props.status.error && !props.status.signing ? "vault-truncate vault-link-error" : "vault-truncate";
  const connect = () => (
    <Button type="button" size="sm" variant="outline" onClick={() => setSetup(true)}>
      {t("vault.near.connect")}
    </Button>
  );
  return (
    <>
      <Item class="settings-modal-row integrations-hub-row">
        <Show when={connected()}>
          <Button
            type="button"
            variant="ghost"
            class="integrations-hub-hitarea"
            aria-label={t("vault.near.open")}
            onClick={props.onOpen}
          />
        </Show>
        <ItemMedia>
          <NearIntentsLogo />
        </ItemMedia>
        <ItemContent>
          <ItemTitle class="vault-truncate">
            {t("vault.near.name")}
            <Show when={props.status.state === "frozen"}>
              {" "}
              <Badge variant="warning-light">{t("vault.near.paused")}</Badge>
            </Show>
          </ItemTitle>
          <Show when={detail()}>
            {(text) => (
              <ItemDescription class={detailClass()} aria-live="polite">
                {text()}
              </ItemDescription>
            )}
          </Show>
        </ItemContent>
        <ItemActions class="integrations-hub-actions">
          <Show when={connected()} fallback={connect()}>
            <ChevronRight class="near-wallet-chevron" aria-hidden="true" />
          </Show>
        </ItemActions>
      </Item>
      <Show when={setup()}>
        <NearSetupDialog
          status={props.status}
          agents={props.agents}
          actions={props.actions}
          onClose={() => {
            setSetup(false);
            if (connected()) props.onOpen();
          }}
        />
      </Show>
    </>
  );
}

type PageDialog =
  | { kind: "funds" }
  | { kind: "budget" }
  | { kind: "agents" }
  | { kind: "disconnect" }
  | { kind: "domain"; rule: NearPayRule };

function Card(props: { label: string; children: JSX.Element }) {
  return (
    <ItemGroup class="settings-modal-card" surface="subtle" aria-label={props.label}>
      {props.children}
    </ItemGroup>
  );
}

/** The wallet page. The settings header shows its name and the way back. */
export function VaultNearWalletPage(props: VaultNearWalletProps & { menuMount?: HTMLElement | undefined }) {
  const { t, format, sourceText } = useText();
  const [dialog, setDialog] = createSignal<PageDialog | null>(null);
  const run = createNearRun();
  const id = `near-wallet-${createUniqueId()}`;
  const account = () => props.status.account;
  const signing = () => props.status.signing;
  const busyWith = (action: string) => signing()?.action === action;
  const changeAllowed = createPassed(() => account()?.policyChangeAvailableAt ?? null);
  const close = () => setDialog(null);
  const open = (next: PageDialog) => {
    run.clear();
    setDialog(next);
  };

  const failure = () => {
    if (dialog() !== null || signing()) return null;
    if (run.failure()) return run.failure();
    return props.status.error ? sourceText(props.status.error) : null;
  };

  const assetName = (assetId: string) => {
    const asset = props.status.depositAssets.find((item) => item.assetId === assetId);
    return asset ? chainName(asset.blockchain) : "";
  };

  const canPayTitle = () => {
    const ids = props.status.agentIds;
    if (ids.length === 0) return t("vault.near.noneCanPay");
    const known = props.agents.filter((agent) => ids.includes(agent.id));
    if (props.agents.length > 0 && known.length === props.agents.length) return t("vault.near.allCanPay");
    if (known.length > 0 && known.length <= 3)
      return t("vault.near.namesCanPay", {
        names: agentNames(
          format,
          props.agents,
          known.map((agent) => agent.id),
        ),
      });
    return t("vault.near.countCanPay", { count: ids.length });
  };
  const grantDetail = () => {
    const current = account();
    const count = t("vault.near.agentsOf", {
      count: String(props.status.agentIds.length),
      total: String(props.agents.length),
    });
    if (!current?.grantExpiresAt) return count;
    const until = t("vault.near.until", {
      date: format.date(new Date(current.grantExpiresAt), { dateStyle: "medium" }),
    });
    return `${count} · ${until}`;
  };
  const renewDue = () => {
    const ends = account()?.grantExpiresAt;
    if (!ends) return false;
    return Date.parse(ends) - Date.now() < RENEW_BEFORE_MS;
  };

  const spendDetail = () => {
    const current = account();
    if (!current) return "";
    const parts: string[] = [];
    if (current.spentTodayUsd !== null)
      parts.push(t("vault.near.spent", { amount: format.currencyUsd(usdNumber(current.spentTodayUsd)) }));
    const at = current.policyChangeAvailableAt;
    if (at && !changeAllowed())
      parts.push(t("vault.near.changeAt", { time: format.date(new Date(at), { timeStyle: "short" }) }));
    return parts.join(" · ");
  };

  const addFunds = () => (
    <Button type="button" size="sm" variant="outline" onClick={() => open({ kind: "funds" })}>
      <Plus aria-hidden="true" />
      {t("vault.near.addFunds")}
    </Button>
  );
  const noDomains = () => (
    <Item class="settings-modal-row">
      <ItemContent>
        <ItemTitle>{t("vault.near.noDomains")}</ItemTitle>
      </ItemContent>
    </Item>
  );
  const domainDialog = (rule: NearPayRule) => (
    <NearDomainDialog
      status={props.status}
      actions={props.actions}
      mode="edit"
      domain={rule.domain}
      limit={rule.dailyUsd}
      onClose={close}
      onSave={(dailyUsd) => props.actions.saveRule({ domain: rule.domain, recipients: rule.recipients, dailyUsd })}
    />
  );

  return (
    <div class="near-wallet-page">
      <Show when={signing() && dialog() === null}>
        <Card label={t("vault.near.name")}>
          <Item class="settings-modal-row" role="status">
            <ItemMedia>
              <Spinner />
            </ItemMedia>
            <ItemContent>
              <ItemTitle class="vault-truncate">{t("vault.near.waiting")}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <Button type="button" size="sm" variant="outline" onClick={() => void props.actions.openSigning()}>
                {t("vault.near.openAgain")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => void props.actions.cancelSigning()}>
                {t("common.cancel")}
              </Button>
            </ItemActions>
          </Item>
        </Card>
      </Show>
      <Show when={failure()}>
        {(text) => (
          <Alert tone="danger" report={false}>
            <AlertContent>
              <AlertDescription>{text()}</AlertDescription>
            </AlertContent>
          </Alert>
        )}
      </Show>
      <Show when={props.status.state === "frozen"}>
        <Alert tone="warning" report={false}>
          <AlertContent>
            <AlertTitle>{t("vault.near.pausedTitle")}</AlertTitle>
          </AlertContent>
          <AlertActions>
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={busyWith("unfreeze")}
              loadingLabel={t("vault.near.waitingShort")}
              disabled={Boolean(signing())}
              onClick={() => void run.run(props.actions.unfreeze)}
            >
              {t("vault.near.resume")}
            </Button>
          </AlertActions>
        </Alert>
      </Show>
      <Show when={account() === null}>
        <Alert tone="warning" report={false}>
          <AlertContent>
            <AlertTitle>{t("vault.near.grantEnded")}</AlertTitle>
          </AlertContent>
          <AlertActions>
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={busyWith("grant")}
              loadingLabel={t("vault.near.waitingShort")}
              disabled={Boolean(signing())}
              onClick={() => void run.run(props.actions.renewGrant)}
            >
              {t("vault.near.renew")}
            </Button>
          </AlertActions>
        </Alert>
      </Show>

      <SettingsSection title={t("vault.near.balance")} actions={addFunds()}>
        <Card label={t("vault.near.balance")}>
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("vault.near.total")}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <span class="near-wallet-amount near-wallet-total">{format.currencyUsd(totalUsd(props.status))}</span>
            </ItemActions>
          </Item>
          <For each={props.status.balances} keyed={(balance) => balance.assetId}>
            {(balance) => (
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle class="vault-truncate">
                    {balance().symbol} <span class="near-wallet-network">{assetName(balance().assetId)}</span>
                  </ItemTitle>
                </ItemContent>
                <ItemActions>
                  <span class="near-wallet-amount">
                    {balance().amount}
                    <Show when={balance().usd}>
                      {(usd) => (
                        <Text as="span" variant="caption" tone="muted">
                          {format.currencyUsd(usdNumber(usd()))}
                        </Text>
                      )}
                    </Show>
                  </span>
                </ItemActions>
              </Item>
            )}
          </For>
        </Card>
      </SettingsSection>

      <Show when={account()}>
        {(current) => (
          <SettingsSection title={t("vault.near.spending")}>
            <Card label={t("vault.near.spending")}>
              <Item class="settings-modal-row">
                <ItemContent>
                  <ItemTitle>
                    {t("vault.near.perDay", { amount: format.currencyUsd(usdNumber(current().dailyBudgetUsd)) })}
                  </ItemTitle>
                  <Show when={spendDetail()}>{(text) => <ItemDescription>{text()}</ItemDescription>}</Show>
                  <Show when={current().spentTodayUsd !== null}>
                    <Progress
                      class="near-wallet-meter"
                      value={usdNumber(current().spentTodayUsd)}
                      maxValue={usdNumber(current().dailyBudgetUsd) || 1}
                      aria-label={t("vault.near.spentAria", {
                        spent: format.currencyUsd(usdNumber(current().spentTodayUsd)),
                        limit: format.currencyUsd(usdNumber(current().dailyBudgetUsd)),
                      })}
                    />
                  </Show>
                </ItemContent>
                <ItemActions>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={busyWith("budget") && dialog() === null}
                    loadingLabel={t("vault.near.waitingShort")}
                    disabled={Boolean(signing()) || !changeAllowed()}
                    onClick={() => open({ kind: "budget" })}
                  >
                    {t("vault.near.change")}
                  </Button>
                </ItemActions>
              </Item>
            </Card>
          </SettingsSection>
        )}
      </Show>

      <SettingsSection title={t("vault.near.autoPay")}>
        <Card label={t("vault.near.autoPay")}>
          <Show when={props.status.rules.length > 0} fallback={noDomains()}>
            <For each={props.status.rules} keyed={(rule) => rule.domain}>
              {(rule) => (
                <Item class="settings-modal-row">
                  <ItemMedia>
                    <SiteIcon domain={rule().domain} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle id={`${id}-${rule().domain}`} class="vault-truncate">
                      {rule().domain}
                    </ItemTitle>
                    <ItemDescription>
                      {t("vault.near.spentOf", {
                        spent: format.currencyUsd(rule().spentTodayUsd),
                        limit: format.currencyUsd(rule().dailyUsd),
                      })}
                    </ItemDescription>
                    <Progress
                      class="near-wallet-meter"
                      value={rule().spentTodayUsd}
                      maxValue={rule().dailyUsd}
                      aria-label={t("vault.near.domainAria", {
                        spent: format.currencyUsd(rule().spentTodayUsd),
                        limit: format.currencyUsd(rule().dailyUsd),
                        domain: rule().domain,
                      })}
                    />
                  </ItemContent>
                  <ItemActions>
                    <DomainMenu
                      domain={rule().domain}
                      menuMount={props.menuMount}
                      disabled={Boolean(signing())}
                      onChange={() => open({ kind: "domain", rule: rule() })}
                      onRemove={() => void run.run(() => props.actions.removeRule(rule().domain))}
                    />
                  </ItemActions>
                </Item>
              )}
            </For>
          </Show>
        </Card>
      </SettingsSection>

      <SettingsSection title={t("vault.near.agentsTitle")}>
        <Card label={t("vault.near.agentsTitle")}>
          <Item class="settings-modal-row">
            <Show when={props.status.agentIds.length > 0}>
              <ItemMedia>
                <AgentStack agents={props.agents} ids={props.status.agentIds} />
              </ItemMedia>
            </Show>
            <ItemContent>
              <ItemTitle class="vault-truncate">{canPayTitle()}</ItemTitle>
              <ItemDescription>{grantDetail()}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Show when={renewDue()}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={busyWith("grant")}
                  loadingLabel={t("vault.near.waitingShort")}
                  disabled={Boolean(signing())}
                  onClick={() => void run.run(props.actions.renewGrant)}
                >
                  {t("vault.near.renew")}
                </Button>
              </Show>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(signing())}
                onClick={() => open({ kind: "agents" })}
              >
                {t("vault.near.chooseAgents")}
              </Button>
            </ItemActions>
          </Item>
        </Card>
      </SettingsSection>

      <SettingsSection title={t("vault.near.stop")}>
        <Card label={t("vault.near.stop")}>
          <Show when={props.status.state === "ready"}>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("vault.near.pause")}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={busyWith("freeze")}
                  loadingLabel={t("vault.near.waitingShort")}
                  disabled={Boolean(signing())}
                  onClick={() => void run.run(props.actions.freeze)}
                >
                  {t("vault.near.pauseButton")}
                </Button>
              </ItemActions>
            </Item>
          </Show>
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("vault.near.disconnectRow")}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <Button type="button" size="sm" variant="destructive" onClick={() => open({ kind: "disconnect" })}>
                {t("vault.near.disconnect")}
              </Button>
            </ItemActions>
          </Item>
        </Card>
      </SettingsSection>

      <Show when={dialog()?.kind === "funds"}>
        <NearAddFundsDialog status={props.status} actions={props.actions} onClose={close} />
      </Show>
      <Show when={dialog()?.kind === "budget"}>
        <NearBudgetDialog status={props.status} actions={props.actions} onClose={close} />
      </Show>
      <Show when={dialog()?.kind === "agents"}>
        <NearAgentsDialog status={props.status} agents={props.agents} actions={props.actions} onClose={close} />
      </Show>
      <Show when={domainRule(dialog())} keyed>
        {(rule) => domainDialog(rule)}
      </Show>
      <ConfirmDialog
        open={dialog()?.kind === "disconnect"}
        title={t("vault.near.disconnectTitle")}
        description={t("vault.near.disconnectDescription")}
        confirmLabel={t("vault.near.disconnect")}
        tone="destructive"
        error={disconnectError(dialog(), run.failure())}
        onCancel={close}
        onConfirm={async () => {
          if (await run.run(props.actions.disconnect)) close();
        }}
      />
    </div>
  );
}

const domainRule = (dialog: PageDialog | null) => (dialog?.kind === "domain" ? dialog.rule : undefined);

const disconnectError = (dialog: PageDialog | null, failure: string | null) =>
  dialog?.kind === "disconnect" && failure ? failure : undefined;

/** The ⋯ menu of an allowed domain: Change limit and Remove. */
function DomainMenu(props: {
  domain: string;
  menuMount?: HTMLElement | undefined;
  disabled: boolean;
  onChange: () => void;
  onRemove: () => void;
}) {
  const { t } = useText();
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button`}
        aria-label={t("vault.near.domainActions", { domain: props.domain })}
        disabled={props.disabled}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.menuMount ?? document.body}>
        <DropdownMenu.Content>
          <DropdownMenu.Item onSelect={props.onChange}>
            <Pencil aria-hidden="true" />
            {t("vault.near.changeLimit")}
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={props.onRemove}>
            <Trash2 aria-hidden="true" />
            {t("common.remove")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
