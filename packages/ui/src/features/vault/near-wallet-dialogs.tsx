import {
  isNearBudgetText,
  NEAR_RULE_DAILY_USD,
  type NearOwnerAction,
  type NearPasskeyChoice,
  type NearWalletStatus,
} from "@openbot/contracts/ipc";
import { Button, Field, Input, NativeSelect, RadioGroup, Text } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, createStore, For, Match, Show, Switch, untrack } from "solid-js";
import { useText } from "../../text";
import { AddFundsFields } from "./near-wallet-funds";
import {
  AgentPicker,
  AllAgentsChoice,
  agentNames,
  createNearRun,
  NearCheck,
  NearFailure,
  NearSigningWait,
  type NearWalletActions,
  type NearWalletAgent,
  NearWalletDialog,
  PasskeyBackupNotice,
  RiskAccept,
  SETUP_SIGNATURE_COUNT,
  SetupSignatures,
  SetupSteps,
  usdNumber,
} from "./near-wallet-parts";

export interface NearDialogProps {
  status: NearWalletStatus;
  actions: NearWalletActions;
  onClose: () => void;
}

const BUDGET_PRESETS = ["10", "25", "100"] as const;
const BUDGET_TEXT_LIMIT = 12;

const signingFor = (status: NearWalletStatus, actions: readonly NearOwnerAction[]) =>
  status.signing !== null && actions.includes(status.signing.action);

const CUSTOM_BUDGET = "custom";

const isBudgetPreset = (value: string) => BUDGET_PRESETS.some((preset) => preset === value);

function BudgetChoice(props: { initial: string; onChange: (value: string | null) => void }) {
  const { t, format } = useText();
  const [choice, setChoice] = createSignal(
    untrack(() => (isBudgetPreset(props.initial) ? props.initial : CUSTOM_BUDGET)),
  );
  const [custom, setCustom] = createSignal(untrack(() => (isBudgetPreset(props.initial) ? "" : props.initial)));
  const customValue = (text: string) => (isNearBudgetText(text.trim()) ? text.trim() : null);
  const customInvalid = () => custom().trim() !== "" && customValue(custom()) === null;
  const choose = (value: string) => {
    setChoice(value);
    props.onChange(value === CUSTOM_BUDGET ? customValue(custom()) : value);
  };
  const type = (text: string) => {
    setCustom(text);
    props.onChange(customValue(text));
  };
  return (
    <>
      <RadioGroup.Root
        class="settings-mobile-route-choice"
        aria-label={t("vault.near.budgetLabel")}
        value={choice()}
        onChange={choose}
      >
        <For each={BUDGET_PRESETS}>
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
        <RadioGroup.Item class="settings-mobile-route-option" value={CUSTOM_BUDGET}>
          <RadioGroup.ItemInput />
          <RadioGroup.ItemControl class="settings-mobile-route-card">
            <span class="settings-mobile-route-dot" aria-hidden="true" />
            <span class="settings-mobile-route-text">
              <RadioGroup.ItemLabel class="settings-mobile-route-name">
                {t("vault.near.budgetCustom")}
              </RadioGroup.ItemLabel>
            </span>
          </RadioGroup.ItemControl>
        </RadioGroup.Item>
      </RadioGroup.Root>
      <Show when={choice() === CUSTOM_BUDGET}>
        <Field
          label={t("vault.near.budgetCustomLabel")}
          error={customInvalid() ? t("vault.near.budgetCustomInvalid") : undefined}
        >
          <Input
            inputmode="decimal"
            autocomplete="off"
            maxlength={BUDGET_TEXT_LIMIT}
            value={custom()}
            onValueChange={type}
          />
        </Field>
      </Show>
    </>
  );
}

type SetupStep = "sign" | "backup" | "funds";

const SETUP_DAILY_BUDGET = "25";

const STEP_KEYS = {
  sign: "vault.near.step.sign",
  backup: "vault.near.step.backup",
  funds: "vault.near.step.funds",
} as const;

const SETUP_ACTIONS: readonly NearOwnerAction[] = ["register", "create", "grant"];
const SETUP_STEPS: readonly SetupStep[] = ["sign", "backup", "funds"];

