/**
 * The dialogs of the NEAR Intents wallet: the guided setup, the daily budget, the agents that can
 * pay, Add funds, and the daily limit of a domain. An owner change waits for a signature in the
 * browser; the dialog shows the wait and can open the signing page again or stop.
 */

import {
  NEAR_RULE_DAILY_USD,
  NEAR_WALLET_LIMITS,
  type NearOwnerAction,
  type NearOwnerMethod,
  type NearWalletStatus,
} from "@openbot/contracts/ipc";
import { Button, Field, Input, NativeSelect, RadioGroup, Text } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, createStore, For, Match, Show, Switch, untrack } from "solid-js";
import { useText } from "../../text";
import {
  AddFundsFields,
  AgentPicker,
  agentNames,
  createNearRun,
  NearFailure,
  NearSigningWait,
  type NearWalletActions,
  type NearWalletAgent,
  NearWalletDialog,
  OwnerMethodChoice,
  RiskAccept,
  usdNumber,
} from "./near-wallet-parts";

/** What every dialog of the wallet gets. */
export interface NearDialogProps {
  status: NearWalletStatus;
  actions: NearWalletActions;
  onClose: () => void;
}

/** The daily budgets that the setup offers, in USD. */
const BUDGET_PRESETS = ["10", "25", "100"] as const;

/** The owner signs now for one of these actions. */
const signingFor = (status: NearWalletStatus, actions: readonly NearOwnerAction[]) =>
  status.signing !== null && actions.includes(status.signing.action);

/** The daily budget as radio cards: "Up to $25 a day". */
function BudgetChoice(props: { values: readonly string[]; value: string; onChange: (value: string) => void }) {
  const { t, format } = useText();
  return (
    <RadioGroup.Root
      class="settings-mobile-route-choice"
      aria-label={t("vault.near.budgetLabel")}
      value={props.value}
      onChange={(value) => {
        if (props.values.includes(value)) props.onChange(value);
      }}
    >
      <For each={props.values}>
        {(value) => (
          <RadioGroup.Item class="settings-mobile-route-option" value={value}>
            <RadioGroup.ItemInput />
            <RadioGroup.ItemControl class="settings-mobile-route-card">
              <span class="settings-mobile-route-dot" aria-hidden="true" />
              <span class="settings-mobile-route-text">
                <RadioGroup.ItemLabel class="settings-mobile-route-name">
                  {t("vault.near.perDay", { amount: format.currencyUsd(usdNumber(value)) })}
                </RadioGroup.ItemLabel>
              </span>
            </RadioGroup.ItemControl>
          </RadioGroup.Item>
        )}
      </For>
    </RadioGroup.Root>
  );
}

type SetupStep = "key" | "spending" | "agents" | "sign" | "funds";

const STEP_KEYS = {
  key: "vault.near.step.key",
  spending: "vault.near.step.spending",
  agents: "vault.near.step.agents",
  sign: "vault.near.step.sign",
  funds: "vault.near.step.funds",
} as const;

/** The setup signatures: the owner, the agent account and the grant of this app. */
const SETUP_ACTIONS: readonly NearOwnerAction[] = ["register", "create", "grant"];

/**
 * Connects a wallet: the partner key when there is none, the daily budget, the agents, the owner's
 * sign-in with the risk notice, then Add funds. `create` runs in the background, so the dialog waits
 * for the wallet to be ready.
 */
