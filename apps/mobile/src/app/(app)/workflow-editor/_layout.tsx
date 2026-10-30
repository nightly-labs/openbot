import { Stack } from "expo-router/stack";
import { useEffect } from "react";
import { useCSSVariable } from "uniwind";
import { useWorkflowDraft } from "@/features/workflows/model/workflow-draft";
import { androidBackOptions } from "@/shared/components/android-header-button";
import { headerFontOptions } from "@/shared/lib/app-font";
import { isIOS } from "@/shared/lib/platform";
import { sheetBackHaptics } from "@/shared/lib/sheet-back-haptics";
import { sheetHeaderInsetOptions } from "@/shared/lib/sheet-header";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { anchor: "index" };

/** The editor sheet: one sheet with the pages of the editor, which share one draft. */
export default function WorkflowEditorLayout() {
  const { t } = useText();
  const background = String(useCSSVariable("--openbot-bg-sheet"));
  // The draft lives while the sheet is open, so a closed sheet does not open on an old draft.
  useEffect(() => () => useWorkflowDraft.getState().clear(), []);
  return (
    <Stack
      screenListeners={sheetBackHaptics}
      screenOptions={(props) => ({
        ...androidBackOptions(props),
        ...sheetHeaderInsetOptions,
        presentation: "card",
        headerBackButtonDisplayMode: "minimal",
        ...headerFontOptions,
        headerShadowVisible: false,
        headerTransparent: isIOS,
        headerStyle: { backgroundColor: isIOS ? "transparent" : background },
        headerBlurEffect: "none",
        scrollEdgeEffects: { top: "hidden", bottom: "soft" },
        contentStyle: { backgroundColor: background },
      })}
    >
      <Stack.Screen name="index" options={{ title: t("mobile.workflow.editor.title") }} />
      <Stack.Screen name="step" options={{ title: t("mobile.workflow.editor.step") }} />
      <Stack.Screen name="add" options={{ title: t("mobile.workflow.add.title") }} />
      <Stack.Screen name="trigger" options={{ title: t("mobile.workflow.detail.trigger") }} />
    </Stack>
  );
}
