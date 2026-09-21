import { userErrorMessage } from "@openbot/user-errors";
import { router, Stack, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { isIOS } from "@/shared/lib/platform";

export function SectionFormScreen() {
  const { serverId, sectionId } = useLocalSearchParams<{ serverId: string; sectionId?: string }>();
  const { servers, sidebarByServer, mutateSidebarLayout } = useMobileWorkspace();
  const layout = sidebarByServer[serverId]?.layout;
  const section = layout?.sections.find((item) => item.id === sectionId);
  const [initialName] = useState(section?.name ?? "");
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const navigation = useNavigation();
  const dirty = name.trim() !== initialName;
  const available =
    Boolean(layout) &&
    servers.some((server) => server.id === serverId && server.state === "online") &&
    (!sectionId || Boolean(section));
  const valid = name.trim().length > 0 && name.trim().length <= 40;
  usePreventRemove(!finished && (dirty || saving), ({ data }) => {
    if (pending.current) return;
    Alert.alert("Discard changes?", "Your changes have not been saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  useEffect(() => {
    if (finished) router.back();
  }, [finished]);
  async function save() {
    if (!available || !valid || !dirty || pending.current || finished) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await mutateSidebarLayout(
        serverId,
        sectionId ? { type: "rename", sectionId, name: name.trim() } : { type: "create", name: name.trim() },
      );
      setFinished(true);
    } catch (cause) {
      setError(userErrorMessage(cause, "Could not save section. Please try again."));
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-5 px-5 pb-safe-offset-5 pt-5"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: sectionId ? "Rename section" : "New section" }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon={isIOS ? "xmark" : undefined}
          accessibilityLabel="Close"
          disabled={saving}
          onPress={() => router.back()}
        >
          {isIOS ? "Close" : "×"}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <SheetSaveAction
        dirty={dirty}
        canSave={available && valid && !finished}
        pending={saving}
        label={sectionId ? "Save section" : "Create section"}
        onSave={() => void save()}
      />
      <SheetFormField
        label="Section name"
        value={name}
        onChangeText={setName}
        editable={!saving}
        maxLength={40}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => void save()}
      />
      {!available ? (
        <Typography.Paragraph className="text-muted">
          This section is unavailable. Reconnect to the server or close this form.
        </Typography.Paragraph>
      ) : null}
      {error ? <Typography.Paragraph className="text-danger-text">{error}</Typography.Paragraph> : null}
    </SheetScrollView>
  );
}
