import { usePreventRemove } from "expo-router/react-navigation";
import { useState } from "react";
import { Alert } from "react-native";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function useDiscardGuard(
  active: boolean,
  {
    busy,
    leaving,
    warn = false,
  }: {
    busy?: () => boolean;
    leaving?: () => boolean;
    warn?: boolean;
  } = {},
): void {
  const { t } = useText();
  const [discarding, setDiscarding] = useState(false);
  usePreventRemove(!discarding && active, ({ repeat }) => {
    const discard = () => {
      setDiscarding(true);
      repeat();
    };
    if (leaving?.()) {
      discard();
      return;
    }
    if (busy?.()) return;
    if (warn) void haptics.notification("warning");
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      { text: t("mobile.agent.discard.discard"), style: "destructive", onPress: discard },
    ]);
  });
}
