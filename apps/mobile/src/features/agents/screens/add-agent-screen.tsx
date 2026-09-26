import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AvatarHue } from "@openbot/contracts/ipc";
import * as Crypto from "expo-crypto";
import { router, Stack, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";

import { AgentAppearancePicker } from "@/features/agents/components/agent-appearance-picker";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export function AddAgentScreen() {
  const { t, errorMessage } = useText();
  const { createAgent } = useMobileWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarSeed, setAvatarSeed] = useState(() => `mobile:${Crypto.randomUUID().replaceAll("-", "")}`);
  const [avatarHue, setAvatarHue] = useState<AvatarHue | null>(null);
  const initialAvatarSeed = useRef(avatarSeed);
  const pending = useRef(false);
  const navigation = useNavigation();
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length > 0;

  const dirty = Boolean(
    name.trim() || description.trim() || avatarSeed !== initialAvatarSeed.current || avatarHue !== null,
  );
  usePreventRemove(!finished && (dirty || saving), ({ data }) => {
    if (pending.current) return;
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
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
      await createAgent({
        name: name.trim(),
        description: description.trim(),
        initialMessage: description.trim() ? `Your ongoing role is: ${description.trim()}` : "Greet me briefly.",
        avatarSeed,
        avatarHue,
      });
      setFinished(true);
    } catch (cause) {
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
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon={isIOS ? "xmark" : undefined}
          accessibilityLabel={t("common.close")}
          disabled={saving}
          onPress={() => router.back()}
        >
          {isIOS ? t("common.close") : "×"}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
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
        maxLength={INPUT_LIMITS.agentDescription}
        placeholder={t("mobile.agent.add.descriptionPlaceholder")}
        value={description}
        onChangeText={setDescription}
      />

      {dirty && !valid ? (
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
