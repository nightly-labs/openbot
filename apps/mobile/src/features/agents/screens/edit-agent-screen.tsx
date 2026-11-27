import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  agentPermissionLevel,
  canAdministerServer,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type HostProviderAccounts,
  type UpdateAgentInput,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import BookBookmark from "lucide-react-native/icons/book-bookmark";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import Cpu from "lucide-react-native/icons/cpu";
import FileText from "lucide-react-native/icons/file-text";
import Folder from "lucide-react-native/icons/folder";
import Gauge from "lucide-react-native/icons/gauge";
import Pencil from "lucide-react-native/icons/pencil";
import Puzzle from "lucide-react-native/icons/puzzle";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import Table2 from "lucide-react-native/icons/table-2";
import Upload from "lucide-react-native/icons/upload";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import {
  AgentAccessFields,
  PERMISSION_LABEL,
  useAgentAdminSettings,
} from "@/features/agents/components/agent-access-fields";
import { AgentAppearancePicker, type AgentColorValue } from "@/features/agents/components/agent-appearance-picker";
import {
  AgentBackupModelPicker,
  AgentBackupModelsPage,
  AgentBackupModelsRow,
} from "@/features/agents/components/agent-backup-models";
import { AgentBrowserProfileRow } from "@/features/agents/components/agent-browser-profile";
import {
  AgentDeleteHistoryRow,
  AgentNewChatSection,
  AgentNotificationLevelRow,
} from "@/features/agents/components/agent-chat-settings";
import { AgentDeleteSection } from "@/features/agents/components/agent-delete-section";
import { AgentFolderBrowser, AgentFolders, AgentFoldersRow } from "@/features/agents/components/agent-folders";
import {
  AgentBuiltinMemoryField,
  AgentBusyMessageField,
  AgentHostPermissionFields,
  AgentNewChatAllowedField,
  AgentPlanCardField,
  AgentTaskLimitField,
} from "@/features/agents/components/agent-host-fields";
import { AgentInformation } from "@/features/agents/components/agent-information";
import { AgentInstructionsFileEditor } from "@/features/agents/components/agent-instructions-file";
import { type AgentPhotoDraft, AgentPhotoPicker } from "@/features/agents/components/agent-photo-picker";
import { AgentPublish } from "@/features/agents/components/agent-publish";
import { AgentRuntimeFields, useProviderAccounts } from "@/features/agents/components/agent-runtime-fields";
import { AgentSessionSettingsSection } from "@/features/agents/components/agent-session-settings";
import { AgentSharedTables } from "@/features/agents/components/agent-shared-tables";
import { AgentTasksRow } from "@/features/agents/components/agent-tasks-row";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { InstructionsLimit, instructionsTooLong } from "@/features/agents/components/instructions-limit";
import { poolAccountModels } from "@/features/agents/model/agent-model-picker";
import { useAgentAccessLevel } from "@/features/servers/model/use-server-roles";
import { SettingsGroupRow, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import {
  type MobileAgent,
  type MobileServer,
  useMobileWorkspace,
} from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { SaveError } from "@/shared/components/save-error";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useDiscardGuard } from "@/shared/lib/use-discard-guard";

type AgentEdits = Pick<
  UpdateAgentInput,
  | "name"
  | "title"
  | "description"
  | "avatarSeed"
  | "avatarHue"
  | "avatarColor"
  | "provider"
  | "model"
  | "reasoningEffort"
>;

type AgentPage =
  | "info"
  | "appearance"
  | "usage"
  | "memories"
  | "skills"
  | "files"
  | "instructions"
  | "routines"
  | "tables"
  | "publish"
  | "runtime"
  | "backup-models"
  | "backup-model-picker"
  | "permissions"
  | "folders"
  | "folder-browser"
  | "advanced"
  | "memory"
  | "routine";

