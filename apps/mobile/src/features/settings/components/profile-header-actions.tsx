import { Stack } from "expo-router";
import { useThemeColor } from "heroui-native/hooks";
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical";
import { useLayoutEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { useUniwind } from "uniwind";
import { MenuView } from "@/shared/components/menu-view";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

interface ProfileHeaderActionsProps {
  save: { dirty: boolean; canSave: boolean; pending: boolean; label: string; onSave: () => void };
  /** Null while there is no activity to share: the action shows, disabled. */
  onShare: (() => void) | null;
  onSignOut: () => void;
  disabled: boolean;
}

/**
 * The top right of the Profile page: the Save button of the name draft, and the menu with Share
 * and Sign out. iOS shows both in one native bar. An Android header has one right slot, so the
 * Save button takes the place of the menu while the name has changes.
 */
export function ProfileHeaderActions({ save, onShare, onSignOut, disabled }: ProfileHeaderActionsProps) {
  const { t } = useText();
  const { theme } = useUniwind();
  const foreground = String(useThemeColor("foreground"));
  const saving = save.dirty || save.pending;
  const menuLabel = t("mobile.settings.profile.options");
  const shareLabel = t("mobile.settings.profile.share");
  const signOutLabel = t("mobile.settings.profile.signOut");
  const canShare = Boolean(onShare);
  // The header options change only when the menu looks different, as in `AndroidHeaderButton`.
  const actions = useRef({ onShare, onSignOut });
  useLayoutEffect(() => {
    actions.current = { onShare, onSignOut };
  });

  const androidOptions = useMemo(
    () => ({
      headerRight: () => (
        <MenuView
          colorScheme={theme === "dark" ? "dark" : "light"}
          actions={[
            { id: "share", title: shareLabel, attributes: { disabled: disabled || !canShare } },
            { id: "sign-out", title: signOutLabel, attributes: { destructive: true, disabled } },
          ]}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "share") actions.current.onShare?.();
            if (nativeEvent.event === "sign-out") actions.current.onSignOut();
          }}
        >
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel={menuLabel}
            className="size-12 items-center justify-center rounded-full"
          >
            <EllipsisVertical color={foreground} size={22} strokeWidth={2} />
          </View>
        </MenuView>
      ),
    }),
    [canShare, disabled, foreground, menuLabel, shareLabel, signOutLabel, theme],
  );

  if (isAndroid) return saving ? <SheetSaveAction {...save} /> : <Stack.Screen options={androidOptions} />;
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        hidden={!saving}
        disabled={!save.dirty || !save.canSave || save.pending}
        icon="checkmark"
        accessibilityLabel={save.pending ? t("common.saving") : save.label}
        onPress={() => {
          if (!save.dirty || !save.canSave || save.pending) return;
          void haptics.impact("light");
          save.onSave();
        }}
      >
        {save.label}
      </Stack.Toolbar.Button>
      <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={menuLabel} disabled={disabled}>
        <Stack.Toolbar.MenuAction icon="square.and.arrow.up" disabled={!onShare} onPress={() => onShare?.()}>
          {shareLabel}
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="rectangle.portrait.and.arrow.right" destructive onPress={onSignOut}>
          {signOutLabel}
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}
