import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type ChannelDraft, type ChannelSummary, isChannelDraft } from "@openbot/contracts/ipc";
import * as Crypto from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import BookBookmark from "lucide-react-native/icons/book-bookmark";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import Crown from "lucide-react-native/icons/crown";
import Pencil from "lucide-react-native/icons/pencil";
import Trash2 from "lucide-react-native/icons/trash";
import Users from "lucide-react-native/icons/users";
import X from "lucide-react-native/icons/x";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useUniwind } from "uniwind";
import { ChannelAvatar } from "@/features/channels/components/channel-avatar";
import { useChannels } from "@/features/channels/components/use-channels";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";
import { useChannelAgentPicker } from "../model/channel-agent-picker";
import { toggleChannelMember } from "../model/channel-draft";
import type { MobileChannelStore } from "../model/channel-store";

const AVATAR_SIZE = 112;

const EMPTY_DRAFT: ChannelDraft = { name: "", title: "", instructions: "", members: [], leadAgentId: null };

export function ChannelFormScreen({ create = false }: { create?: boolean }) {
  const { t } = useText();
  const params = useLocalSearchParams<{ serverId?: string; channelId?: string }>();
  const workspace = useMobileWorkspaceReader();
  const [serverId] = useState(params.serverId ?? workspace().activeServer.id);
  const [channelId] = useState(() => (create ? `channel-${Crypto.randomUUID()}` : (params.channelId ?? "")));
  const state = useChannels(serverId);
  const current = state.channels.find((channel) => channel.id === channelId);
  const last = useRef(current);
  if (current) last.current = current;
  const online = useMobileWorkspaceSelector((current) =>
    current.servers.some((server) => server.id === serverId && server.state === "online"),
  );
  const available = state.supported && online && (create || Boolean(current));
  if (!create && !last.current)
    return (
      <SheetScrollView>
        <Typography.Paragraph>
          {t(state.loading ? "mobile.channel.form.loading" : "mobile.channel.form.gone")}
        </Typography.Paragraph>
      </SheetScrollView>
    );
  return (
    <ChannelForm
      key={`${serverId}:${channelId}`}
      create={create}
      serverId={serverId}
      channelId={channelId}
      channel={create ? undefined : (current ?? last.current)}
      available={available}
      pictureSupported={state.canSetPicture}
      store={state.store}
    />
  );
}

