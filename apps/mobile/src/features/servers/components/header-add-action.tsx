import { Stack } from "expo-router";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { Plus } from "@/shared/icons";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";

/** The "+" of the header: the native toolbar on iOS. */
export function HeaderAddAction({ label, onPress }: { label: string; onPress: () => void }) {
  const press = () => {
    void haptics.impact("light");
    onPress();
  };
  if (isAndroid)
    return <AndroidHeaderButton placement="right" icon={Plus} accessibilityLabel={label} onPress={press} />;
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button icon={isIOS ? "plus" : undefined} accessibilityLabel={label} onPress={press}>
        {isIOS ? undefined : "+"}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}
