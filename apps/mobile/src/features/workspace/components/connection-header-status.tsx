import { REMOTE_RETRY_LIMIT } from "@openbot/team-client";
import { Typography } from "heroui-native";
import { View } from "react-native";

import { ConnectionCountdown } from "@/features/workspace/components/connection-countdown";
import { AnimatedCounter } from "@/features/workspace/components/connection-counter";
import { ConnectionStatusReveal } from "@/features/workspace/components/connection-status-reveal";
import { serverStatusLabel } from "@/features/workspace/model/server-status";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";

function StatusText({ server }: { server: MobileServer }) {
  const { t, sourceText } = useText();
  const recovery = server.recoveryStatus;
  const reconnecting = recovery && recovery.phase !== "online" && recovery.phase !== "suspended";
  const title = reconnecting ? t("mobile.workspace.status.reconnecting") : serverStatusLabel(server, t);
  const detail = reconnecting
    ? t("mobile.workspace.status.attempt", { attempt: recovery.attempt, limit: REMOTE_RETRY_LIMIT })
    : server.connectionMessage && sourceText(server.connectionMessage);
  // Connecting reports zero; keep the countdown mounted through the next retry interval.
  const remainingSeconds = reconnecting ? recovery.remainingSeconds : null;

  return (
    <View
      accessible
      accessibilityLabel={[
        title,
        detail,
        remainingSeconds !== null && remainingSeconds > 0
          ? t("mobile.workspace.status.retryIn", { seconds: remainingSeconds })
          : null,
      ]
        .filter(Boolean)
        .join(". ")}
    >
      <Typography.Paragraph weight="semibold" numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {title}
      </Typography.Paragraph>
      <View className="flex-row items-center">
        {reconnecting ? (
          <>
            <Typography.Paragraph type="body-xs" className="text-text-secondary" maxFontSizeMultiplier={1.2}>
              {t("mobile.workspace.status.attemptPrefix")}
            </Typography.Paragraph>
            <AnimatedCounter value={String(recovery.attempt)} />
            <Typography.Paragraph type="body-xs" className="text-text-secondary" maxFontSizeMultiplier={1.2}>
              /{REMOTE_RETRY_LIMIT}
            </Typography.Paragraph>
          </>
        ) : detail ? (
          <Typography.Paragraph
            type="body-xs"
            className="shrink text-text-secondary"
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {detail}
          </Typography.Paragraph>
        ) : null}
        <ConnectionCountdown seconds={remainingSeconds} />
      </View>
    </View>
  );
}

export function ConnectionHeaderStatus({ server }: { server: MobileServer | undefined }) {
  return (
    // Keep this native toolbar slot mounted: removing it would cut off the exit animation.
    <View className="justify-center" style={{ width: 164, height: 44 }}>
      <ConnectionStatusReveal
        value={server && !server.initialConnectionPending && server.state !== "online" ? server : null}
      >
        {(displayed) => <StatusText server={displayed} />}
      </ConnectionStatusReveal>
    </View>
  );
}
