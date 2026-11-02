import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AvatarHue, CreateAgentInput } from "@openbot/contracts/ipc";
import * as Crypto from "expo-crypto";
import { router, Stack } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import X from "lucide-react-native/icons/x";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { AgentAppearancePicker } from "@/features/agents/components/agent-appearance-picker";
import { AgentRuntimeFields } from "@/features/agents/components/agent-runtime-fields";
import { InstructionsLimit, instructionsTooLong } from "@/features/agents/components/instructions-limit";
import { agentInitialMessage } from "@/features/agents/model/agent-initial-message";
import { useMobileWorkspace, useMobileWorkspaceReader } from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

type AgentRuntimeChoice = Pick<CreateAgentInput, "provider" | "model" | "reasoningEffort">;

export function AddAgentScreen() {
  const { t, errorMessage } = useText();
  // Read on submit, so a server status or an agent update does not render the form again.
  const workspace = useMobileWorkspaceReader();
  // The agent is created on the server that was active when the form opened.
  const [serverId] = useState(() => workspace().activeServer.id);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [runtime, setRuntime] = useState<AgentRuntimeChoice>({});
  const [avatarSeed, setAvatarSeed] = useState(() => `mobile:${Crypto.randomUUID().replaceAll("-", "")}`);
  const [avatarHue, setAvatarHue] = useState<AvatarHue | null>(null);
  const [initialAvatarSeed] = useState(avatarSeed);
  const pending = useRef(false);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length > 0 && !instructionsTooLong(description);

  const dirty = Boolean(
    name.trim() ||
      description.trim() ||
      avatarSeed !== initialAvatarSeed ||
      avatarHue !== null ||
      runtime.provider !== undefined,
  );
  // Discard turns prevention off before it repeats the action, so the hook does not warn.
  const [discarding, setDiscarding] = useState(false);
  usePreventRemove(!discarding && !finished && (dirty || saving), ({ repeat }) => {
    if (pending.current) return;
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => {
          setDiscarding(true);
          repeat();
        },
      },
    ]);
  });
  useEffect(() => {
    if (finished) router.back();
  }, [finished]);

  async function submit(): Promise<void> {
    if (!valid || pending.current || finished) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await workspace().createAgent({
        name: name.trim(),
        description: description.trim(),
        initialMessage: agentInitialMessage(description),
        avatarSeed,
        avatarHue,
        ...(workspace().activeServer.id === serverId ? runtime : {}),
      });
      void haptics.notification("success");
      setFinished(true);
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.agent.add.failed")));
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <SheetScrollView
      clearHeader
      className="bg-sheet"
      contentContainerClassName="gap-5 px-5 pb-safe-offset-5 pt-5"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      {isAndroid ? (
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
      ) : (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            icon={isIOS ? "xmark" : undefined}
            accessibilityLabel={t("common.close")}
            disabled={saving}
            onPress={() => {
              void haptics.impact("soft");
              router.back();
            }}
          >
            {isIOS ? t("common.close") : "×"}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      <SheetSaveAction
        dirty={dirty}
        canSave={valid && !finished}
        pending={saving}
        label={t("mobile.agent.add.create")}
        pendingLabel={t("mobile.agent.add.creating")}
        onSave={() => void submit()}
      />
      <AgentAppearancePicker
        seed={avatarSeed}
        hue={avatarHue}
        name={name}
        colorGlow
        nameField={
          <SheetFormField
            editable={!saving}
            autoCapitalize="words"
            label={t("mobile.agent.form.name")}
            appearance="soft"
            maxLength={INPUT_LIMITS.agentName}
            placeholder={t("mobile.agent.add.namePlaceholder")}
            value={name}
            onChangeText={setName}
          />
        }
        disabled={saving}
        onSeedChange={setAvatarSeed}
        onHueChange={setAvatarHue}
      />

      <SheetFormField
        editable={!saving}
        label={t("mobile.agent.add.descriptionLabel")}
        appearance="soft"
        multiline
        placeholder={t("mobile.agent.add.descriptionPlaceholder")}
        value={description}
        onChangeText={setDescription}
      />
      <InstructionsLimit text={description} />

      <NewAgentRuntimeFields
        serverId={serverId}
        saving={saving}
        value={runtime}
        onChange={(value) => setRuntime((current) => ({ ...current, ...value }))}
      />

      {dirty && !name.trim() ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {t("mobile.agent.add.nameRequired")}
        </Typography.Paragraph>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" align="center" className="text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </SheetScrollView>
  );
}

/**
 * The provider and model of the new agent, for a host that reads them on creation. It reads the
 * workspace itself, so a server status change renders only these rows, not the whole form.
 */
function NewAgentRuntimeFields({
  serverId,
  saving,
  value,
  onChange,
}: {
  serverId: string;
  saving: boolean;
  value: AgentRuntimeChoice;
  onChange: (value: AgentRuntimeChoice) => void;
}) {
  const { t } = useText();
  const { servers, canChooseNewAgentModel } = useMobileWorkspace();
  const server = servers.find((candidate) => candidate.id === serverId);
  if (!canChooseNewAgentModel(serverId)) return null;
  return (
    <AgentRuntimeFields
      serverId={serverId}
      available={showsOnline(server)}
      saving={saving}
      hostDefault
      title={t("mobile.agent.groups.brain")}
      provider={value.provider}
      model={value.model}
      reasoningEffort={value.reasoningEffort}
      onChange={onChange}
    />
  );
}
