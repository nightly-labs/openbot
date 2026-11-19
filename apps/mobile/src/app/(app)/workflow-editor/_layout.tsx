import { Stack } from "expo-router/stack";
import { useEffect } from "react";
import { useCSSVariable } from "uniwind";
import { useWorkflowDraft } from "@/features/workflows/model/workflow-draft";
import { sheetStackOptions } from "@/shared/components/sheet-page-stack";
import { sheetBackHaptics } from "@/shared/lib/sheet-back-haptics";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { anchor: "index" };

/** The editor: one page with the pages of the editor in its own stack, which share one draft. */
export default function WorkflowEditorLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  // The draft lives while the editor is open, so a closed editor does not open on an old draft.
  useEffect(() => () => useWorkflowDraft.getState().clear(), []);
  return (
    <Stack screenListeners={sheetBackHaptics} screenOptions={sheetStackOptions(background, { insets: false })}>
      <Stack.Screen name="index" options={{ title: t("mobile.workflow.editor.title") }} />
      <Stack.Screen name="step" options={{ title: t("mobile.workflow.editor.step") }} />
      {/* A sheet over the editor; its header comes from `add/_layout.tsx`. */}
      <Stack.Screen
        name="add"
        options={{
          headerShown: false,
          presentation: "formSheet",
          sheetAllowedDetents: [0.85],
          sheetGrabberVisible: true,
        }}
      />
      <Stack.Screen name="trigger" options={{ title: t("mobile.workflow.detail.trigger") }} />
      {/* The page names the list that it shows. */}
      <Stack.Screen name="github-pick" options={{ title: t("mobile.workflow.github.repository") }} />
    </Stack>
  );
}
