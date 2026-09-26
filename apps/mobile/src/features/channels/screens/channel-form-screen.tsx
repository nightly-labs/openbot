import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type AvatarHue, type ChannelDraft, type ChannelSummary, isChannelDraft } from "@openbot/contracts/ipc";
import * as Crypto from "expo-crypto";
import { router, Stack, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable } from "react-native";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { useChannels } from "@/features/channels/components/use-channels";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { currentText, useText } from "@/shared/lib/text";
import { toggleChannelMember } from "../model/channel-draft";
import type { MobileChannelStore } from "../model/channel-store";

const EMPTY_DRAFT: ChannelDraft = { name: "", title: "", instructions: "", members: [], leadAgentId: null };

// No workspace/activity subscriptions, animation frames, or live agent avatars in this row.
const MemberChoice = memo(function MemberChoice({
  id,
  name,
  serverId,
  avatarSeed,
  avatarHue,
  selected,
  disabled,
  onToggle,
}: {
  id: string;
  name: string;
  serverId: string;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  selected: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={name}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={() => onToggle(id)}
      className="min-h-12 flex-row items-center gap-3 px-4 py-3"
    >
      <BloubAvatarThumbnail agentId={id} serverId={serverId} seed={avatarSeed} hue={avatarHue} size={32} />
      <Typography.Paragraph className="flex-1">{name}</Typography.Paragraph>
      <Typography>{selected ? "✓" : ""}</Typography>
    </Pressable>
  );
});

export function ChannelFormScreen({ create = false }: { create?: boolean }) {
  const { t } = useText();
  const params = useLocalSearchParams<{ serverId?: string; channelId?: string }>();
  const workspace = useMobileWorkspace();
  const [serverId] = useState(params.serverId ?? workspace.activeServer.id);
  const [channelId] = useState(() => (create ? `channel-${Crypto.randomUUID()}` : (params.channelId ?? "")));
  const state = useChannels(serverId);
  const current = state.channels.find((channel) => channel.id === channelId);
  const last = useRef(current);
  if (current) last.current = current;
  const available =
    state.supported &&
    workspace.servers.some((server) => server.id === serverId && server.state === "online") &&
    (create || Boolean(current));
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
  store,
}: {
  create: boolean;
  serverId: string;
  channelId: string;
  channel?: ChannelSummary;
  available: boolean;
  store: MobileChannelStore;
}) {
  const { t, errorMessage } = useText();
  const { agents, servers } = useMobileWorkspace();
  const canManage = servers.find((server) => server.id === serverId)?.role !== "member";
  const navigation = useNavigation();
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
  const availableIds = useMemo(() => new Set(choices.map((agent) => agent.id)), [choices]);
  const selectedIds = useMemo(() => new Set(draft.members.map((member) => member.agentId)), [draft.members]);
  const disabled = saving || !available || finished || Boolean(channel?.archived);
  usePreventRemove(!finished && (dirty || saving), ({ data }) => {
    if (lock.current) return;
    const text = currentText();
    Alert.alert(text.t("mobile.channel.discard.title"), text.t("mobile.channel.discard.body"), [
      { text: text.t("mobile.channel.discard.keepEditing"), style: "cancel" },
      {
        text: text.t("mobile.channel.discard.discard"),
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
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
      operation.current = null;
      setEdits({});
      if (close) setFinished(true);
    } catch (cause) {
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
      {create ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            icon="xmark"
            accessibilityLabel={t("common.close")}
            disabled={saving}
            onPress={() => router.back()}
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
      <SettingsSection title={t("mobile.channel.form.agents")}>
        {choices.map((agent) => (
          <MemberChoice
            key={agent.id}
            id={agent.id}
            name={agent.name}
            serverId={agent.serverId}
            avatarSeed={agent.avatarSeed}
            avatarHue={agent.avatarHue}
            selected={selectedIds.has(agent.id)}
            disabled={disabled}
            onToggle={toggle}
          />
        ))}
        {!choices.length ? (
          <SettingsRow>
            <Typography.Paragraph>{t("mobile.channel.form.noAgents")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {draft.members
          .filter((member) => !availableIds.has(member.agentId))
          .map((member) => (
            <SettingsRow
              key={member.agentId}
              disabled={disabled}
              onPress={() => toggle(member.agentId)}
              disclosure={false}
            >
              <Typography.Paragraph>{t("mobile.channel.form.removeUnavailable")}</Typography.Paragraph>
            </SettingsRow>
          ))}
      </SettingsSection>
      {draft.members.length > 0 ? (
        <SettingsSection title={t("mobile.channel.form.lead")}>
          {choices
            .filter((agent) => selectedIds.has(agent.id))
            .map((agent) => (
              <SettingsRow
                key={agent.id}
                disabled={disabled}
                disclosure={false}
                trailing={<Typography>{draft.leadAgentId === agent.id ? "✓" : ""}</Typography>}
                onPress={() => setEdits((current) => ({ ...current, leadAgentId: agent.id }))}
              >
                <Typography.Paragraph>{agent.name}</Typography.Paragraph>
              </SettingsRow>
            ))}
        </SettingsSection>
      ) : null}
      {!create && !channel?.archived ? (
        <SettingsSection>
          <SettingsRow
            disabled={saving}
            onPress={() =>
              router.push({ pathname: "/channel-info/[channelId]/memories", params: { channelId, serverId } })
            }
          >
            <Typography.Paragraph>{t("mobile.channel.form.memories")}</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow
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
