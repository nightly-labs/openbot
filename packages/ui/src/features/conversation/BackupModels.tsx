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
  Button,
  Checkbox,
  ChevronDown,
  ChevronUp,
  ErrorReference,
  IconButton,
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
import { UiBlockCard } from "./ui-blocks/UiBlockCard";

export type BackupModelState = "ready" | "limit" | "unavailable";

export interface BackupModelOption {
  key: string;
  choice: AgentModelChoice;
  model: string;
  account: string | null;
  state: BackupModelState;
}

export interface BackupModelSource {
  modelOptions: readonly ClientAgentModelOption[];
  providers: AgentStatus["providers"];
  limited?: ((choice: AgentModelChoice) => boolean) | undefined;
  failed?: ((choice: AgentModelChoice) => boolean) | undefined;
}

export function backupModelOption(choice: AgentModelChoice, source: BackupModelSource): BackupModelOption {
  const accountId = choice.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
  const provider = source.providers?.find((status) => status.id === choice.provider);
  const accounts = provider?.accounts;
  const account = accounts?.find((candidate) => candidate.id === accountId);
  const model =
    source.modelOptions.find((option) => option.provider === choice.provider && option.id === choice.model) ??
    account?.models?.find((option) => option.id === choice.model);
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

export function backupModelOptions(
  source: BackupModelSource,
  exclude: readonly AgentModelChoice[],
): BackupModelOption[] {
  return source.modelOptions.flatMap((model) => {
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
  ownModel: string;
  own: AgentModelChoice;
  value: AgentBackupModels | null;
  source: BackupModelSource;
  onChange: (next: AgentBackupModels | null) => void;
}

export function BackupModelsPage(props: BackupModelsPageProps) {
  const { t } = useText();
  const label = useOptionLabel();
  const automatic = () => props.value?.automatic === true;
  const order = () => props.value?.order ?? [];
  const entries = () =>
    order().map((choice) => {
      const option = backupModelOption(choice, props.source);
      return option.state === "ready" && props.source.failed?.(choice)
        ? { ...option, state: "unavailable" as const }
        : option;
    });
  const addable = () =>
    backupModelOptions(props.source, [props.own, ...order()]).filter((option) => option.state !== "unavailable");
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
  provider: AgentProviderId;
  model?: string | undefined;
  agentName?: string | undefined;
  resetsAt: number | null;
  options: readonly BackupModelOption[];
  rememberable?: boolean;
  onSend: (option: BackupModelOption, remember: boolean) => Promise<void>;
  onWait: () => void;
}

export function UsageLimitAskCard(props: UsageLimitAskCardProps) {
  const { t, format, errorMessage } = useText();
  const label = useOptionLabel();
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
    const name = props.agentName;
    if (name)
      return reset
        ? t("chat.usageLimit.channelBodyReset", { name, reset })
        : t("chat.usageLimit.channelBody", { name });
    return reset ? t("chat.usageLimit.bodyReset", { reset }) : t("chat.usageLimit.body");
  };
  async function send(option: BackupModelOption): Promise<void> {
    setFailure(null);
    setSending(true);
    try {
      await props.onSend(option, props.rememberable !== false && remember());
    } catch (error) {
      setFailure({ message: errorMessage(error, t("chat.usageLimit.failed")), reference: errorReference(error) });
    } finally {
      setSending(false);
    }
  }
  return (
    <UiBlockCard
      class="usage-limit-ask-card"
      status="pending"
      title={
        props.model
          ? t("chat.usageLimit.modelTitle", { model: props.model })
          : t("chat.usageLimit.title", { provider: agentProviderName(props.provider) })
      }
      subtitle={body()}
      busy={sending()}
      waiting
      waitingLabel={t("chat.usageLimit.onHold")}
      footerStart={
        <Select<BackupModelOption>
          class="ui-block-footer-select"
          sameWidth={false}
          placement="bottom-start"
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
          <SelectTrigger aria-label={t("chat.usageLimit.sendTo")} size="sm">
            <SelectValue<BackupModelOption>>
              {(state) => {
                const option = state.selectedOption();
                return option ? <OptionContent option={option} /> : null;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent />
        </Select>
      }
      actions={
        <>
          <Button type="button" variant="secondary" size="sm" disabled={sending()} onClick={() => props.onWait()}>
            {t("chat.usageLimit.wait")}
          </Button>
          <Show when={picked()}>
            {(option) => (
              <Button type="button" size="sm" disabled={sending()} onClick={() => void send(option())}>
                {t("chat.usageLimit.send", { model: option().model })}
              </Button>
            )}
          </Show>
        </>
      }
    >
      <Show when={props.rememberable !== false}>
        <label class="usage-limit-ask-remember" for={rememberId}>
          <Checkbox
            id={rememberId}
            checked={remember()}
            disabled={sending()}
            onChange={(event) => setRemember(event.currentTarget.checked)}
          />
          {t("chat.usageLimit.remember")}
        </label>
      </Show>
      <Show when={failure()}>
        {(details) => (
          <p class="usage-limit-ask-error" role="alert">
            {details().message}
            <ErrorReference reference={details().reference} />
          </p>
        )}
      </Show>
    </UiBlockCard>
  );
}

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

export function rememberedBackupModels(
  choice: AgentModelChoice,
  backupModels: AgentBackupModels | undefined,
): AgentBackupModels {
  const rest = (backupModels?.order ?? []).filter((other) => !sameAgentModelChoice(other, choice));
  return {
    automatic: true,
    order: [choice, ...rest].slice(0, AGENT_BACKUP_MODEL_LIMIT).map((other) => ({ ...other })),
  };
}
