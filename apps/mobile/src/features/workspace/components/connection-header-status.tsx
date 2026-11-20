import { REMOTE_RETRY_LIMIT } from "@openbot/team-client";
import { Typography } from "heroui-native";
import { useWindowDimensions, View } from "react-native";

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
import { ErrorReference } from "@/shared/components/error-reference";
import { useText } from "@/shared/lib/text";

function StatusText({ server: shown }: { server: MobileServer }) {
  const { t, sourceText } = useText();
  const server = useLiveServerRecovery(shown);
  const recovery = server.recoveryStatus;
  const reconnecting = recovery && recovery.phase !== "online" && recovery.phase !== "suspended";
  const title = reconnecting ? t("mobile.workspace.status.reconnecting") : serverStatusLabel(server, t);
  const detail = reconnecting
    ? t("mobile.workspace.status.attempt", { attempt: recoveryAttempt(recovery), limit: REMOTE_RETRY_LIMIT })
    : server.connectionMessage && sourceText(server.connectionMessage);
  const remainingSeconds = reconnecting ? recoveryCountdown(recovery) : null;
  const failure = server.connectionFailure;
  const reference = failure?.reference ?? null;

  return (
    <View
      accessible
      accessibilityLabel={[
        title,
        detail,
        remainingSeconds !== null && remainingSeconds > 0
          ? t("mobile.workspace.status.retryIn", { seconds: remainingSeconds })
          : null,
        reconnecting && failure ? sourceText(failure.message) : null,
        reference ? t("error.reference.label", { code: reference }) : null,
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
            <AnimatedCounter value={String(recoveryAttempt(recovery))} />
            <Typography.Paragraph type="body-xs" className="text-text-secondary" maxFontSizeMultiplier={1.2}>
              /{REMOTE_RETRY_LIMIT}
            </Typography.Paragraph>
          </>
        ) : reference ? (
          <ErrorReference reference={reference} numberOfLines={1} />
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

const STATUS_MAX_WIDTH = 164;
const STATUS_MIN_WIDTH = 96;
const HEADER_CHROME_WIDTH = 270;

function headerStatusWidth(windowWidth: number): number {
  return Math.max(STATUS_MIN_WIDTH, Math.min(STATUS_MAX_WIDTH, windowWidth - HEADER_CHROME_WIDTH));
}

export function ConnectionHeaderStatus({ server, fill = false }: { server: MobileServer | undefined; fill?: boolean }) {
  const { width: windowWidth } = useWindowDimensions();
  return (
    <View
      className="justify-center"
      style={fill ? { flex: 1, minWidth: 0, height: 44 } : { width: headerStatusWidth(windowWidth), height: 44 }}
    >
      <ConnectionStatusReveal
        value={server && !server.initialConnectionPending && !showsOnline(server) ? server : null}
      >
        {(displayed) => <StatusText server={displayed} />}
      </ConnectionStatusReveal>
    </View>
  );
}
