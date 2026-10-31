import {
  AGENT_BACKUP_MODEL_LIMIT,
  type AgentBackupModelSettings,
  type AgentBackupModels,
  type AgentModelChoice,
  type AgentModelOption,
  agentProviderName,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type HostProviderAccounts,
  sameAgentModelChoice,
} from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Plus from "lucide-react-native/icons/plus";
import Trash2 from "lucide-react-native/icons/trash";
import { type ReactNode, useState } from "react";
import { Pressable, View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { useProviderAccountName, useProviderAccounts } from "@/features/agents/components/agent-runtime-fields";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { ProviderMark } from "@/features/servers/components/provider-mark";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import {
  type MobileAgent,
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** One model and account the agent can move to, as the backup model controls show it. */
interface BackupModelOption {
  key: string;
  choice: AgentModelChoice;
  label: string;
  /** False when the host has no such model now, or the account is not connected. The agent skips it. */
  ready: boolean;
}

/**
 * The backup models of an agent, read from and saved on its host. Only an owner or admin of a host
 * that serves `agent-backup-models-v1` reads them; the host checks the role again on every call.
 * The key is under "agent-info" and ends in "backup-models", so the host's `agents-changed` event reads
 * it again: a change made on desktop or another phone shows here while the page is open.
 */
export function useAgentBackupModels(agent: MobileAgent, enabled: boolean) {
  const workspace = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const canManage = useMobileWorkspaceSelector((current) => current.canManageAgentBackupModels(agent.serverId));
  const queryKey = queryKeys.agentRecord(queryScope, agent.serverId, agent.id, "backup-models");
  const settings = useQuery({
    queryKey,
    queryFn: () => workspace.loadAgentBackupModels(agent.id, agent.serverId),
    enabled: enabled && canManage,
    retry: false,
    // Another device can change these at any time, so a reopened page reads the host again.
    staleTime: 0,
  });
  return { queryKey, canManage, settings: canManage ? (settings.data ?? null) : null };
}

function useBackupModelSummary() {
  const { t } = useText();
  return (value: AgentBackupModels | null) => {
    const mode = t(
      value?.automatic ? "mobile.agent.backupModels.valueAutomatic" : "mobile.agent.backupModels.valueAsk",
    );
    const count = value?.order.length ?? 0;
    return count > 0 ? t("mobile.agent.backupModels.valueCount", { mode, count }) : mode;
  };
}

/** Agent info > Brain: the row that opens the backup models page. Hidden for a member and an older host. */
export function AgentBackupModelsRow({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const summary = useBackupModelSummary();
  const { canManage, settings } = useAgentBackupModels(agent, available);
  if (!canManage || !settings) return null;
  return (
    <SettingsRow
      supportingText={summary(settings.backupModels)}
      onPress={() =>
        router.push({
          pathname: "/agent-info/[agentId]/backup-models",
          params: { agentId: agent.id, serverId: agent.serverId },
        })
      }
    >
      <Typography.Paragraph>{t("mobile.agent.backupModels.title")}</Typography.Paragraph>
    </SettingsRow>
  );
}

function move<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const item = list[index];
  const other = index + by;
  if (item === undefined || other < 0 || other >= list.length) return [...list];
  const rest = list.filter((_, position) => position !== index);
  return [...rest.slice(0, other), item, ...rest.slice(other)];
}

function choiceKey(choice: AgentModelChoice): string {
  return `${choice.provider}\u0000${choice.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID}\u0000${choice.model}`;
}

/** Builds the options from the host's models and accounts, with the same rules as desktop. */
function useBackupModelOptions(models: readonly AgentModelOption[] | undefined, accounts: HostProviderAccounts | null) {
  const { t } = useText();
  const accountName = useProviderAccountName();
  const option = (choice: AgentModelChoice): BackupModelOption => {
    const accountId = choice.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
    const providerAccounts = accounts?.providers.find((entry) => entry.provider === choice.provider)?.accounts;
    const accountIndex = providerAccounts?.findIndex((candidate) => candidate.id === accountId) ?? -1;
    const account = providerAccounts?.[accountIndex];
    const model = models?.find((candidate) => candidate.provider === choice.provider && candidate.id === choice.model);
    const modelName = model?.name ?? choice.model;
    const showsAccount = providerAccounts !== undefined && providerAccounts.length > 1;
    return {
      key: choiceKey(choice),
      choice,
      label:
        showsAccount && account
          ? t("mobile.agent.backupModels.withAccount", {
              model: modelName,
              account: accountName(account, accountIndex),
            })
          : modelName,
      ready:
        model !== undefined &&
        (providerAccounts === undefined ? accountId === DEFAULT_PROVIDER_ACCOUNT_ID : account?.state === "connected"),
    };
  };
  const all = (exclude: readonly AgentModelChoice[]): BackupModelOption[] =>
    (models ?? []).flatMap((model) => {
      const accountIds = accounts?.providers
        .find((entry) => entry.provider === model.provider)
        ?.accounts.map((account) => account.id) ?? [DEFAULT_PROVIDER_ACCOUNT_ID];
      return accountIds.flatMap((accountId) => {
        const choice: AgentModelChoice = {
          provider: model.provider,
          model: model.id,
          ...(accountId === DEFAULT_PROVIDER_ACCOUNT_ID ? {} : { providerAccountId: accountId }),
        };
        return exclude.some((other) => sameAgentModelChoice(other, choice)) ? [] : [option(choice)];
      });
    });
  return { option, all };
}

/**
 * The saved settings, the options and the save of the backup models page and its model picker.
 * Null until the host answers, and for a member or an older host.
 */
function useBackupModelEditor(agent: MobileAgent, available: boolean) {
  const { t, errorMessage } = useText();
  const workspace = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const { queryKey, canManage, settings } = useAgentBackupModels(agent, available);
  const { accounts } = useProviderAccounts(agent, available);
  const models = useQuery({
    queryKey: queryKeys.agentModels(queryScope, agent.serverId),
    queryFn: () => workspace.loadAgentModels(agent.serverId),
    enabled: available && canManage,
    retry: false,
  });
  const { option, all } = useBackupModelOptions(models.data, accounts);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canManage || !settings) return { canManage, editor: null };

  const current = settings;
  const automatic = current.backupModels?.automatic === true;
  const order = current.backupModels?.order ?? [];
  // The agent's own model: the one it went back to, while a usage limit holds it on a backup.
  const ownAccount =
    accounts?.agents.find((entry) => entry.agentId === agent.id)?.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
  const own: AgentModelChoice | null =
    current.usageLimitReturn ??
    (agent.provider && agent.model
      ? {
          provider: agent.provider,
          model: agent.model,
          ...(ownAccount === DEFAULT_PROVIDER_ACCOUNT_ID ? {} : { providerAccountId: ownAccount }),
        }
      : null);
  const ownModel = own
    ? (models.data?.find((candidate) => candidate.provider === own.provider && candidate.id === own.model)?.name ??
      own.model)
    : (agent.model ?? "");

  /** Resolves true when the host saved the change. A failure puts the old value back and shows why. */
  async function save(next: AgentBackupModels): Promise<boolean> {
    // Null returns the agent to the default: ask, with no saved order.
    const backupModels = next.automatic || next.order.length > 0 ? next : null;
    setSaving(true);
    setError(null);
    const optimistic: AgentBackupModelSettings = { ...current, backupModels };
    queryClient.setQueryData<AgentBackupModelSettings | null>(queryKey, optimistic);
    try {
      const saved = await workspace.updateAgentBackupModels({ agentId: agent.id, backupModels }, agent.serverId);
      queryClient.setQueryData<AgentBackupModelSettings | null>(queryKey, saved);
      void haptics.notification("success");
      return true;
    } catch (cause) {
      queryClient.setQueryData<AgentBackupModelSettings | null>(queryKey, current);
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.agent.host.failed")));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    canManage,
    editor: {
      automatic,
      order,
      ownModel,
      entries: order.map(option),
      addable: all(own ? [own, ...order] : order).filter((candidate) => candidate.ready),
      enabled: available && !saving,
      error,
      save,
    },
  };
}

function EditorStatus({ canManage, available }: { canManage: boolean; available: boolean }) {
  const { t } = useText();
  return (
    <Typography.Paragraph>
      {t(available && canManage ? "mobile.agent.edit.loading" : "mobile.agent.host.unsupported")}
    </Typography.Paragraph>
  );
}

function SaveError({ error }: { error: string | null }) {
  return error ? (
    <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
      {error}
    </Typography.Paragraph>
  ) : null;
}

/** Agent info > Backup models: what the agent does when a usage limit holds a message. */
export function AgentBackupModelsPage({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const [muted, danger] = useCSSVariable(["--openbot-text-grouped-secondary", "--openbot-danger-text"]);
  const { canManage, editor } = useBackupModelEditor(agent, available);
  if (!editor) return <EditorStatus canManage={canManage} available={available} />;
  const { automatic, order, ownModel, entries, addable, enabled, error, save } = editor;

  const iconButton = (label: string, disabled: boolean, onPress: () => void, icon: ReactNode) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        void haptics.selection();
        onPress();
      }}
      style={{ opacity: disabled ? 0.35 : 1 }}
    >
      {icon}
    </Pressable>
  );

  return (
    <>
      <Typography.Paragraph type="body-sm" className="px-4 text-grouped-secondary">
        {t(automatic ? "mobile.agent.backupModels.introAutomatic" : "mobile.agent.backupModels.intro", {
          model: ownModel,
          name: agent.name,
        })}
      </Typography.Paragraph>
      <SettingsSection>
        <SettingsRow>
          <SettingsSwitch
            value={!automatic}
            disabled={!enabled}
            label={t("mobile.agent.backupModels.ask")}
            dark={theme === "dark"}
            onValueChange={(ask) => void save({ automatic: !ask, order })}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        title={t("mobile.agent.backupModels.order")}
        footer={t("mobile.agent.backupModels.note", { model: ownModel, name: agent.name })}
      >
        {entries.length === 0 ? (
          <SettingsRow>
            <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
              {t("mobile.agent.backupModels.empty", { name: agent.name })}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {entries.map((entry, index) => (
          <SettingsRow
            key={entry.key}
            leading={
              <View className="flex-row items-center gap-2">
                <Typography type="body-sm" className="w-5 text-grouped-secondary">
                  {index + 1}
                </Typography>
                <View style={{ opacity: entry.ready ? 1 : 0.45 }}>
                  <ProviderMark provider={entry.choice.provider} size={20} />
                </View>
              </View>
            }
            supportingText={entry.ready ? undefined : t("mobile.agent.backupModels.unavailable")}
            trailing={
              <View className="flex-row items-center gap-4">
                {iconButton(
                  t("mobile.agent.backupModels.moveUp", { model: entry.label }),
                  !enabled || index === 0,
                  () => void save({ automatic, order: move(order, index, -1) }),
                  <ChevronUp size={20} color={String(muted)} />,
                )}
                {iconButton(
                  t("mobile.agent.backupModels.moveDown", { model: entry.label }),
                  !enabled || index === entries.length - 1,
                  () => void save({ automatic, order: move(order, index, 1) }),
                  <ChevronDown size={20} color={String(muted)} />,
                )}
                {iconButton(
                  t("mobile.agent.backupModels.remove", { model: entry.label }),
                  !enabled,
                  () => void save({ automatic, order: order.filter((_, position) => position !== index) }),
                  <Trash2 size={18} color={String(danger)} />,
                )}
              </View>
            }
          >
            <Typography.Paragraph numberOfLines={2} className={entry.ready ? undefined : "text-grouped-secondary"}>
              {entry.label}
            </Typography.Paragraph>
          </SettingsRow>
        ))}
        {order.length < AGENT_BACKUP_MODEL_LIMIT && addable.length > 0 ? (
          // A page, not a menu: OpenRouter lists hundreds of models, and the Android menu of the app does
          // not scroll a menu with sub-menus, so it went off the screen and its overlay held every touch.
          <SettingsRow
            disabled={!enabled}
            disclosure={false}
            leading={<Plus size={18} color={String(muted)} />}
            onPress={() =>
              router.push({
                pathname: "/agent-info/[agentId]/backup-model-picker",
                params: { agentId: agent.id, serverId: agent.serverId },
              })
            }
          >
            <Typography.Paragraph>{t("mobile.agent.backupModels.add")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <SaveError error={error} />
    </>
  );
}

/** Agent info > Backup models > Add backup model: every ready model, by provider, with a search. */
export function AgentBackupModelPicker({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const [query, setQuery] = useState("");
  const { canManage, editor } = useBackupModelEditor(agent, available);
  if (!editor) return <EditorStatus canManage={canManage} available={available} />;
  const { automatic, order, addable, enabled, error, save } = editor;
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  // The search also reads the provider and the model id, as on desktop.
  const matches = addable.filter((candidate) => {
    const text =
      `${candidate.label} ${agentProviderName(candidate.choice.provider)} ${candidate.choice.model}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
  const providers = Array.from(new Set(matches.map((candidate) => candidate.choice.provider)));
  const full = order.length >= AGENT_BACKUP_MODEL_LIMIT;

  return (
    <>
      <SheetFormField
        label={t("mobile.agent.backupModels.search")}
        hideLabel
        appearance="soft"
        placeholder={t("mobile.agent.backupModels.search")}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        value={query}
        onChangeText={setQuery}
      />
      {matches.length === 0 ? (
        <Typography.Paragraph className="px-4 text-grouped-secondary">
          {t("mobile.agent.backupModels.noMatches")}
        </Typography.Paragraph>
      ) : null}
      {providers.map((provider) => (
        <SettingsSection key={provider} title={agentProviderName(provider)}>
          {matches
            .filter((candidate) => candidate.choice.provider === provider)
            .map((candidate) => (
              <SettingsRow
                key={candidate.key}
                disabled={!enabled || full}
                disclosure={false}
                leading={<ProviderMark provider={provider} size={20} />}
                onPress={() => {
                  void save({ automatic, order: [...order, candidate.choice] }).then((saved) => {
                    if (saved && router.canGoBack()) router.back();
                  });
                }}
              >
                <Typography.Paragraph numberOfLines={2}>{candidate.label}</Typography.Paragraph>
              </SettingsRow>
            ))}
        </SettingsSection>
      ))}
      <SaveError error={error} />
    </>
  );
}
