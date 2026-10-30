import { ProviderLogo } from "@openbot/brand";
import { agentProviderName, isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import {
  AGENT_BACKUP_MODEL_LIMIT,
  type AgentBackupModels,
  type AgentModelChoice,
  type AgentProviderId,
  type AgentStatus,
  type ClientAgentModelOption,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  sameAgentModelChoice,
} from "@openbot/contracts/ipc";
import {
  ArrowLeftRight,
  Badge,
  Button,
  Checkbox,
  ChevronDown,
  ChevronUp,
  ErrorReference,
  IconButton,
  LoaderCircle,
  Plus,
  SearchSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Text,
  Trash2,
} from "@openbot/ui";
import { SettingsLinkGroup } from "@openbot/ui/components/SettingsPanel";
import { errorReference } from "@openbot/user-errors";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import { providerAccountName } from "../../components/provider-accounts";
import { currentText, useText } from "../../text";
import { formatUsageReset } from "./ComposerNotice";

/** `limit`: a usage limit holds it now. `unavailable`: its provider or account cannot run it now. */
export type BackupModelState = "ready" | "limit" | "unavailable";

/** One model and account an agent can move to, as the backup model controls show it. */
export interface BackupModelOption {
  key: string;
  choice: AgentModelChoice;
  model: string;
  /** Set only when the provider has more than one account, so the user can tell them apart. */
  account: string | null;
  state: BackupModelState;
}

/** What the options are built from: the host's models and providers, and its usage limits. */
export interface BackupModelSource {
  modelOptions: readonly ClientAgentModelOption[];
  providers: AgentStatus["providers"];
  /** Whether a usage limit holds this model and account now. */
  limited?: ((choice: AgentModelChoice) => boolean) | undefined;
}

export function backupModelOption(choice: AgentModelChoice, source: BackupModelSource): BackupModelOption {
  const accountId = choice.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
  const provider = source.providers?.find((status) => status.id === choice.provider);
  const accounts = provider?.accounts;
  const account = accounts?.find((candidate) => candidate.id === accountId);
  const model = source.modelOptions.find((option) => option.provider === choice.provider && option.id === choice.model);
  const usable =
    provider !== undefined &&
    provider.off !== true &&
    provider.state === "available" &&
    model !== undefined &&
    (accounts === undefined ? accountId === DEFAULT_PROVIDER_ACCOUNT_ID : account?.state === "connected");
  return {
    key: `${choice.provider}\u0000${accountId}\u0000${choice.model}`,
    choice,
    model: model?.name ?? choice.model,
    account: accounts && accounts.length > 1 ? providerAccountName(currentText().t, accounts, accountId) : null,
    state: !usable ? "unavailable" : source.limited?.(choice) ? "limit" : "ready",
  };
}

/** Every model of every provider and account the host has, except the ones in `exclude`. */
export function backupModelOptions(
  source: BackupModelSource,
  exclude: readonly AgentModelChoice[],
): BackupModelOption[] {
  return source.modelOptions.flatMap((model) => {
    // A provider that this build does not know cannot be a backup: its model cannot be chosen here.
    const modelProvider = model.provider;
    if (!isKnownAgentProvider(modelProvider)) return [];
    const provider = source.providers?.find((status) => status.id === modelProvider);
    const accountIds = provider?.accounts?.map((account) => account.id) ?? [DEFAULT_PROVIDER_ACCOUNT_ID];
    return accountIds.flatMap((accountId) => {
      const choice: AgentModelChoice = {
        provider: modelProvider,
        model: model.id,
        ...(accountId === DEFAULT_PROVIDER_ACCOUNT_ID ? {} : { providerAccountId: accountId }),
      };
      return exclude.some((other) => sameAgentModelChoice(other, choice)) ? [] : [backupModelOption(choice, source)];
    });
  });
}

function useOptionLabel() {
  const { t } = useText();
  return (option: BackupModelOption) =>
    option.account
      ? t("agentSettings.backupModels.withAccount", { model: option.model, account: option.account })
      : option.model;
}

function OptionLogo(props: { provider: AgentProviderId }) {
  return (
    <span class="backup-model-logo" aria-hidden="true">
      <ProviderLogo provider={props.provider} />
    </span>
  );
}

function OptionContent(props: { option: BackupModelOption }) {
  const label = useOptionLabel();
  return (
    <span class="backup-model-option">
      <OptionLogo provider={props.option.choice.provider} />
      {label(props.option)}
    </span>
  );
}

function move<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const item = list[index];
  const other = index + by;
  if (item === undefined || other < 0 || other >= list.length) return [...list];
  const rest = list.filter((_, position) => position !== index);
  return [...rest.slice(0, other), item, ...rest.slice(other)];
}

export interface BackupModelsPageProps {
  agentName: string;
  /** The agent's own model: the one it leaves at a usage limit and goes back to. */
  ownModel: string;
  own: AgentModelChoice;
  value: AgentBackupModels | null;
  source: BackupModelSource;
  /** Null returns the agent to the default: ask, with no saved order. */
  onChange: (next: AgentBackupModels | null) => void;
}

