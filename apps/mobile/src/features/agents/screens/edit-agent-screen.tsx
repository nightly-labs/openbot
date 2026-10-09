import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentAccess, AvatarHue, UpdateAgentInput } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Pencil } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { AgentAccessFields, useAgentAdminSettings } from "@/features/agents/components/agent-access-fields";
import { AgentAppearancePicker } from "@/features/agents/components/agent-appearance-picker";
import { AgentNewChatSection, AgentNotificationsRow } from "@/features/agents/components/agent-chat-settings";
import { AgentBusyMessageField, AgentHostPermissionFields } from "@/features/agents/components/agent-host-fields";
import { AgentInformation } from "@/features/agents/components/agent-information";
import { type AgentPhotoDraft, AgentPhotoPicker } from "@/features/agents/components/agent-photo-picker";
import { AgentPublish } from "@/features/agents/components/agent-publish";
import { AgentRuntimeFields } from "@/features/agents/components/agent-runtime-fields";
import { AgentSessionSettingsSection } from "@/features/agents/components/agent-session-settings";
import { AgentSharedTables } from "@/features/agents/components/agent-shared-tables";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import {
  type MobileAgent,
  type MobileServer,
  useMobileWorkspace,
} from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

type AgentEdits = Pick<
  UpdateAgentInput,
  "name" | "title" | "description" | "avatarSeed" | "avatarHue" | "provider" | "model" | "reasoningEffort"
>;

const ACCESS_LABEL = {
  workspace: "mobile.agent.access.workspace",
  full: "mobile.agent.access.full",
} as const satisfies Record<AgentAccess, MobileTextKey>;

