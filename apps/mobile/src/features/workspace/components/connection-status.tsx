import { REMOTE_RETRY_LIMIT } from "@openbot/team-client";
import { Typography } from "heroui-native";
import { View } from "react-native";

import { ConnectionCountdown } from "@/features/workspace/components/connection-countdown";
import { AnimatedCounter } from "@/features/workspace/components/connection-counter";
import { ConnectionStatusReveal } from "@/features/workspace/components/connection-status-reveal";
import { useLiveServerRecovery } from "@/features/workspace/context/server-recovery-countdown";
import {
  recoveryAttempt,
  recoveryCountdown,
  serverStatusLabel,
  showsOnline,
} from "@/features/workspace/model/server-status";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";

function ConnectionStatusText({ server: shown, note }: { server: MobileServer; note: string | null }) {
  const { t, sourceText } = useText();
  const server = useLiveServerRecovery(shown);
  const recovery = server.recoveryStatus;
  const reconnecting = recovery && recovery.phase !== "online" && recovery.phase !== "suspended";
  const title = reconnecting ? t("mobile.workspace.status.reconnecting") : serverStatusLabel(server, t);
  const detail = reconnecting
    ? t("mobile.workspace.status.attempt", { attempt: recoveryAttempt(recovery), limit: REMOTE_RETRY_LIMIT })
    : server.connectionMessage && sourceText(server.connectionMessage);
  const remainingSeconds = reconnecting ? recoveryCountdown(recovery) : null;

  return (
    <View
      accessible
      accessibilityLabel={[
        title,
        detail,
        remainingSeconds !== null && remainingSeconds > 0
          ? t("mobile.workspace.status.retryIn", { seconds: remainingSeconds })
          : null,
        note,
      ]
        .filter(Boolean)
        .join(". ")}
      className="items-center px-5 pb-1 pt-1"
    >
      <View className="flex-row items-center justify-center">
        <Typography.Paragraph
          type="body-xs"
          className="shrink text-text-secondary"
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
        >
          {reconnecting ? `${title} · ` : detail ? `${title} · ${detail}` : title}
        </Typography.Paragraph>
        {reconnecting ? (
          <>
            <AnimatedCounter value={String(recoveryAttempt(recovery))} />
            <Typography.Paragraph type="body-xs" className="text-text-secondary" maxFontSizeMultiplier={1.2}>
              /{REMOTE_RETRY_LIMIT}
            </Typography.Paragraph>
          </>
        ) : null}
        <ConnectionCountdown seconds={remainingSeconds} />
      </View>
      {note ? (
        <Typography.Paragraph
          type="body-xs"
          align="center"
          className="text-muted"
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
        >
          {note}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}

export function ConnectionStatus({ server, note = null }: { server: MobileServer | undefined; note?: string | null }) {
  return (
    <ConnectionStatusReveal
      value={server && !server.initialConnectionPending && !showsOnline(server) ? server : null}
      collapseOnHide
    >
      {(displayed) => <ConnectionStatusText server={displayed} note={note} />}
    </ConnectionStatusReveal>
  );
}