/** The agent settings page that sets what the agent does when a usage limit holds a message. */
export function BackupModelsPage(props: BackupModelsPageProps) {
  const { t } = useText();
  const label = useOptionLabel();
  const automatic = () => props.value?.automatic === true;
  const order = () => props.value?.order ?? [];
  const entries = () => order().map((choice) => backupModelOption(choice, props.source));
  const addable = () =>
    backupModelOptions(props.source, [props.own, ...order()]).filter((option) => option.state !== "unavailable");
  // The value can come from a store, and IPC cannot clone a store proxy, so each choice is copied.
  const save = (next: AgentBackupModels) =>
    props.onChange(
      next.automatic || next.order.length > 0
        ? { automatic: next.automatic, order: next.order.map((choice) => ({ ...choice })) }
        : null,
    );
  return (
    <div class="backup-models-page">
      <Text as="p" variant="body-sm" tone="secondary" class="backup-models-intro">
        {t(automatic() ? "agentSettings.backupModels.introAutomatic" : "agentSettings.backupModels.intro", {
          model: props.ownModel,
          name: props.agentName,
        })}
      </Text>
      <SettingsLinkGroup inset class="agent-settings-runtime-rows">
        <div class="agent-settings-switch-row">
          <span class="settings-link-label">
            <span class="settings-link-icon">
              <ArrowLeftRight aria-hidden="true" />
            </span>
            {t("agentSettings.backupModels.ask")}
          </span>
          <Switch
            size="sm"
            aria-label={t("agentSettings.backupModels.ask")}
            checked={!automatic()}
            onChange={(ask) => save({ automatic: !ask, order: order() })}
          />
        </div>
      </SettingsLinkGroup>
      <SettingsLinkGroup inset class="agent-settings-runtime-rows" title={t("agentSettings.backupModels.order")}>
        <Show
          when={entries().length > 0}
          fallback={
            <Text as="p" variant="body-sm" tone="muted" class="backup-models-empty">
              {t("agentSettings.backupModels.empty", { name: props.agentName })}
            </Text>
          }
        >
          <ol class="backup-models-list" aria-label={t("agentSettings.backupModels.listLabel")}>
            <For each={entries()}>
              {(entry, index) => (
                <li class="backup-models-row" data-state={entry.state}>
                  <span class="backup-models-number" aria-hidden="true">
                    {index() + 1}
                  </span>
                  <OptionLogo provider={entry.choice.provider} />
                  <span class="backup-models-text">
                    <span class="backup-models-name">{label(entry)}</span>
                    <Show when={entry.state !== "ready"}>
                      <span class="backup-models-state">
                        {t(
                          entry.state === "limit"
                            ? "agentSettings.backupModels.limited"
                            : "agentSettings.backupModels.unavailable",
                        )}
                      </span>
                    </Show>
                  </span>
                  <span class="backup-models-actions">
                    <IconButton
                      variant="ghost"
                      size="icon-xs"
                      label={t("agentSettings.backupModels.moveUp", { model: label(entry) })}
                      disabled={index() === 0}
                      onClick={() => save({ automatic: automatic(), order: move(order(), index(), -1) })}
                    >
                      <ChevronUp />
                    </IconButton>
                    <IconButton
                      variant="ghost"
                      size="icon-xs"
                      label={t("agentSettings.backupModels.moveDown", { model: label(entry) })}
                      disabled={index() === entries().length - 1}
                      onClick={() => save({ automatic: automatic(), order: move(order(), index(), 1) })}
                    >
                      <ChevronDown />
                    </IconButton>
                    <IconButton
                      variant="ghost"
                      size="icon-xs"
                      label={t("agentSettings.backupModels.remove", { model: label(entry) })}
                      onClick={() =>
                        save({
                          automatic: automatic(),
                          order: order().filter((_, position) => position !== index()),
                        })
                      }
                    >
                      <Trash2 />
                    </IconButton>
                  </span>
                </li>
              )}
            </For>
          </ol>
        </Show>
        <Show when={order().length < AGENT_BACKUP_MODEL_LIMIT && addable().length > 0}>
          <SearchSelect<BackupModelOption>
            class="agent-settings-runtime-row"
            aria-label={t("agentSettings.backupModels.add")}
            options={addable()}
            value={null}
            optionValue={(option) => option.key}
            label={label}
            // OpenRouter lists hundreds of models, so the search also reads the provider and the model id.
            optionTextValue={(option) =>
              `${label(option)} ${agentProviderName(option.choice.provider)} ${option.choice.model}`
            }
            itemContent={(option) => <OptionContent option={option} />}
            onChange={(option) => save({ automatic: automatic(), order: [...order(), option.choice] })}
          >
            <span class="settings-link-icon">
              <Plus aria-hidden="true" />
            </span>
            <span class="agent-settings-runtime-label">{t("agentSettings.backupModels.add")}</span>
          </SearchSelect>
        </Show>
      </SettingsLinkGroup>
      <Text as="p" class="agent-settings-runtime-note" variant="caption" tone="muted">
        {t("agentSettings.backupModels.note", { model: props.ownModel, name: props.agentName })}
      </Text>
    </div>
  );
}