type AgentPage =
  | "info"
  | "appearance"
  | "usage"
  | "memories"
  | "skills"
  | "files"
  | "routines"
  | "tables"
  | "publish"
  | "runtime"
  | "permissions"
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
  // Keep the mounted form and its edits if the agent disappears during a reconnect or deletion.
  const lastAgent = useRef(agent);
  if (agent) lastAgent.current = agent;
  const displayed = agent ?? lastAgent.current;
  if (displayed) {
    return (
      <AgentForm agent={displayed} host={host} available={Boolean(agent && host?.state === "online")} page={page} />
    );
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
    canManageAgentAccess,
    canManageAgentHostSettings,
  } = useMobileWorkspace();
  // The Permissions row shows the access, as on desktop. Its page reads the same host answer.
  const { settings: adminSettings } = useAgentAdminSettings(agent, host, available && page === "info");
  const showPermissions = canManageAgentAccess(agent.serverId) || canManageAgentHostSettings(agent.serverId);
  const showNotifications = agent.notifications !== undefined;
  const showAdvanced =
    Boolean(agent.workspacePath) || canStartNewChat(agent.serverId) || canManageAgentHostSettings(agent.serverId);
  const navigation = useNavigation();
  const [edits, setEdits] = useState<AgentEdits>({});
  const foreground = useThemeColor("foreground");
  const [photo, setPhoto] = useState<AgentPhotoDraft | null | undefined>();
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const name = edits.name ?? agent.name;
  const title = edits.title ?? agent.title;
  const description = edits.description ?? agent.description;
  const avatarSeed = edits.avatarSeed ?? agent.avatarSeed;
  const avatarHue = edits.avatarHue === undefined ? agent.avatarHue : edits.avatarHue;
  const photoChanged = photo !== undefined && (photo !== null || Boolean(agent.avatarUrl));
  const dirty =
    photoChanged ||
    name.trim() !== agent.name ||
    title.trim() !== agent.title ||
    description.trim() !== agent.description ||
    avatarSeed !== agent.avatarSeed ||
    avatarHue !== agent.avatarHue ||
    (edits.provider !== undefined && edits.provider !== agent.provider) ||
    (edits.model !== undefined && edits.model !== agent.model) ||
    (edits.reasoningEffort !== undefined && edits.reasoningEffort !== agent.reasoningEffort);
  const valid =
    page !== "info" ||
    (Boolean(name.trim()) &&
      name.length <= INPUT_LIMITS.agentName &&
      title.length <= INPUT_LIMITS.agentTitle &&
      description.length <= INPUT_LIMITS.agentDescription);

  usePreventRemove(dirty || saving || pickingPhoto, ({ data }) => {
    if (pending.current || pickingPhoto) return;
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  function change(value: AgentEdits) {
    setEdits((current) => ({ ...current, ...value }));
    setError(null);
  }
  // Stable handlers let the memoized face and color choices skip unrelated renders.
  const changeAvatarSeed = useCallback((avatarSeed: string) => {
    setEdits((current) => ({ ...current, avatarSeed }));
    setError(null);
  }, []);
  const changeAvatarHue = useCallback((avatarHue: AvatarHue | null) => {
    setEdits((current) => ({ ...current, avatarHue }));
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
    if (!valid || !dirty || !available || pickingPhoto || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
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
            ...(edits.provider === undefined ? {} : { provider: edits.provider }),
            ...(edits.model === undefined ? {} : { model: edits.model }),
            ...(edits.reasoningEffort === undefined ? {} : { reasoningEffort: edits.reasoningEffort }),
          },
          agent.serverId,
        );
      setEdits({});
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
                size={112}
              />
              {/* A photo fills the circle; the generated avatar leaves space around its shape. */}
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
            label={t("mobile.agent.edit.instructions")}
            appearance="soft"
            placeholder={t("mobile.agent.edit.instructionsPlaceholder")}
            multiline
            maxLength={INPUT_LIMITS.agentDescription}
            value={description}
            editable={!saving}
            onChangeText={(value) => change({ description: value })}
          />
        </>
      ) : null}
      {page === "appearance" ? (
        <AgentAppearancePicker
          agentId={agent.id}
          serverId={agent.serverId}
          imageUrl={photo === undefined ? undefined : (photo?.uri ?? null)}
          seed={avatarSeed}
          hue={avatarHue}
          name={name}
          nameField={null}
          showFaces={!hasPhoto}
          photoField={photoField}
          disabled={saving || pickingPhoto}
          onSeedChange={changeAvatarSeed}
          onHueChange={changeAvatarHue}
        />
      ) : null}
      {page === "runtime" ? (
        <AgentRuntimeFields
          agent={agent}
          available={available}
          saving={saving}
          provider={edits.provider ?? agent.provider}
          model={edits.model ?? agent.model}
          reasoningEffort={edits.reasoningEffort ?? agent.reasoningEffort}
          onChange={change}
        />
      ) : null}
      {page === "permissions" ? (
        <>
          <AgentAccessFields agent={agent} server={host} available={available} />
          <AgentHostPermissionFields agent={agent} server={host} available={available} />
        </>
      ) : null}
      {page === "advanced" ? (
        <>
          <AgentBusyMessageField agent={agent} server={host} available={available} />
          {agent.workspacePath ? (
            <SettingsSection title={t("mobile.agent.workspace.title")} footer={t("mobile.agent.workspace.footer")}>
              <SettingsRow>
                <Typography.Paragraph selectable type="body-sm">
                  {agent.workspacePath}
                </Typography.Paragraph>
              </SettingsRow>
            </SettingsSection>
          ) : null}
          {canStartNewChat(agent.serverId) ? <AgentNewChatSection agent={agent} available={available} /> : null}
        </>
      ) : null}
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
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      {page === "info" || page === "appearance" || page === "runtime" ? (
        <SheetSaveAction
          dirty={dirty}
          canSave={valid && available}
          pending={saving || pickingPhoto}
          onSave={() => void submit()}
        />
      ) : null}
      {/* The groups and their order follow the desktop agent settings. */}
      {page === "info" ? (
        <>
          <SettingsSection title={t("mobile.agent.groups.brain")}>
            <SettingsRow
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
          </SettingsSection>
          <SettingsSection title={t("mobile.agent.groups.knows")}>
            <SettingsRow
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
            <SettingsRow
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
          {host && host.role !== "member" ? (
            <AgentSessionSettingsSection key={`${agent.serverId}:${agent.id}`} agent={agent} available={available} />
          ) : null}
          {showPermissions || showNotifications || showAdvanced ? (
            <SettingsSection
              title={t("mobile.agent.groups.rules")}
              footer={showNotifications ? t("mobile.agent.notifications.footer") : undefined}
            >
              {showPermissions ? (
                <SettingsRow
                  supportingText={adminSettings ? t(ACCESS_LABEL[adminSettings.access]) : undefined}
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
              {showNotifications ? <AgentNotificationsRow agent={agent} available={available} /> : null}
              {showAdvanced ? (
                <SettingsRow
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
        </>
      ) : null}
    </SheetScrollView>
  );
}