function ChannelForm({
  create,
  serverId,
  channelId,
  channel,
  available,
  pictureSupported,
  store,
}: {
  create: boolean;
  serverId: string;
  channelId: string;
  channel?: ChannelSummary;
  available: boolean;
  /** The host takes a channel picture (`channel-picture-v1`). */
  pictureSupported: boolean;
  store: MobileChannelStore;
}) {
  const { t, errorMessage } = useText();
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const canManage = useMobileWorkspaceSelector(
    (current) => current.servers.find((server) => server.id === serverId)?.role !== "member",
  );
  const { theme } = useUniwind();
  const openAgentPicker = useChannelAgentPicker((state) => state.open);
  const foreground = String(useThemeColor("foreground"));
  const [edits, setEdits] = useState<Partial<ChannelDraft>>({});
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const base = channel ?? EMPTY_DRAFT;
  const draft: ChannelDraft = {
    name: base.name,
    title: base.title,
    instructions: base.instructions,
    members: base.members,
    leadAgentId: base.leadAgentId,
    ...edits,
  };
  if (!draft.members.some((member) => member.agentId === draft.leadAgentId))
    draft.leadAgentId = draft.members[0]?.agentId ?? null;
  const dirty = (["name", "title", "instructions", "members", "leadAgentId"] as const).some(
    (key) => JSON.stringify(draft[key]) !== JSON.stringify(base[key]),
  );
  const valid = isChannelDraft(draft);
  const choices = useMemo(() => agents.filter((agent) => agent.serverId === serverId), [agents, serverId]);
  const agentsById = useMemo(() => new Map(choices.map((agent) => [agent.id, agent])), [choices]);
  const disabled = saving || !available || finished || Boolean(channel?.archived);
  // Discard turns prevention off before it repeats the action, so the hook does not warn.
  const [discarding, setDiscarding] = useState(false);
  usePreventRemove(!discarding && !finished && (dirty || saving), ({ repeat }) => {
    if (lock.current) return;
    void haptics.notification("warning");
    const text = currentText();
    Alert.alert(text.t("mobile.channel.discard.title"), text.t("mobile.channel.discard.body"), [
      { text: text.t("mobile.channel.discard.keepEditing"), style: "cancel" },
      {
        text: text.t("mobile.channel.discard.discard"),
        style: "destructive",
        onPress: () => {
          setDiscarding(true);
          repeat();
        },
      },
    ]);
  });
  useEffect(() => {
    if (!finished) return;
    if (create) router.replace({ pathname: "/channel/[channelId]", params: { channelId, serverId } });
    else router.back();
  }, [finished, create, channelId, serverId]);
  async function run(action: () => Promise<unknown>, close: boolean) {
    if (lock.current || disabled) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      await action();
      void haptics.notification("success");
      operation.current = null;
      setEdits({});
      if (close) setFinished(true);
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.channel.form.saveFailed")));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  function save() {
    if (!valid || !dirty) return;
    const signature = JSON.stringify(draft);
    if (operation.current?.signature !== signature) operation.current = { signature, id: Crypto.randomUUID() };
    const operationId = operation.current.id;
    void run(
      () =>
        store.command(serverId, {
          type: "save",
          operationId,
          channelId,
          draft: { ...draft, name: draft.name.trim() },
          ...(!create ? { update: true } : {}),
        }),
      create,
    );
  }
  const leadOptions = draft.members.flatMap((member) => {
    const agent = agentsById.get(member.agentId);
    return agent ? [{ value: agent.id, label: agent.name }] : [];
  });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const toggle = useCallback((id: string) => {
    setEdits((current) => {
      const next = toggleChannelMember({ ...draftRef.current, ...current }, id);
      return { ...current, members: next.members, leadAgentId: next.leadAgentId };
    });
  }, []);
  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-5 px-5 pt-5 pb-safe-offset-5"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      {create && isAndroid ? (
        <AndroidHeaderButton
          placement="left"
          icon={X}
          accessibilityLabel={t("common.close")}
          disabled={saving}
          onPress={() => {
            void haptics.impact("soft");
            router.back();
          }}
        />
      ) : create ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            icon="xmark"
            accessibilityLabel={t("common.close")}
            disabled={saving}
            onPress={() => {
              void haptics.impact("soft");
              router.back();
            }}
          >
            {t("common.close")}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
      <SheetSaveAction
        dirty={dirty}
        canSave={valid && !disabled}
        pending={saving}
        label={t(create ? "mobile.channel.form.create" : "mobile.channel.form.save")}
        onSave={save}
      />
      {!create && channel ? (
        pictureSupported && !channel.archived ? (
          <Pressable
            className="self-center"
            accessibilityRole="button"
            accessibilityLabel={t("mobile.channel.picture.title")}
            disabled={saving || finished}
            onPress={() => {
              void haptics.impact("soft");
              router.push({ pathname: "/channel-info/[channelId]/picture", params: { channelId, serverId } });
            }}
          >
            <ChannelAvatar channel={channel} agents={agentsById} size={AVATAR_SIZE} serverId={serverId} />
            <View className="absolute -right-2 -bottom-2 size-9 items-center justify-center rounded-full border-4 border-sheet bg-grouped">
              <Pencil color={foreground} size={14} />
            </View>
          </Pressable>
        ) : (
          <View className="self-center">
            <ChannelAvatar channel={channel} agents={agentsById} size={AVATAR_SIZE} serverId={serverId} />
          </View>
        )
      ) : null}
      <SheetFormField
        label={t("mobile.channel.form.name")}
        placeholder={t("mobile.channel.form.namePlaceholder")}
        appearance="soft"
        value={draft.name}
        onChangeText={(name) => setEdits((current) => ({ ...current, name }))}
        editable={!disabled}
        maxLength={INPUT_LIMITS.agentName}
      />
      {!create ? (
        <>
          <SheetFormField
            label={t("mobile.channel.form.title")}
            appearance="soft"
            placeholder={t("mobile.channel.form.titlePlaceholder")}
            value={draft.title}
            onChangeText={(title) => setEdits((current) => ({ ...current, title }))}
            editable={!disabled}
            maxLength={INPUT_LIMITS.agentTitle}
          />
          <SheetFormField
            label={t("mobile.channel.form.instructions")}
            appearance="soft"
            placeholder={t("mobile.channel.form.instructionsPlaceholder")}
            multiline
            value={draft.instructions}
            onChangeText={(instructions) => setEdits((current) => ({ ...current, instructions }))}
            editable={!disabled}
            maxLength={INPUT_LIMITS.agentDescription}
          />
        </>
      ) : null}
      <SettingsSection>
        <SettingsRow
          leading={<RowIcon icon={Users} />}
          value={String(draft.members.length)}
          disabled={disabled}
          onPress={() => {
            openAgentPicker({ serverId, members: draft.members.map((member) => member.agentId), toggle });
            router.push(
              create
                ? { pathname: "/add-channel/agents" }
                : { pathname: "/channel-info/[channelId]/agents", params: { channelId, serverId } },
            );
          }}
        >
          <Typography.Paragraph>{t("mobile.channel.form.agents")}</Typography.Paragraph>
        </SettingsRow>
        {leadOptions.length > 0 && draft.leadAgentId ? (
          <SettingsRow
            leading={<RowIcon icon={Crown} />}
            trailing={
              <SettingsPicker
                value={draft.leadAgentId}
                options={leadOptions}
                enabled={!disabled}
                dark={theme === "dark"}
                label={t("mobile.channel.form.lead")}
                onChange={(leadAgentId) => {
                  void haptics.selection();
                  setEdits((current) => ({ ...current, leadAgentId }));
                }}
              />
            }
          >
            <Typography.Paragraph>{t("mobile.channel.form.lead")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {!create && !channel?.archived ? (
        <SettingsSection>
          <SettingsRow
            leading={<RowIcon icon={BookBookmark} />}
            disabled={saving}
            onPress={() =>
              router.push({ pathname: "/channel-info/[channelId]/memories", params: { channelId, serverId } })
            }
          >
            <Typography.Paragraph>{t("mobile.channel.form.memories")}</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow
            leading={<RowIcon icon={CalendarClock} />}
            disabled={saving}
            onPress={() =>
              router.push({ pathname: "/channel-info/[channelId]/routines", params: { channelId, serverId } })
            }
          >
            <Typography.Paragraph>{t("mobile.channel.form.routines")}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {!create && !channel?.archived ? (
        <SettingsSection>
          {canManage ? (
            <SettingsRow
              leading={<RowIcon icon={Trash2} tone="danger" />}
              disabled={disabled || dirty}
              disclosure={false}
              onPress={() => {
                const text = currentText();
                Alert.alert(text.t("mobile.channel.form.deleteTitle"), text.t("mobile.channel.form.deleteBody"), [
                  { text: text.t("common.cancel"), style: "cancel" },
                  {
                    text: text.t("common.delete"),
                    style: "destructive",
                    onPress: () =>
                      void run(
                        () => store.command(serverId, { type: "archive", operationId: Crypto.randomUUID(), channelId }),
                        true,
                      ),
                  },
                ]);
              }}
            >
              <Typography.Paragraph className="text-danger-text">
                {t("mobile.channel.form.delete")}
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}
      {!available ? <Typography.Paragraph>{t("mobile.channel.form.unavailable")}</Typography.Paragraph> : null}
      {dirty && !valid ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {t("mobile.channel.form.invalidName")}
        </Typography.Paragraph>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </SheetScrollView>
  );
}