export interface UsageLimitAskCardProps {
  /** The provider whose usage limit holds the message. */
  provider: AgentProviderId;
  /** Epoch seconds, or null when the provider has not said. */
  resetsAt: number | null;
  /** The models that can take the message now, the first one preselected. */
  options: readonly BackupModelOption[];
  /** Moves the agent. `remember` saves the choice first in the order and switches without asking next time. */
  onSend: (option: BackupModelOption, remember: boolean) => Promise<void>;
  onWait: () => void;
}

/** In the chat: a usage limit holds a message that has not started. The user moves it or waits. */
export function UsageLimitAskCard(props: UsageLimitAskCardProps) {
  const { t, format, errorMessage } = useText();
  const label = useOptionLabel();
  const titleId = createUniqueId();
  const rememberId = createUniqueId();
  const [choice, setChoice] = createSignal<BackupModelOption>();
  const picked = () => {
    const current = choice();
    return (current && props.options.find((option) => option.key === current.key)) ?? props.options[0];
  };
  const [remember, setRemember] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [failure, setFailure] = createSignal<{ message: string; reference: string | null } | null>(null);
  const body = () => {
    const reset = formatUsageReset(props.resetsAt, format);
    return reset ? t("chat.usageLimit.bodyReset", { reset }) : t("chat.usageLimit.body");
  };
  async function send(option: BackupModelOption): Promise<void> {
    setFailure(null);
    setSending(true);
    try {
      await props.onSend(option, remember());
    } catch (error) {
      setFailure({ message: errorMessage(error, t("chat.usageLimit.failed")), reference: errorReference(error) });
    } finally {
      setSending(false);
    }
  }
  return (
    <section class="conversation-interaction-card usage-limit-ask-card" aria-labelledby={titleId}>
      <header class="conversation-interaction-header">
        <strong id={titleId}>{t("chat.usageLimit.title", { provider: agentProviderName(props.provider) })}</strong>
        <Badge variant="warning-light" class="conversation-interaction-status" role="status">
          <LoaderCircle class="conversation-interaction-spinner" data-icon="inline-start" aria-hidden="true" />
          {t("chat.usageLimit.onHold")}
        </Badge>
      </header>
      <p class="usage-limit-ask-body">{body()}</p>
      <Select<BackupModelOption>
        class="usage-limit-ask-select"
        options={[...props.options]}
        optionValue="key"
        optionTextValue={label}
        value={picked() ?? null}
        disabled={sending()}
        onChange={(option) => {
          if (option) setChoice(option);
        }}
        itemComponent={(item) => (
          <SelectItem item={item.item}>
            <OptionContent option={item.item.rawValue} />
          </SelectItem>
        )}
      >
        <SelectTrigger aria-label={t("chat.usageLimit.sendTo")}>
          <SelectValue<BackupModelOption>>
            {(state) => {
              const option = state.selectedOption();
              return option ? <OptionContent option={option} /> : null;
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent />
      </Select>
      <label class="usage-limit-ask-remember" for={rememberId}>
        <Checkbox
          id={rememberId}
          checked={remember()}
          disabled={sending()}
          onChange={(event) => setRemember(event.currentTarget.checked)}
        />
        {t("chat.usageLimit.remember")}
      </label>
      <Show when={failure()}>
        {(details) => (
          <p class="usage-limit-ask-error" role="alert">
            {details().message}
            <ErrorReference reference={details().reference} />
          </p>
        )}
      </Show>
      <div class="usage-limit-ask-actions">
        <Button type="button" variant="outline" disabled={sending()} onClick={() => props.onWait()}>
          {t("chat.usageLimit.wait")}
        </Button>
        <Show when={picked()}>
          {(option) => (
            <Button type="button" loading={sending()} onClick={() => void send(option())}>
              {t("chat.usageLimit.send", { model: option().model })}
            </Button>
          )}
        </Show>
      </div>
    </section>
  );
}

/** The ready options for the ask card: the saved order first, then every other ready model. */
export function usageLimitAskOptions(
  own: AgentModelChoice,
  backupModels: AgentBackupModels | undefined,
  source: BackupModelSource,
): BackupModelOption[] {
  const saved = (backupModels?.order ?? []).filter((choice) => !sameAgentModelChoice(choice, own));
  return [
    ...saved.map((choice) => backupModelOption(choice, source)),
    ...backupModelOptions(source, [own, ...saved]),
  ].filter((option) => option.state === "ready");
}

/** The saved order after the user chose `choice` with "switch without asking": it goes first. */
export function rememberedBackupModels(
  choice: AgentModelChoice,
  backupModels: AgentBackupModels | undefined,
): AgentBackupModels {
  const rest = (backupModels?.order ?? []).filter((other) => !sameAgentModelChoice(other, choice));
  // Copies, as in `BackupModelsPage`: the saved order can come from a store, and IPC cannot clone a proxy.
  return {
    automatic: true,
    order: [choice, ...rest].slice(0, AGENT_BACKUP_MODEL_LIMIT).map((other) => ({ ...other })),
  };
}