export function NearSetupDialog(props: NearDialogProps & { agents: readonly NearWalletAgent[] }) {
  const { t, sourceText } = useText();
  const steps: readonly SetupStep[] = untrack(() =>
    props.status.state === "no-key"
      ? ["key", "spending", "agents", "sign", "funds"]
      : ["spending", "agents", "sign", "funds"],
  );
  // A setup that already waits for a signature opens on its Sign step.
  const [started, setStarted] = createSignal(untrack(() => signingFor(props.status, SETUP_ACTIONS)));
  const [index, setIndex] = createSignal(untrack(() => (started() ? steps.indexOf("sign") : 0)));
  const step = () => steps[index()] ?? "funds";
  const [key, setKey] = createSignal("");
  const [budget, setBudget] = createSignal<string>("25");
  const [agentIds, setAgentIds] = createSignal<string[]>(untrack(() => [...props.status.agentIds]));
  const [method, setMethod] = createSignal<NearOwnerMethod>("passkey");
  const [accepted, setAccepted] = createSignal(false);
  // The background setup stopped with a failure in the status.
  const [stopped, setStopped] = createSignal(false);
  const action = createNearRun();
  const connected = () => props.status.state === "ready" || props.status.state === "frozen";
  const waiting = () => started() && !stopped() && !connected();
  const failure = () => {
    const own = action.failure();
    if (own !== null) return own;
    const error = props.status.error;
    return stopped() && error !== null ? sourceText(error) : null;
  };

  // A new failure ends the wait. The failure that was there before the setup started does not.
  createEffect(
    () => props.status.error,
    (error) => {
      if (error !== null && started()) setStopped(true);
    },
  );

  // The wallet is ready after the last signature: go on to Add funds.
  createEffect(
    () => started() && connected(),
    (ready) => {
      if (ready) setIndex(steps.indexOf("funds"));
    },
  );

  const canGo = () => {
    if (step() === "key") return key().trim() !== "" && !action.busy();
    if (step() === "agents") return agentIds().length > 0;
    if (step() === "sign") return accepted() && !waiting();
    return true;
  };

  async function next() {
    if (!canGo()) return;
    if (step() === "key") {
      const saved = await action.run(() => props.actions.setKey(key().trim()));
      if (!saved) return;
      setKey("");
    }
    if (step() === "sign") {
      setStopped(false);
      setStarted(true);
      const sent = await action.run(() =>
        props.actions.create({ ownerMethod: method(), dailyBudgetUsd: budget(), agentIds: agentIds() }),
      );
      if (!sent) setStopped(true);
      return;
    }
    if (step() === "funds") return props.onClose();
    setIndex(index() + 1);
  }

  const title = () => t("vault.near.setupTitle", { step: t(STEP_KEYS[step()]) });
  const submitLabel = () => {
    if (step() === "sign") return t("vault.near.signInBrowser");
    if (step() === "funds") return t("common.done");
    return t("common.continue");
  };
  const canGoBack = () => index() > 0 && !waiting() && step() !== "funds" && !connected();
  const wait = () => <NearSigningWait onOpenAgain={props.actions.openSigning} onCancel={props.actions.cancelSigning} />;
  const footer = () => (
    <>
      <Text as="span" variant="caption" tone="muted" class="near-wallet-step">
        {t("vault.near.stepCount", { step: String(index() + 1), count: String(steps.length) })}
      </Text>
      <Show when={canGoBack()}>
        <Button type="button" variant="ghost" onClick={() => setIndex(index() - 1)}>
          {t("common.back")}
        </Button>
      </Show>
      <Button
        type="submit"
        disabled={!canGo()}
        loading={waiting() || (step() === "key" && action.busy())}
        loadingLabel={t("vault.near.waitingShort")}
      >
        {submitLabel()}
      </Button>
    </>
  );

  return (
    <NearWalletDialog
      title={title()}
      focusSearch={step() === "agents"}
      onClose={props.onClose}
      onSubmit={() => void next()}
      actions={footer()}
    >
      <Switch>
        <Match when={step() === "key"}>
          <Field label={t("vault.near.keyLabel")}>
            <Input
              type="password"
              autocomplete="off"
              spellcheck={false}
              maxlength={NEAR_WALLET_LIMITS.partnerKey}
              value={key()}
              onValueChange={setKey}
            />
          </Field>
        </Match>
        <Match when={step() === "spending"}>
          <BudgetChoice values={BUDGET_PRESETS} value={budget()} onChange={setBudget} />
        </Match>
        <Match when={step() === "agents"}>
          <AgentPicker
            agents={props.agents}
            label={t("vault.near.agentsTitle")}
            checked={(id) => agentIds().includes(id)}
            set={(ids, on) =>
              setAgentIds(on ? [...new Set([...agentIds(), ...ids])] : agentIds().filter((item) => !ids.includes(item)))
            }
          />
        </Match>
        <Match when={step() === "sign"}>
          <Show when={!waiting()} fallback={wait()}>
            <Field label={t("vault.near.signWith")}>
              <OwnerMethodChoice value={method()} onChange={setMethod} />
            </Field>
            <RiskAccept accepted={accepted()} onChange={setAccepted} />
          </Show>
        </Match>
        <Match when={step() === "funds"}>
          <AddFundsFields assets={props.status.depositAssets} deposit={props.actions.deposit} />
        </Match>
      </Switch>
      <NearFailure text={failure()} />
    </NearWalletDialog>
  );
}

