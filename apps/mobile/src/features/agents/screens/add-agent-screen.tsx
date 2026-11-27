import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { CreateAgentInput } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { AgentAppearancePicker, type AgentColorValue } from "@/features/agents/components/agent-appearance-picker";
import { AgentRuntimeFields } from "@/features/agents/components/agent-runtime-fields";
import { InstructionsLimit, instructionsTooLong } from "@/features/agents/components/instructions-limit";
import { newAvatarSeed } from "@/features/agents/model/avatar-candidates";
import { useMobileWorkspace, useMobileWorkspaceReader } from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { SheetCloseAction } from "@/shared/components/sheet-close-action";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useDiscardGuard } from "@/shared/lib/use-discard-guard";

type AgentRuntimeChoice = Pick<CreateAgentInput, "provider" | "model" | "reasoningEffort">;

export function AddAgentScreen() {
  const { t, errorMessage } = useText();
  const workspace = useMobileWorkspaceReader();
  const [serverId] = useState(() => workspace().activeServer.id);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [runtime, setRuntime] = useState<AgentRuntimeChoice>({});
  const [avatarSeed, setAvatarSeed] = useState(newAvatarSeed);
  const [avatarColor, setAvatarColor] = useState<AgentColorValue>({ hue: null, color: null });
  const [initialAvatarSeed] = useState(avatarSeed);
  const pending = useRef(false);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triedCreate, setTriedCreate] = useState(false);
  const nameMissing = name.trim().length === 0;
  const valid = !nameMissing && !instructionsTooLong(description);

  const dirty = Boolean(
    name.trim() ||
      description.trim() ||
      avatarSeed !== initialAvatarSeed ||
      avatarColor.hue !== null ||
      avatarColor.color !== null ||
      runtime.provider !== undefined,
  );
  useDiscardGuard(!finished && (dirty || saving), { busy: () => pending.current });
  useEffect(() => {
    if (finished) router.back();
  }, [finished]);

  async function submit(): Promise<void> {
    if (nameMissing) {
      setTriedCreate(true);
      void haptics.notification("error");
      return;
    }
    if (!valid || pending.current || finished) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await workspace().createAgent({
        name: name.trim(),
        description: description.trim(),
        avatarSeed,
        avatarHue: avatarColor.hue,
        avatarColor: avatarColor.color,
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
      className="bg-sheet"
      contentContainerClassName="gap-5 px-5 pb-safe-offset-5 pt-5"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <SheetCloseAction
        disabled={saving}
        onPress={() => {
          void haptics.impact("soft");
          router.back();
        }}
      />
      <SheetSaveAction
        dirty={dirty}
        canSave={!instructionsTooLong(description) && !finished}
        pending={saving}
        label={t("mobile.agent.add.create")}
        pendingLabel={t("mobile.agent.add.creating")}
        onSave={() => void submit()}
      />
      <AgentAppearancePicker
        seed={avatarSeed}
        hue={avatarColor.hue}
        color={avatarColor.color}
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
            error={triedCreate && nameMissing ? t("mobile.agent.add.nameRequired") : undefined}
            onChangeText={setName}
          />
        }
        disabled={saving}
        onSeedChange={setAvatarSeed}
        onColorChange={setAvatarColor}
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

      {error ? (
        <Typography.Paragraph accessibilityRole="alert" align="center" className="text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </SheetScrollView>
  );
}

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
      modelPickerRoute="/add-agent/model-picker"
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
