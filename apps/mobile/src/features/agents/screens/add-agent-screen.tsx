import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AvatarHue } from "@openbot/contracts/ipc";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useState } from "react";

import { AgentAppearancePicker } from "@/features/agents/components/agent-appearance-picker";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";

export function AddAgentScreen() {
  const { createAgent } = useMobileWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarSeed, setAvatarSeed] = useState(() => `mobile:${Crypto.randomUUID().replaceAll("-", "")}`);
  const [avatarHue, setAvatarHue] = useState<AvatarHue | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length > 0 && description.trim().length > 0;

  async function submit(): Promise<void> {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createAgent({
        name: name.trim(),
        description: description.trim(),
        initialMessage: `Your ongoing role is: ${description.trim()}`,
        avatarSeed,
        avatarHue,
      });
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OpenBot could not create this agent.");
      setSaving(false);
    }
  }

  return (
    <SheetScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5 pb-safe-offset-8 pt-5"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <AgentAppearancePicker
        seed={avatarSeed}
        hue={avatarHue}
        name={name}
        nameField={
          <SheetFormField
            autoCapitalize="words"
            label="Name"
            hideLabel
            appearance="soft"
            textAlign="center"
            maxLength={INPUT_LIMITS.agentName}
            placeholder="Name your agent"
            value={name}
            onChangeText={setName}
          />
        }
        disabled={saving}
        onSeedChange={setAvatarSeed}
        onHueChange={setAvatarHue}
      />

      <SheetFormField
        label="What should this agent help with?"
        appearance="soft"
        multiline
        maxLength={INPUT_LIMITS.agentDescription}
        placeholder="Plan trips, compare options, or help with everyday work."
        value={description}
        onChangeText={setDescription}
      />

      {error ? (
        <Typography.Paragraph align="center" className="text-danger">
          {error}
        </Typography.Paragraph>
      ) : null}

      <Button size="lg" isDisabled={!valid || saving} onPress={() => void submit()}>
        <Button.Label className="font-sans font-semibold">{saving ? "Creating…" : "Create agent"}</Button.Label>
      </Button>
    </SheetScrollView>
  );
}