/** Add funds: the deposit address of the chosen asset. */
export function NearAddFundsDialog(props: NearDialogProps) {
  const { t } = useText();
  const footer = () => <Button type="submit">{t("common.done")}</Button>;
  return (
    <NearWalletDialog
      title={t("vault.near.addFunds")}
      onClose={props.onClose}
      onSubmit={props.onClose}
      actions={footer()}
    >
      <AddFundsFields assets={props.status.depositAssets} deposit={props.actions.deposit} />
    </NearWalletDialog>
  );
}

/** The frame of a dialog that makes one owner change: Cancel, the submit button and the wait. */
function OwnerChangeDialog(props: {
  title: string;
  submitLabel: string;
  canSave: boolean;
  /** The owner signs this change in the browser. */
  sign: boolean;
  focusSearch?: boolean | undefined;
  actions: NearWalletActions;
  run: ReturnType<typeof createNearRun>;
  onClose: () => void;
  onSave: () => void;
  children: JSX.Element;
}) {
  const { t } = useText();
  const waiting = () => props.run.busy() && props.sign;
  const wait = () => <NearSigningWait onOpenAgain={props.actions.openSigning} onCancel={props.actions.cancelSigning} />;
  const body = () => (
    <Show when={!waiting()} fallback={wait()}>
      {props.children}
    </Show>
  );
  const footer = () => (
    <>
      <Button type="button" variant="ghost" disabled={props.run.busy() && !props.sign} onClick={props.onClose}>
        {t("common.cancel")}
      </Button>
      <Button
        type="submit"
        class="near-wallet-grant-submit"
        title={props.submitLabel}
        disabled={!props.canSave || props.run.busy()}
        loading={props.run.busy()}
        loadingLabel={t("vault.near.waitingShort")}
      >
        <span>{props.submitLabel}</span>
      </Button>
    </>
  );
  return (
    <NearWalletDialog
      title={props.title}
      focusSearch={props.focusSearch}
      busy={props.run.busy() && !props.sign}
      onClose={props.onClose}
      onSubmit={props.onSave}
      actions={footer()}
    >
      {body()}
      <NearFailure text={props.run.failure()} />
    </NearWalletDialog>
  );
}

/** The daily budget of all payments. The Agent API takes one policy change in 10 minutes. */
export function NearBudgetDialog(props: NearDialogProps) {
  const { t } = useText();
  const current = untrack(() => props.status.account?.dailyBudgetUsd ?? "25");
  const values = [...new Set([...BUDGET_PRESETS, current])].sort((a, b) => usdNumber(a) - usdNumber(b));
  const [budget, setBudget] = createSignal(current);
  const run = createNearRun();
  async function save() {
    if (budget() === current) return;
    if (await run.run(() => props.actions.setBudget(budget()))) props.onClose();
  }
  return (
    <OwnerChangeDialog
      title={t("vault.near.budgetTitle")}
      submitLabel={t("vault.near.signInBrowser")}
      canSave={budget() !== current}
      sign
      actions={props.actions}
      run={run}
      onClose={props.onClose}
      onSave={() => void save()}
    >
      <BudgetChoice values={values} value={budget()} onChange={setBudget} />
    </OwnerChangeDialog>
  );
}

/**
 * The agents that can pay, with a search. Changes wait for the button, which says what it does:
 * "Allow Code Review", "Remove Chief", "Save: allow 3, remove 1". The list stays on this computer.
 */
