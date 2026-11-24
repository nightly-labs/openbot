import { Typography } from "heroui-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { ConnectionStatusReveal } from "@/features/workspace/components/connection-status-reveal";
import { useText } from "@/shared/lib/text";

const SYNC_STATUS_DELAY_MS = 1_000;

function useShownAfterDelay(active: boolean): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(active), active ? SYNC_STATUS_DELAY_MS : 0);
    return () => clearTimeout(timer);
  }, [active]);
  return shown;
}

function ChatSyncStatusText() {
  const { t } = useText();
  const label = t("mobile.chat.history.syncing");
  return (
    <View accessible accessibilityLabel={label} className="items-center px-5 pb-1 pt-1">
      <Typography.Paragraph
        type="body-xs"
        className="shrink text-text-secondary"
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
      >
        {label}
      </Typography.Paragraph>
    </View>
  );
}

export function ChatSyncStatus({ syncing }: { syncing: boolean }) {
  const shown = useShownAfterDelay(syncing);
  return (
    <ConnectionStatusReveal value={shown ? true : null} collapseOnHide>
      {() => <ChatSyncStatusText />}
    </ConnectionStatusReveal>
  );
}
