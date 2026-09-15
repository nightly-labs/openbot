import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type AvatarHue, type ChannelDraft, type ChannelSummary, isChannelDraft } from "@openbot/contracts/ipc";
import { userErrorMessage } from "@openbot/user-errors";
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
import { toggleChannelMember } from "../model/channel-draft";
import type { MobileChannelStore } from "../model/channel-store";

const EMPTY_DRAFT: ChannelDraft = { name: "", title: "", instructions: "", members: [], leadAgentId: null };

// No workspace/activity subscriptions, animation frames, or live agent avatars in this row.
const MemberChoice = memo(function MemberChoice({
  id,
  name,
  avatarSeed,
  avatarHue,
  selected,
  disabled,
  onToggle,
}: {
  id: string;
  name: string;
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
      <BloubAvatarThumbnail seed={avatarSeed} hue={avatarHue} size={32} />
      <Typography.Paragraph className="flex-1">{name}</Typography.Paragraph>
      <Typography>{selected ? "✓" : ""}</Typography>
    </Pressable>
  );
});

export function ChannelFormScreen({ create = false }: { create?: boolean }) {
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
          {state.loading ? "Loading channel…" : "This channel is no longer available."}
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
      canDelete={state.canDelete}
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
  canDelete,
}: {
  create: boolean;
  serverId: string;
  channelId: string;
  channel?: ChannelSummary;
  available: boolean;
  store: MobileChannelStore;
  canDelete: boolean;
}) {
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
  const disabled = saving || !available || finished;
  usePreventRemove(!finished && (dirty || saving), ({ data }) => {
    if (lock.current) return;
    Alert.alert("Discard changes?", "Your changes have not been saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
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
      setError(userErrorMessage(cause, "Could not save this channel. Try again."));
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
          <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" disabled={saving} onPress={() => router.back()}>
            Close
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
      <SheetSaveAction
        dirty={dirty}
        canSave={valid && !disabled}
        pending={saving}
        label={create ? "Create channel" : "Save channel"}
        onSave={save}
      />
      <SheetFormField
        label="Name"
        placeholder="Launch hub"
        appearance="soft"
        value={draft.name}
        onChangeText={(name) => setEdits((current) => ({ ...current, name }))}
        editable={!disabled}
        maxLength={INPUT_LIMITS.agentName}
      />
      {!create ? (
        <>
          <SheetFormField
            label="Title"
            appearance="soft"
            value={draft.title}
            onChangeText={(title) => setEdits((current) => ({ ...current, title }))}
            editable={!disabled}
            maxLength={INPUT_LIMITS.agentTitle}
          />
          <SheetFormField
            label="Instructions"
            appearance="soft"
            multiline
            value={draft.instructions}
            onChangeText={(instructions) => setEdits((current) => ({ ...current, instructions }))}
            editable={!disabled}
            maxLength={INPUT_LIMITS.agentDescription}
          />
        </>
      ) : null}
      <SettingsSection title="Agents">
        {choices.map((agent) => (
          <MemberChoice
            key={agent.id}
            id={agent.id}
            name={agent.name}
            avatarSeed={agent.avatarSeed}
            avatarHue={agent.avatarHue}
            selected={selectedIds.has(agent.id)}
            disabled={disabled}
            onToggle={toggle}
          />
        ))}
        {!choices.length ? (
          <SettingsRow>
            <Typography.Paragraph>No agents on this server.</Typography.Paragraph>
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
              <Typography.Paragraph>Remove unavailable agent</Typography.Paragraph>
            </SettingsRow>
          ))}
      </SettingsSection>
      {draft.members.length > 0 ? (
        <SettingsSection title="Lead agent">
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
      {!create ? (
        <SettingsSection>
          <SettingsRow
            disabled={saving}
            onPress={() =>
              router.push({ pathname: "/channel-info/[channelId]/memories", params: { channelId, serverId } })
            }
          >
            <Typography.Paragraph>Memories</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow
            disabled={saving}
            onPress={() =>
              router.push({ pathname: "/channel-info/[channelId]/routines", params: { channelId, serverId } })
            }
          >
            <Typography.Paragraph>Routines</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {!create ? (
        <SettingsSection>
          <SettingsRow
            disabled={disabled || dirty || (!canManage && !channel?.archived)}
            disclosure={false}
            onPress={() =>
              void run(
                () =>
                  store.command(serverId, {
                    type: channel?.archived ? "restore" : "archive",
                    operationId: Crypto.randomUUID(),
                    channelId,
                  }),
                true,
              )
            }
          >
            <Typography.Paragraph>{channel?.archived ? "Restore channel" : "Archive channel"}</Typography.Paragraph>
          </SettingsRow>
          {canDelete && canManage ? (
            <SettingsRow
              disabled={disabled || dirty}
              disclosure={false}
              onPress={() =>
                Alert.alert(
                  "Delete channel?",
                  "This permanently deletes the channel and its messages. Agents are kept.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => void run(() => store.delete(serverId, channelId), true),
                    },
                  ],
                )
              }
            >
              <Typography.Paragraph className="text-danger-text">Delete channel</Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}
      {!available ? (
        <Typography.Paragraph>Connect to a desktop server that supports channels to make changes.</Typography.Paragraph>
      ) : null}
      {dirty && !valid ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          Enter a valid channel name.
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