export function NearSetupDialog(props: NearDialogProps) {
  const { t, sourceText } = useText();
  const [started, setStarted] = createSignal(untrack(() => signingFor(props.status, SETUP_ACTIONS)));
  const [index, setIndex] = createSignal(0);
  const step = () => SETUP_STEPS[index()] ?? "funds";
  const [accepted, setAccepted] = createSignal(false);
  const [budget, setBudget] = createSignal<string | null>(SETUP_DAILY_BUDGET);
  const [shownBudget, setShownBudget] = createSignal(SETUP_DAILY_BUDGET);
  const chooseBudget = (value: string | null) => {
    setBudget(value);
    if (value !== null) setShownBudget(value);
  };
  const [keepAccepted, setKeepAccepted] = createSignal(false);
  const [acceptedAt, setAcceptedAt] = createSignal<string | null>(null);
  const [stopped, setStopped] = createSignal(false);
  const [signed, setSigned] = createSignal(-1);
  const action = createNearRun();
  const connected = () => props.status.state === "ready" || props.status.state === "frozen";
  const backup = () => props.status.ownerBackup;
  const deviceWarning = () => {
    const record = backup();
    return (
      started() &&
      !connected() &&
      props.status.signing === null &&
      !action.busy() &&
      record !== null &&
      record.state === "deviceOnly" &&
      record.checkedAt !== acceptedAt()
    );
  };
  const checking = () => props.status.signing?.action === "check-backup";
  const waiting = () => started() && !stopped() && !connected() && !deviceWarning();
  const failure = () => {
    const own = action.failure();
    if (own !== null) return own;
    const error = props.status.error;
    return stopped() && error !== null ? sourceText(error) : null;
  };

  createEffect(
    () => props.status.error,
    (error) => {
      if (error !== null && started()) setStopped(true);
    },
  );

  createEffect(
    () => props.status.signing?.action ?? null,
    (current) => {
      if (current === null) return;
      const reached = Math.min(SETUP_ACTIONS.indexOf(current), SETUP_SIGNATURE_COUNT - 1);
      if (reached > signed()) setSigned(reached);
    },
  );

  createEffect(
    () => started() && connected(),
    (ready) => {
      if (ready) setIndex(SETUP_STEPS.indexOf("backup"));
    },
  );

  createEffect(deviceWarning, (warn) => {
    if (!warn) return;
    setKeepAccepted(false);
    setIndex(SETUP_STEPS.indexOf("backup"));
  });

  const canGo = () => {
    if (step() === "sign") return accepted() && budget() !== null && !waiting();
    if (step() === "backup") return !action.busy() && !checking() && (!deviceWarning() || keepAccepted());
    return true;
  };

  async function create(passkey?: NearPasskeyChoice) {
    const dailyBudgetUsd = budget();
    if (dailyBudgetUsd === null) return;
    setStopped(false);
    setSigned(-1);
    setStarted(true);
    const input = { dailyBudgetUsd };
    const sent = await action.run(() => props.actions.create(passkey ? { ...input, passkey } : input));
    if (!sent) setStopped(true);
  }

  function cancelSetup() {
    setStopped(true);
    void props.actions.cancelSigning();
  }

  function resume(passkey: NearPasskeyChoice) {
    setAcceptedAt(backup()?.checkedAt ?? null);
    setIndex(SETUP_STEPS.indexOf("sign"));
    void create(passkey);
  }

  async function next() {
    if (!canGo()) return;
    if (step() === "sign") {
      setAcceptedAt(null);
      return create();
    }
    if (step() === "backup" && deviceWarning()) return resume("keep");
    if (step() === "funds") return props.onClose();
    setIndex(index() + 1);
  }

  const submitLabel = () => {
    if (step() === "sign" && stopped()) return t("common.tryAgain");
    if (step() === "sign") return t("vault.near.signInBrowser");
    if (deviceWarning()) return t("vault.near.backup.keep");
    if (step() === "funds") return t("common.done");
    return t("common.continue");
  };
  const activeSignature = () => {
    if (waiting()) return Math.max(signed(), 0);
    if (started() && stopped()) return signed();
    return -1;
  };
  const signingNow = () => (step() === "sign" && waiting()) || checking();
  const canGoBack = () => index() > 0 && !waiting() && step() !== "funds" && step() !== "backup" && !connected();
  const wait = () => <NearSigningWait onOpenAgain={props.actions.openSigning} />;
  const stepLabels = () => SETUP_STEPS.map((item) => t(STEP_KEYS[item]));
  const footer = () => (
    <Show
      when={!signingNow()}
      fallback={
        <>
          <Show when={step() === "sign"}>
            <Text as="span" variant="caption" tone="muted" class="near-wallet-status" role="status">
              {t("vault.near.signature.count", {
                step: String(activeSignature() + 1),
                count: String(SETUP_SIGNATURE_COUNT),
              })}
            </Text>
          </Show>
          <Button type="button" variant="ghost" onClick={cancelSetup}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      <Show when={step() === "sign"}>
        <Button type="button" variant="ghost" onClick={props.onClose}>
          {t("common.cancel")}
        </Button>
      </Show>
      <Show when={canGoBack()}>
        <Button type="button" variant="ghost" onClick={() => setIndex(index() - 1)}>
          {t("common.back")}
        </Button>
      </Show>
      <Show when={deviceWarning()}>
        <Button type="button" variant="ghost" onClick={() => resume("replace")}>
          {t("vault.near.backup.useAnother")}
        </Button>
      </Show>
      <Button type="submit" disabled={!canGo()}>
        {submitLabel()}
      </Button>
    </Show>
  );

  return (
    <NearWalletDialog
      title={t("vault.near.setupTitle")}
      focusCheckbox={!started()}
      onClose={props.onClose}
      onSubmit={() => void next()}
      actions={footer()}
    >
      <SetupSteps labels={stepLabels()} current={index()} />
      <Switch>
        <Match when={step() === "sign"}>
          <Show when={!started() || stopped()}>
            <Text as="p" variant="label">
              {t("vault.near.budgetLabel")}
            </Text>
            <BudgetChoice initial={shownBudget()} onChange={chooseBudget} />
          </Show>
          <SetupSignatures active={activeSignature()} failed={started() && stopped()} dailyBudgetUsd={shownBudget()} />
          <Show when={!started()}>
            <RiskAccept accepted={accepted()} onChange={setAccepted} />
          </Show>
        </Match>
        <Match when={step() === "backup"}>
          <Show when={!checking()} fallback={wait()}>
            <PasskeyBackupNotice state={backup()?.state ?? null}>
              <Show when={deviceWarning()}>
                <NearCheck label={t("vault.near.backup.accept")} checked={keepAccepted()} onChange={setKeepAccepted} />
              </Show>
              <Show when={connected() && backup()?.state !== "synced"}>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={action.busy()}
                    onClick={() => void action.run(props.actions.checkBackup)}
                  >
                    {t("vault.near.backup.checkAgain")}
                  </Button>
                </div>
              </Show>
            </PasskeyBackupNotice>
          </Show>
        </Match>
        <Match when={step() === "funds"}>
          <AddFundsFields
            assets={props.status.depositAssets}
            deposit={props.actions.deposit}
            failed={failure() !== null}
          />
        </Match>
      </Switch>
      <NearFailure text={failure()} />
    </NearWalletDialog>
  );
}

export function NearAddFundsDialog(props: NearDialogProps) {
  const { t, sourceText } = useText();
  const footer = () => <Button type="submit">{t("common.done")}</Button>;
  const unavailable = () => {
    const error = props.status.error;
    if (props.status.depositAssets.length > 0 || error === null) return null;
    return sourceText(error);
  };
  return (
    <NearWalletDialog
      title={t("vault.near.addFunds")}
      onClose={props.onClose}
      onSubmit={props.onClose}
      actions={footer()}
    >
      <AddFundsFields
        assets={props.status.depositAssets}
        deposit={props.actions.deposit}
        failed={unavailable() !== null}
      />
      <NearFailure text={unavailable()} />
    </NearWalletDialog>
  );
}

function OwnerChangeDialog(props: {
  title: string;
  submitLabel: string;
  canSave: boolean;
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
  const wait = () => <NearSigningWait onOpenAgain={props.actions.openSigning} />;
  const body = () => (
    <Show when={!waiting()} fallback={wait()}>
      {props.children}
    </Show>
  );
  const footer = () => (
    <Show
      when={!waiting()}
      fallback={
        <Button type="button" variant="ghost" onClick={() => void props.actions.cancelSigning()}>
          {t("common.cancel")}
        </Button>
      }
    >
      <Button type="button" variant="ghost" disabled={props.run.busy()} onClick={props.onClose}>
        {t("common.cancel")}
      </Button>
      <Button
        type="submit"
        class="near-wallet-grant-submit"
        title={props.submitLabel}
        disabled={!props.canSave || props.run.busy()}
        loading={props.run.busy()}
        loadingLabel={t("common.saving")}
      >
        <span>{props.submitLabel}</span>
      </Button>
    </Show>
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

export function NearBudgetDialog(props: NearDialogProps) {
  const { t } = useText();
  const current = untrack(() => props.status.account?.dailyBudgetUsd ?? SETUP_DAILY_BUDGET);
  const [budget, setBudget] = createSignal<string | null>(current);
  const sameAsCurrent = (value: string) => Number(value) === Number(current);
  const changed = () => {
    const next = budget();
    return next !== null && !sameAsCurrent(next);
  };
  const run = createNearRun();
  async function save() {
    const next = budget();
    if (next === null || sameAsCurrent(next)) return;
    if (await run.run(() => props.actions.setBudget(next))) props.onClose();
  }
  return (
    <OwnerChangeDialog
      title={t("vault.near.budgetTitle")}
      submitLabel={t("vault.near.signInBrowser")}
      canSave={changed()}
      sign
      actions={props.actions}
      run={run}
      onClose={props.onClose}
      onSave={() => void save()}
    >
      <BudgetChoice initial={current} onChange={setBudget} />
    </OwnerChangeDialog>
  );
}

export function NearAgentsDialog(props: NearDialogProps & { agents: readonly NearWalletAgent[] }) {
  const { t, format } = useText();
  const [draft, setDraft] = createStore<{ on: Record<string, boolean> }>({ on: {} });
  const [allAgents, setAllAgents] = createSignal(untrack(() => props.status.allAgents));
  const has = (id: string) => props.status.allAgents || props.status.agentIds.includes(id);
  const checked = (id: string) => draft.on[id] ?? has(id);
  const adds = () => props.agents.filter((agent) => draft.on[agent.id] === true && !has(agent.id)).map((a) => a.id);
  const removes = () => props.agents.filter((agent) => draft.on[agent.id] === false && has(agent.id)).map((a) => a.id);
  const label = () => {
    if (allAgents() !== props.status.allAgents) return t("common.save");
    const added = adds();
    const removed = removes();
    if (added.length > 0 && removed.length > 0)
      return t("vault.near.saveAgents", { added: String(added.length), removed: String(removed.length) });
    if (added.length > 0) return t("vault.near.allowAgents", { names: agentNames(format, props.agents, added) });
    if (removed.length > 0) return t("vault.near.removeAgents", { names: agentNames(format, props.agents, removed) });
    return t("common.save");
  };
  const unchanged = () =>
    allAgents() === props.status.allAgents && (allAgents() || (adds().length === 0 && removes().length === 0));
  const run = createNearRun();
  async function save() {
    if (unchanged()) return;
    const known = new Set(props.agents.map((agent) => agent.id));
    const agentIds = [
      ...props.status.agentIds.filter((id) => !known.has(id)),
      ...props.agents.filter((agent) => checked(agent.id)).map((agent) => agent.id),
    ];
    if (await run.run(() => props.actions.setAgents({ allAgents: allAgents(), agentIds }))) props.onClose();
  }
  return (
    <OwnerChangeDialog
      title={t("vault.near.agentsTitle")}
      submitLabel={label()}
      canSave={!unchanged()}
      sign={false}
      actions={props.actions}
      run={run}
      onClose={props.onClose}
      onSave={() => void save()}
    >
      <AllAgentsChoice checked={allAgents()} onChange={setAllAgents} />
      <Show when={!allAgents()}>
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
      </Show>
    </OwnerChangeDialog>
  );
}

const limitFor = (amountUsd: number) =>
  NEAR_RULE_DAILY_USD.find((limit) => limit >= amountUsd) ?? NEAR_RULE_DAILY_USD.at(-1) ?? 0;

export function NearDomainDialog(
  props: NearDialogProps & {
    mode: "always" | "edit";
    domain: string;
    limit?: number | undefined;
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