export function NearAgentsDialog(props: NearDialogProps & { agents: readonly NearWalletAgent[] }) {
  const { t, format } = useText();
  const [draft, setDraft] = createStore<{ on: Record<string, boolean> }>({ on: {} });
  const has = (id: string) => props.status.agentIds.includes(id);
  const checked = (id: string) => draft.on[id] ?? has(id);
  const adds = () => props.agents.filter((agent) => draft.on[agent.id] === true && !has(agent.id)).map((a) => a.id);
  const removes = () => props.agents.filter((agent) => draft.on[agent.id] === false && has(agent.id)).map((a) => a.id);
  const label = () => {
    const added = adds();
    const removed = removes();
    if (added.length > 0 && removed.length > 0)
      return t("vault.near.saveAgents", { added: String(added.length), removed: String(removed.length) });
    if (added.length > 0) return t("vault.near.allowAgents", { names: agentNames(format, props.agents, added) });
    if (removed.length > 0) return t("vault.near.removeAgents", { names: agentNames(format, props.agents, removed) });
    return t("common.save");
  };
  const unchanged = () => adds().length === 0 && removes().length === 0;
  const run = createNearRun();
  async function save() {
    if (unchanged()) return;
    // Agents of another computer keep their place in the list.
    const known = new Set(props.agents.map((agent) => agent.id));
    const agentIds = [
      ...props.status.agentIds.filter((id) => !known.has(id)),
      ...props.agents.filter((agent) => checked(agent.id)).map((agent) => agent.id),
    ];
    if (await run.run(() => props.actions.setAgents(agentIds))) props.onClose();
  }
  return (
    <OwnerChangeDialog
      title={t("vault.near.agentsTitle")}
      submitLabel={label()}
      canSave={!unchanged()}
      sign={false}
      focusSearch
      actions={props.actions}
      run={run}
      onClose={props.onClose}
      onSave={() => void save()}
    >
      <AgentPicker
        agents={props.agents}
        label={t("vault.near.agentsTitle")}
        checked={checked}
        set={(ids, on) =>
          setDraft((state) => {
            for (const id of ids) state.on[id] = on;
          })
        }
      />
    </OwnerChangeDialog>
  );
}

/** The smallest daily limit that covers the amount. */
export const limitFor = (amountUsd: number) =>
  NEAR_RULE_DAILY_USD.find((limit) => limit >= amountUsd) ?? NEAR_RULE_DAILY_USD.at(-1) ?? 0;

/**
 * The daily limit of a domain that agents pay without asking. `always` comes from a payment in the
 * chat; `edit` from the wallet page. While each payment asks, the first domain is a policy change
 * that the owner signs.
 */
export function NearDomainDialog(
  props: NearDialogProps & {
    mode: "always" | "edit";
    domain: string;
    limit?: number | undefined;
    /** The amount of the payment that the limit must cover. */
    min?: number | undefined;
    onSave: (dailyUsd: number) => Promise<NearWalletStatus | undefined>;
  },
) {
  const { t, format } = useText();
  const limits = () => NEAR_RULE_DAILY_USD.filter((limit) => limit >= (props.min ?? 0));
  const [limit, setLimit] = createSignal<number>(untrack(() => props.limit ?? limitFor(props.min ?? 0)));
  const sign = untrack(() => props.status.account?.ownerApproval === true);
  const run = createNearRun();
  const title = () =>
    props.mode === "always"
      ? t("vault.near.alwaysTitle", { domain: props.domain })
      : t("vault.near.limitTitle", { domain: props.domain });
  const submitLabel = () => {
    if (sign) return t("vault.near.signInBrowser");
    return props.mode === "always" ? t("prompt.approval.alwaysAllow") : t("common.save");
  };
  async function save() {
    if (props.mode === "edit" && limit() === props.limit) return props.onClose();
    if (await run.run(() => props.onSave(limit()))) props.onClose();
  }
  return (
    <OwnerChangeDialog
      title={title()}
      submitLabel={submitLabel()}
      canSave={limits().some((value) => value === limit())}
      sign={sign}
      actions={props.actions}
      run={run}
      onClose={props.onClose}
      onSave={() => void save()}
    >
      <Show when={props.mode === "always"}>
        <Text>{t("vault.near.alwaysBody", { domain: props.domain })}</Text>
      </Show>
      <Field label={t("vault.near.dailyLimit")}>
        <NativeSelect value={String(limit())} onChange={(event) => setLimit(Number(event.currentTarget.value))}>
          <For each={limits()}>
            {(value) => (
              <option value={String(value)}>{t("vault.near.perDay", { amount: format.currencyUsd(value) })}</option>
            )}
          </For>
        </NativeSelect>
      </Field>
    </OwnerChangeDialog>
  );
}
