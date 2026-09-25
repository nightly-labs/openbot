import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AvatarHue, UpdateAgentInput } from "@openbot/contracts/ipc";
import { userErrorMessage as errorMessage } from "@openbot/user-errors";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Pencil } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { AgentAppearancePicker } from "@/features/agents/components/agent-appearance-picker";
import { AgentInformation } from "@/features/agents/components/agent-information";
import { type AgentPhotoDraft, AgentPhotoPicker } from "@/features/agents/components/agent-photo-picker";
import { AgentRuntimeFields } from "@/features/agents/components/agent-runtime-fields";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";

type AgentEdits = Pick<
  UpdateAgentInput,
  "name" | "title" | "description" | "avatarSeed" | "avatarHue" | "provider" | "model" | "reasoningEffort"
>;

type AgentPage =
  | "info"
  | "appearance"
  | "usage"
  | "memories"
  | "skills"
  | "files"
  | "routines"
  | "runtime"
  | "memory"
  | "routine";

export function EditAgentScreen({ page = "info" }: { page?: AgentPage }) {
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
    return <AgentForm agent={displayed} available={Boolean(agent && host?.state === "online")} page={page} />;
  }
  return (
    <SheetScrollView className="bg-sheet" contentContainerClassName="p-5 pb-safe-offset-5">
      <Typography.Paragraph>
        {host?.initialConnectionPending ? "Loading agent…" : "This agent is no longer available on this host."}
      </Typography.Paragraph>
    </SheetScrollView>
  );
}

function AgentForm({ agent, available, page }: { agent: MobileAgent; available: boolean; page: AgentPage }) {
  const { updateAgent, setAgentAvatar } = useMobileWorkspace();
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
    Alert.alert("Discard changes?", "Your changes have not been saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
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
    } catch (cause) {
      setError(errorMessage(cause, "OpenBot could not update this agent."));
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
              accessibilityLabel="Edit appearance"
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/appearance",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
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
              label="Name"
              appearance="soft"
              autoCapitalize="words"
              maxLength={INPUT_LIMITS.agentName}
              value={name}
              editable={!saving}
              onChangeText={(value) => change({ name: value })}
            />
          </View>
          <SheetFormField
            label="Title"
            appearance="soft"
            placeholder="Describe what your agent does"
            maxLength={INPUT_LIMITS.agentTitle}
            value={title}
            editable={!saving}
            onChangeText={(value) => change({ title: value })}
          />
          <SheetFormField
            label="Instructions"
            appearance="soft"
            placeholder="What this agent is for"
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
      {page === "usage" ||
      page === "memories" ||
      page === "skills" ||
      page === "files" ||
      page === "routines" ||
      page === "memory" ||
      page === "routine" ? (
        <AgentInformation agent={agent} available={available} section={page} />
      ) : null}
      {!available ? (
        <Typography.Paragraph>
          This agent is unavailable. Your edits are kept until you close this sheet.
        </Typography.Paragraph>
      ) : null}
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
      {page === "info" ? (
        <>
          <SettingsSection title="Info">
            <SettingsRow
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/usage",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>Usage</Typography.Paragraph>
            </SettingsRow>
            <SettingsRow
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/memories",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>Memories</Typography.Paragraph>
            </SettingsRow>
            <SettingsRow
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/skills",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>Skills</Typography.Paragraph>
            </SettingsRow>
            <SettingsRow
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/files",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>Files</Typography.Paragraph>
            </SettingsRow>
            <SettingsRow
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/routines",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>Routines</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
          <SettingsSection>
            <SettingsRow
              supportingText={agent.model}
              onPress={() =>
                router.push({
                  pathname: "/agent-info/[agentId]/runtime",
                  params: { agentId: agent.id, serverId: agent.serverId },
                })
              }
            >
              <Typography.Paragraph>Runtime</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        </>
      ) : null}
    </SheetScrollView>
  );
}
