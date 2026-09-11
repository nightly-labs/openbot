import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { UpdateAgentInput } from "@openbot/contracts/ipc";
import { userErrorMessage as errorMessage } from "@openbot/user-errors";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Button, Typography } from "heroui-native";
import { useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { AgentAppearancePicker } from "@/features/agents/components/agent-appearance-picker";
import { AgentInformation } from "@/features/agents/components/agent-information";
import { AgentRuntimeFields } from "@/features/agents/components/agent-runtime-fields";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";

type AgentEdits = Pick<
  UpdateAgentInput,
  "name" | "description" | "avatarSeed" | "avatarHue" | "provider" | "model" | "reasoningEffort"
>;

type AgentPage = "info" | "appearance" | "usage" | "memories" | "routines" | "runtime" | "memory" | "routine";

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
  const { updateAgent } = useMobileWorkspace();
  const navigation = useNavigation();
  const [edits, setEdits] = useState<AgentEdits>({});
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const name = edits.name ?? agent.name;
  const description = edits.description ?? agent.description;
  const avatarSeed = edits.avatarSeed ?? agent.avatarSeed;
  const avatarHue = edits.avatarHue === undefined ? agent.avatarHue : edits.avatarHue;
  const dirty =
    name !== agent.name ||
    description !== agent.description ||
    avatarSeed !== agent.avatarSeed ||
    avatarHue !== agent.avatarHue ||
    (edits.provider !== undefined && edits.provider !== agent.provider) ||
    (edits.model !== undefined && edits.model !== agent.model) ||
    (edits.reasoningEffort !== undefined && edits.reasoningEffort !== agent.reasoningEffort);
  const valid =
    page !== "info" ||
    (Boolean(name.trim() && description.trim()) &&
      name.length <= INPUT_LIMITS.agentName &&
      description.length <= INPUT_LIMITS.agentDescription);

  usePreventRemove(dirty || saving, ({ data }) => {
    if (pending.current) return;
    Alert.alert("Discard changes?", "Your changes have not been saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  function change(value: AgentEdits) {
    setEdits((current) => ({ ...current, ...value }));
    setSaved(false);
    setError(null);
  }

  async function submit(): Promise<void> {
    if (!valid || !dirty || !available || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await updateAgent(
        {
          agentId: agent.id,
          ...(edits.name === undefined ? {} : { name: name.trim() }),
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
      setSaved(true);
    } catch (cause) {
      setError(errorMessage(cause, "OpenBot could not update this agent."));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <SheetScrollView
      scrollOnlyOnOverflow
      className="bg-sheet"
      contentContainerClassName={page === "info" ? "gap-5 px-5 pb-safe-offset-5" : "gap-5 px-5 pb-safe-offset-5 pt-5"}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      {page === "info" ? (
        <>
          <View className="gap-3">
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
              <BloubAvatarPreview seed={avatarSeed} hue={avatarHue} size={112} />
              <Typography type="body-xs" className="-mt-3 text-center text-grouped-secondary">
                Edit appearance
              </Typography>
            </Pressable>
            <SheetFormField
              label="Name"
              hideLabel
              appearance="soft"
              textAlign="center"
              autoCapitalize="words"
              maxLength={INPUT_LIMITS.agentName}
              value={name}
              editable={!saving}
              onChangeText={(value) => change({ name: value })}
            />
          </View>
          <SheetFormField
            label="Instructions"
            appearance="soft"
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
          seed={avatarSeed}
          hue={avatarHue}
          name={name}
          nameField={null}
          disabled={saving}
          onSeedChange={(value) => change({ avatarSeed: value })}
          onHueChange={(value) => change({ avatarHue: value })}
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
      {page === "usage" || page === "memories" || page === "routines" || page === "memory" || page === "routine" ? (
        <AgentInformation agent={agent} available={available} section={page} />
      ) : null}
      {!valid ? (
        <Typography.Paragraph accessibilityRole="alert">
          Enter a name and instructions within the character limits.
        </Typography.Paragraph>
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
          canSave={valid && dirty && available}
          pending={saving}
          saved={saved && !dirty}
          onSave={() => void submit()}
        />
      ) : null}
      {dirty && page !== "appearance" ? (
        <Button variant="ghost" isDisabled={saving} onPress={() => router.back()}>
          <Button.Label>Cancel</Button.Label>
        </Button>
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
