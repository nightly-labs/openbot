import { Stack } from "expo-router";
import Check from "lucide-react-native/icons/check";
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical";
import { type ReactNode, useLayoutEffect, useMemo, useRef } from "react";
import { Pressable, View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import type { EditorView } from "@/features/workflows/model/workflow-editor-view";
import { AndroidStackBackButton } from "@/shared/components/android-header-button";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { toolbarMenuItems } from "@/shared/components/toolbar-menu-items";
import { useChromeGlass } from "@/shared/lib/chrome-glass";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export function AndroidBarIcon({ children }: { children: ReactNode }) {
  const glass = useChromeGlass({ shadow: false });
  return (
    <View className="size-12 items-center justify-center">
      <View className="size-10 items-center justify-center overflow-hidden rounded-full" style={glass}>
        {children}
      </View>
    </View>
  );
}

export function viewMenuActions(view: EditorView, t: ReturnType<typeof useText>["t"]): MenuAction[] {
  return [
    {
      id: "layout",
      title: "",
      displayInline: true,
      subactions: [
        {
          id: "view-flow",
          title: t("mobile.workflow.editor.viewFlow"),
          image: "arrow.triangle.branch",
          state: view === "flow" ? "on" : "off",
        },
        {
          id: "view-list",
          title: t("mobile.workflow.editor.viewList"),
          image: "list.bullet",
          state: view === "list" ? "on" : "off",
        },
      ],
    },
  ];
}

export interface EditorSave {
  dirty: boolean;
  canSave: boolean;
  pending: boolean;
  label: string;
  onSave: () => void;
}

export function WorkflowEditorHeader({
  view,
  onView,
  save,
  backDisabled,
  onBack,
}: {
  view: EditorView;
  onView: (view: EditorView) => void;
  save: EditorSave | undefined;
  backDisabled: boolean;
  onBack: () => void;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const foreground = String(useCSSVariable("--openbot-text-primary"));
  const actions = useMemo(() => viewMenuActions(view, t), [view, t]);
  const onMenu = (id: string) => {
    if (id !== "view-flow" && id !== "view-list") return;
    void haptics.selection();
    onView(id === "view-flow" ? "flow" : "list");
  };
  const saveShown = save ? save.dirty || save.pending : false;
  const saveOff = !save?.dirty || !save.canSave || save.pending;
  const runSave = () => {
    if (!save || saveOff) return;
    void haptics.impact("light");
    save.onSave();
  };
  const moreLabel = t("mobile.workflow.detail.more");
  const saveLabel = save?.label ?? "";
  const back = () => {
    if (!backDisabled) onBack();
  };
  const latest = useRef({ onBack: back, onMenu, runSave });
  useLayoutEffect(() => {
    latest.current = { onBack: back, onMenu, runSave };
  });
  const androidOptions = useMemo(
    () => ({
      headerLeft: () => <AndroidStackBackButton glass onPress={() => latest.current.onBack()} />,
      headerRight: () => (
        <View className="flex-row items-center">
          <MenuView
            colorScheme={theme === "dark" ? "dark" : "light"}
            actions={actions}
            onPressAction={(event) => latest.current.onMenu(event.nativeEvent.event)}
          >
            <View accessible accessibilityRole="button" accessibilityLabel={moreLabel}>
              <AndroidBarIcon>
                <EllipsisVertical color={foreground} size={22} strokeWidth={2} />
              </AndroidBarIcon>
            </View>
          </MenuView>
          {saveShown ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={saveLabel}
              accessibilityState={{ disabled: saveOff }}
              disabled={saveOff}
              android_ripple={{ borderless: true, radius: 20 }}
              style={{ opacity: saveOff ? 0.38 : 1 }}
              onPress={() => latest.current.runSave()}
            >
              <AndroidBarIcon>
                <Check color={foreground} size={22} strokeWidth={2} />
              </AndroidBarIcon>
            </Pressable>
          ) : null}
        </View>
      ),
    }),
    [actions, theme, foreground, saveShown, saveOff, saveLabel, moreLabel],
  );
  if (isAndroid) return <Stack.Screen options={androidOptions} />;
  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon="chevron.left"
          accessibilityLabel={t("common.back")}
          disabled={backDisabled}
          onPress={onBack}
        />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={moreLabel}>
          {toolbarMenuItems(actions, onMenu)}
        </Stack.Toolbar.Menu>
        {save ? (
          <Stack.Toolbar.Button
            hidden={!saveShown}
            disabled={saveOff}
            icon="checkmark"
            accessibilityLabel={save.pending ? t("common.saving") : saveLabel}
            onPress={runSave}
          >
            {saveLabel}
          </Stack.Toolbar.Button>
        ) : null}
      </Stack.Toolbar>
    </>
  );
}
