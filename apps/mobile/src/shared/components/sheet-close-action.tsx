import { Stack } from "expo-router";
import X from "lucide-react-native/icons/x";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

export function SheetCloseAction({ disabled = false, onPress }: { disabled?: boolean; onPress: () => void }) {
  const { t } = useText();
  const label = t("common.close");
  if (isAndroid)
    return (
      <AndroidHeaderButton placement="left" icon={X} accessibilityLabel={label} disabled={disabled} onPress={onPress} />
    );
  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Button
        icon={isIOS ? "xmark" : undefined}
        accessibilityLabel={label}
        disabled={disabled}
        onPress={onPress}
      >
        {isIOS ? label : "×"}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}