export function EditAgentScreen({ page = "info" }: { page?: AgentPage }) {
  const { t } = useText();
  const { agentId, serverId } = useLocalSearchParams<{ agentId: string; serverId?: string }>();
  const workspace = useMobileWorkspace();
  const [hostId] = useState(serverId ?? workspace.activeServer.id);
  const agent = workspace.agents.find((candidate) => candidate.id === agentId && candidate.serverId === hostId);
  const host = workspace.servers.find((candidate) => candidate.id === hostId);
  const lastAgent = useRef(agent);
  if (agent) lastAgent.current = agent;
  const displayed = agent ?? lastAgent.current;
  if (displayed) {
    return <AgentForm agent={displayed} host={host} available={Boolean(agent && showsOnline(host))} page={page} />;
  }
  return (
    <SheetScrollView className="bg-sheet" contentContainerClassName="p-5 pb-safe-offset-5">
      <Typography.Paragraph>
        {t(host?.initialConnectionPending ? "mobile.agent.edit.loading" : "mobile.agent.edit.gone")}
      </Typography.Paragraph>
    </SheetScrollView>
  );
}

function AgentForm({
  agent,
  host,
  available,
  page,
}: {
  agent: MobileAgent;
  host: MobileServer | undefined;
  available: boolean;
  page: AgentPage;
}) {
  const { t, errorMessage } = useText();
  const {
    updateAgent,
    setAgentAvatar,
    canManageSharedTables,
    canPublishAgent,
    canStartNewChat,
    canDeleteChatHistory,
    canManageAgentInstructions,
    canManageAgentAccess,
    canManageAgentHostSettings,
    canManageAgentTaskLimit,
    canManageAgentNewChat,
    canManageAgentPlanCard,
    canManageAgentBuiltinMemory,
    canManageBrowserProfiles,
    canManageAgentFolders,
    canSetAgentNotificationLevel,
    setAgentProviderAccount,
  } = useMobileWorkspace();
  const queryClient = useQueryClient();
  const { settings: adminSettings } = useAgentAdminSettings(
    agent,
    host,
    available && (page === "info" || page === "runtime"),
  );
  const showPermissions = canManageAgentAccess(agent.serverId) || canManageAgentHostSettings(agent.serverId);
  const showFolders = canManageAgentFolders(agent.serverId);
  const showNotificationLevel = agent.notifications !== undefined && canSetAgentNotificationLevel(agent.serverId);
  const accessLevel = useAgentAccessLevel(agent.serverId, agent.id);
  const showDeleteHistory = canDeleteChatHistory(agent.serverId) && accessLevel === "manage";
  const showBehavior =
    canManageAgentHostSettings(agent.serverId) ||
    canManageAgentTaskLimit(agent.serverId) ||
    canManageAgentNewChat(agent.serverId) ||
    canManageAgentPlanCard(agent.serverId) ||
    canManageAgentBuiltinMemory(agent.serverId);
  const showWorkspace = Boolean(agent.workspacePath) || canManageBrowserProfiles(agent.serverId);
  const showNewChat = canStartNewChat(agent.serverId) && accessLevel !== "view";
  const showChatActions = showNewChat || showDeleteHistory;
  const showAdvanced = showBehavior || showWorkspace || showChatActions;
  const [edits, setEdits] = useState<AgentEdits>({});
  const foreground = useThemeColor("foreground");
  const [photo, setPhoto] = useState<AgentPhotoDraft | null | undefined>();
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const { queryKey: accountsKey, accounts: hostAccounts } = useProviderAccounts(agent, available && page === "runtime");
  const [account, setAccount] = useState<string | undefined>();
  const provider = edits.provider ?? agent.provider;
  const providerAccounts = hostAccounts?.providers.find((entry) => entry.provider === provider)?.accounts ?? [];
  const savedAccount =
    provider === agent.provider
      ? (hostAccounts?.agents.find((entry) => entry.agentId === agent.id)?.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID)
      : DEFAULT_PROVIDER_ACCOUNT_ID;
  const accountChanged = account !== undefined && account !== savedAccount;
  const name = edits.name ?? agent.name;
  const title = edits.title ?? agent.title;
  const description = edits.description ?? agent.description;
  const avatarSeed = edits.avatarSeed ?? agent.avatarSeed;
  const avatarHue = edits.avatarHue === undefined ? agent.avatarHue : edits.avatarHue;
  const avatarColor = edits.avatarColor === undefined ? agent.avatarColor : edits.avatarColor;
  const photoChanged = photo !== undefined && (photo !== null || Boolean(agent.avatarUrl));
  const dirty =
    photoChanged ||
    name.trim() !== agent.name ||
    title.trim() !== agent.title ||
    description.trim() !== agent.description ||
    avatarSeed !== agent.avatarSeed ||
    avatarHue !== agent.avatarHue ||
    avatarColor !== agent.avatarColor ||
    (edits.provider !== undefined && edits.provider !== agent.provider) ||
    (edits.model !== undefined && edits.model !== agent.model) ||
    (edits.reasoningEffort !== undefined && edits.reasoningEffort !== agent.reasoningEffort) ||
    accountChanged;
  const nameMissing = page === "info" && !name.trim();
  const [triedSave, setTriedSave] = useState(false);
  const valid =
    page !== "info" ||
    (name.length <= INPUT_LIMITS.agentName &&
      title.length <= INPUT_LIMITS.agentTitle &&
      !instructionsTooLong(description));

  useDiscardGuard(dirty || saving || pickingPhoto, { busy: () => pending.current || pickingPhoto });

  function change(value: AgentEdits) {
    setEdits((current) => ({ ...current, ...value }));
    setError(null);
  }
  const changeAvatarSeed = useCallback((avatarSeed: string) => {
    setEdits((current) => ({ ...current, avatarSeed }));
    setError(null);
  }, []);
  const changeAvatarColor = useCallback((value: AgentColorValue) => {
    setEdits((current) => ({ ...current, avatarHue: value.hue, avatarColor: value.color }));
    setError(null);
  }, []);
  const hasPhoto = photo === undefined ? Boolean(agent.avatarUrl) : Boolean(photo);
  const photoField = useMemo(
    () => (
      <AgentPhotoPicker
        hasPhoto={hasPhoto}
        cropRoute={{
          pathname: "/agent-info/[agentId]/crop-photo",
          params: { agentId: agent.id, serverId: agent.serverId },
        }}
        disabled={saving || pickingPhoto}
        onChange={(value) => {
          setPhoto(value);
          setError(null);
        }}
        onBusyChange={setPickingPhoto}
      />
    ),
    [hasPhoto, agent.id, agent.serverId, saving, pickingPhoto],
  );

  async function submit(): Promise<void> {
    if (nameMissing) {
      setTriedSave(true);
      void haptics.notification("error");
      return;
    }
    if (!valid || !dirty || !available || pickingPhoto || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    const accountId = account === undefined || account === DEFAULT_PROVIDER_ACCOUNT_ID ? null : account;
    const accountWithRuntime =
      accountChanged &&
      (edits.provider !== undefined || edits.model !== undefined || edits.reasoningEffort !== undefined);
    try {
      if (Object.keys(edits).length > 0)
        await updateAgent(
          {
            agentId: agent.id,
            ...(edits.name === undefined ? {} : { name: name.trim() }),
            ...(edits.title === undefined ? {} : { title: title.trim() }),
            ...(edits.description === undefined ? {} : { description: description.trim() }),
            ...(edits.avatarSeed === undefined ? {} : { avatarSeed }),
            ...(edits.avatarHue === undefined ? {} : { avatarHue }),
            ...(edits.avatarColor === undefined ? {} : { avatarColor }),
            ...(edits.provider === undefined ? {} : { provider: edits.provider }),
            ...(edits.model === undefined ? {} : { model: edits.model }),
            ...(edits.reasoningEffort === undefined ? {} : { reasoningEffort: edits.reasoningEffort }),
            ...(accountWithRuntime ? { providerAccountId: accountId } : {}),
          },
          agent.serverId,
        );
      setEdits({});
      if (accountChanged || (edits.provider !== undefined && edits.provider !== agent.provider)) {
        if (accountChanged && !accountWithRuntime)
          await setAgentProviderAccount({ agentId: agent.id, accountId }, agent.serverId);
        setAccount(undefined);
        queryClient.setQueryData<HostProviderAccounts | null>(accountsKey, (current) =>
          current
            ? {
                ...current,
                agents: [
                  ...current.agents.filter((entry) => entry.agentId !== agent.id),
                  ...(accountId ? [{ agentId: agent.id, accountId }] : []),
                ],
              }
            : current,
        );
      }
      if (photoChanged) {
        await setAgentAvatar(agent.id, photo ?? null, agent.serverId);
        setPhoto(undefined);
      }
      void haptics.notification("success");
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.agent.edit.failed")));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName={page === "info" ? "gap-5 px-5 pb-safe-offset-5" : "gap-5 px-5 pb-safe-offset-5 pt-5"}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      {page === "usage" ? (
        <Stack.Screen options={{ title: t("mobile.agent.info.usage.agentTitle", { name: agent.name }) }} />
      ) : null}
      {page === "info" ? (
        <>
          <View className="gap-6">
            <Pressable
              className="self-center"
              accessibilityRole="button"
              accessibilityLabel={t("mobile.agent.edit.appearance")}
              onPress={() => {
                void haptics.impact("soft");
                router.push({
                  pathname: "/agent-info/[agentId]/appearance",
                  params: { agentId: agent.id, serverId: agent.serverId },
                });
              }}
            >
              <BloubAvatarPreview
                agentId={agent.id}
                serverId={agent.serverId}
                seed={avatarSeed}
                hue={avatarHue}
                color={avatarColor}
                size={112}
              />
              <View
                className={`absolute size-9 items-center justify-center rounded-full border-4 border-sheet bg-grouped ${agent.avatarUrl ? "right-0 bottom-0" : "right-3 bottom-3"}`}
              >
                <Pencil color={foreground} size={14} />
              </View>
            </Pressable>
            <SheetFormField
              label={t("mobile.agent.form.name")}
              appearance="soft"
              autoCapitalize="words"
              maxLength={INPUT_LIMITS.agentName}
              value={name}
              editable={!saving}
              error={triedSave && nameMissing ? t("mobile.agent.add.nameRequired") : undefined}
              onChangeText={(value) => change({ name: value })}
            />
          </View>
          <SheetFormField
            label={t("mobile.agent.edit.title")}
            appearance="soft"
            placeholder={t("mobile.agent.edit.titlePlaceholder")}
            maxLength={INPUT_LIMITS.agentTitle}
            value={title}
            editable={!saving}
            onChangeText={(value) => change({ title: value })}
          />
          <SheetFormField
            label={t("mobile.agent.edit.description")}
            appearance="soft"
            placeholder={t("mobile.agent.edit.descriptionPlaceholder")}
            multiline
            value={description}
            editable={!saving}
            onChangeText={(value) => change({ description: value })}
          />
          <InstructionsLimit text={description} />
        </>
      ) : null}
      {page === "appearance" ? (
        <AgentAppearancePicker
          agentId={agent.id}
          serverId={agent.serverId}
          imageUrl={photo === undefined ? undefined : (photo?.uri ?? null)}
          seed={avatarSeed}
          hue={avatarHue}
          color={avatarColor}
          name={name}
          nameField={null}
          showFaces={!hasPhoto}
          photoField={photoField}
          disabled={saving || pickingPhoto}
          onSeedChange={changeAvatarSeed}
          onColorChange={changeAvatarColor}
        />
      ) : null}
      {page === "runtime" ? (
        <AgentRuntimeFields
          serverId={agent.serverId}
          modelPickerRoute={{
            pathname: "/agent-info/[agentId]/model-picker",
            params: { agentId: agent.id, serverId: agent.serverId },
          }}
          available={available}
          saving={saving}
          provider={provider}
          foreignProvider={edits.provider === undefined ? agent.foreignProvider : undefined}
          model={edits.model ?? agent.model}
          reasoningEffort={edits.reasoningEffort ?? agent.reasoningEffort}
          accounts={providerAccounts}
          accountId={account ?? savedAccount}
          poolModels={accountChanged || !provider ? [] : poolAccountModels(hostAccounts, provider, savedAccount)}
          workspaceOnly={adminSettings ? workspaceAccessEnforced(adminSettings) : false}
          onChange={(value) => {
            change(value);
            if (value.provider !== undefined) setAccount(undefined);
          }}
          onAccountChange={(value) => {
            setAccount(value);
            setError(null);
          }}
          fastMode={
            provider === agent.provider && (edits.model ?? agent.model) === agent.model
              ? { agent, server: host, available }
              : undefined
          }
        />
      ) : null}
      {page === "backup-models" ? <AgentBackupModelsPage agent={agent} server={host} available={available} /> : null}
      {page === "backup-model-picker" ? (
        <AgentBackupModelPicker agent={agent} server={host} available={available} />
      ) : null}
      {page === "permissions" ? (
        <>
          <AgentAccessFields agent={agent} server={host} available={available} />
          <AgentHostPermissionFields agent={agent} server={host} available={available} />
        </>
      ) : null}
      {page === "advanced" ? (
        <>
          {showBehavior ? (
            <SettingsSection title={t("mobile.agent.advanced.behavior")} rowsDrawSeparators>
              <AgentBusyMessageField agent={agent} server={host} available={available} />
              <AgentTaskLimitField agent={agent} server={host} available={available} />
              <AgentNewChatAllowedField agent={agent} server={host} available={available} />
              <AgentPlanCardField agent={agent} server={host} available={available} />
              <AgentBuiltinMemoryField agent={agent} server={host} available={available} />
            </SettingsSection>
          ) : null}
          {showWorkspace ? (
            <SettingsSection title={t("mobile.agent.advanced.workspace")} rowsDrawSeparators>
              <AgentBrowserProfileRow agent={agent} />
              {agent.workspacePath ? (
                <SettingsGroupRow>
                  <SettingsRow description={t("mobile.agent.workspace.footer")}>
                    <Typography.Paragraph>{t("mobile.agent.workspace.title")}</Typography.Paragraph>
                    <Typography.Paragraph selectable type="body-xs" className="text-grouped-secondary">
                      {agent.workspacePath}
                    </Typography.Paragraph>
                  </SettingsRow>
                </SettingsGroupRow>
              ) : null}
            </SettingsSection>
          ) : null}
          {showChatActions ? (
            <SettingsSection title={t("mobile.agent.advanced.chat")} rowsDrawSeparators>
              {showNewChat ? <AgentNewChatSection agent={agent} available={available} grouped /> : null}
              {showDeleteHistory ? <AgentDeleteHistoryRow agent={agent} available={available} /> : null}
            </SettingsSection>
          ) : null}
        </>
      ) : null}
      {page === "folders" ? <AgentFolders agent={agent} host={host} available={available} /> : null}
      {page === "folder-browser" ? <AgentFolderBrowser agent={agent} available={available} /> : null}
      {page === "instructions" ? <AgentInstructionsFileEditor agent={agent} available={available} /> : null}
      {page === "tables" ? <AgentSharedTables agent={agent} available={available} /> : null}
      {page === "publish" ? <AgentPublish agent={agent} available={available} /> : null}
      {page === "usage" ||
      page === "memories" ||
      page === "skills" ||
      page === "files" ||
      page === "routines" ||
      page === "memory" ||
      page === "routine" ? (
        <AgentInformation agent={agent} available={available} section={page} />
      ) : null}
      {!available ? <Typography.Paragraph>{t("mobile.agent.edit.unavailable")}</Typography.Paragraph> : null}
      <SaveError error={error} />
      {page === "info" || page === "appearance" || page === "runtime" ? (
        <SheetSaveAction
          dirty={dirty}
          canSave={valid && available}
          pending={saving || pickingPhoto}
          onSave={() => void submit()}
        />
      ) : null}
      {page === "info" ? (
        <>
          <SettingsSection title={t("mobile.agent.groups.brain")}>
            <SettingsRow
              leading={<RowIcon icon={Cpu} />}
              supportingText={agent.model}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/runtime",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>{t("mobile.agent.runtime.model")}</Typography.Paragraph>
            </SettingsRow>
            <AgentBackupModelsRow agent={agent} server={host} available={available} />
          </SettingsSection>
          <SettingsSection title={t("mobile.agent.groups.knows")}>
            {canManageAgentInstructions(agent.serverId) ? (
              <SettingsRow
                leading={<RowIcon icon={FileText} />}
                onPress={() =>
                  router.push({
                    pathname: "/agent-info/[agentId]/instructions",
                    params: { agentId: agent.id, serverId: agent.serverId },
                  })
                }
              >
                <Typography.Paragraph>{t("mobile.agent.instructionsFile.title")}</Typography.Paragraph>
              </SettingsRow>
            ) : null}
            <SettingsRow
              leading={<RowIcon icon={BookBookmark} />}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/memories",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>{t("mobile.agent.info.memories.title")}</Typography.Paragraph>
            </SettingsRow>
            <SettingsRow
              leading={<RowIcon icon={Puzzle} />}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/skills",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>{t("mobile.agent.info.skills.title")}</Typography.Paragraph>
            </SettingsRow>
            <SettingsRow
              leading={<RowIcon icon={Folder} />}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/files",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>{t("mobile.agent.info.files.title")}</Typography.Paragraph>
            </SettingsRow>
            {canManageSharedTables(agent.serverId) ? (
              <SettingsRow
                leading={<RowIcon icon={Table2} />}
                onPress={() =>
                  router.push({
                    pathname: "/agent-info/[agentId]/tables",
                    params: { agentId: agent.id, serverId: agent.serverId },
                  })
                }
              >
                <Typography.Paragraph>{t("mobile.agent.tables.title")}</Typography.Paragraph>
              </SettingsRow>
            ) : null}
          </SettingsSection>
          <SettingsSection title={t("mobile.agent.groups.does")}>
            <AgentTasksRow agent={agent} />
            <SettingsRow
              leading={<RowIcon icon={CalendarClock} />}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/routines",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>{t("mobile.agent.info.routines.title")}</Typography.Paragraph>
            </SettingsRow>
            <SettingsRow
              leading={<RowIcon icon={Gauge} />}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/usage",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>{t("mobile.agent.info.usage.title")}</Typography.Paragraph>
            </SettingsRow>
            {canPublishAgent(agent.serverId) ? (
              <SettingsRow
                leading={<RowIcon icon={Upload} />}
                onPress={() =>
                  router.push({
                    pathname: "/agent-info/[agentId]/publish",
                    params: { agentId: agent.id, serverId: agent.serverId },
                  })
                }
              >
                <Typography.Paragraph>{t("mobile.agent.publish.title")}</Typography.Paragraph>
              </SettingsRow>
            ) : null}
          </SettingsSection>
          {host && canAdministerServer(host.role) ? (
            <AgentSessionSettingsSection key={`${agent.serverId}:${agent.id}`} agent={agent} available={available} />
          ) : null}
          {showPermissions || showFolders || showNotificationLevel || showAdvanced ? (
            <SettingsSection
              title={t("mobile.agent.groups.rules")}
              footer={showNotificationLevel ? t("mobile.agent.notificationLevel.footer") : undefined}
            >
              {showPermissions ? (
                <SettingsRow
                  leading={<RowIcon icon={ShieldCheck} />}
                  supportingText={adminSettings ? t(PERMISSION_LABEL[agentPermissionLevel(adminSettings)]) : undefined}
                  onPress={() =>
                    router.push({
                      pathname: "/agent-info/[agentId]/permissions",
                      params: { agentId: agent.id, serverId: agent.serverId },
                    })
                  }
                >
                  <Typography.Paragraph>{t("mobile.agent.permissions.title")}</Typography.Paragraph>
                </SettingsRow>
              ) : null}
              {showFolders ? <AgentFoldersRow agent={agent} host={host} available={available} /> : null}
              {showNotificationLevel ? <AgentNotificationLevelRow agent={agent} /> : null}
              {showAdvanced ? (
                <SettingsRow
                  leading={<RowIcon icon={SlidersHorizontal} />}
                  onPress={() =>
                    router.push({
                      pathname: "/agent-info/[agentId]/advanced",
                      params: { agentId: agent.id, serverId: agent.serverId },
                    })
                  }
                >
                  <Typography.Paragraph>{t("mobile.agent.advanced.title")}</Typography.Paragraph>
                </SettingsRow>
              ) : null}
            </SettingsSection>
          ) : null}
          {host && canAdministerServer(host.role) ? (
            <AgentDeleteSection agent={agent} disabled={!available || saving || dirty} />
          ) : null}
        </>
      ) : null}
    </SheetScrollView>
  );
}
