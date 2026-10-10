import { REMOTE_RETRY_LIMIT } from "@openbot/team-client";
import { Typography } from "heroui-native";
import { View } from "react-native";

import { ConnectionCountdown } from "@/features/workspace/components/connection-countdown";
import { AnimatedCounter } from "@/features/workspace/components/connection-counter";
import { ConnectionStatusReveal } from "@/features/workspace/components/connection-status-reveal";
import { recoveryAttempt, recoveryCountdown, serverStatusLabel } from "@/features/workspace/model/server-status";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { ErrorReference } from "@/shared/components/error-reference";
import { useText } from "@/shared/lib/text";

function ConnectionStatusText({ server }: { server: MobileServer }) {
  const { t, sourceText } = useText();
  const recovery = server.recoveryStatus;
  const reconnecting = recovery && recovery.phase !== "online" && recovery.phase !== "suspended";
  const title = reconnecting ? t("mobile.workspace.status.reconnecting") : serverStatusLabel(server, t);
  const detail = reconnecting
    ? t("mobile.workspace.status.attempt", { attempt: recoveryAttempt(recovery), limit: REMOTE_RETRY_LIMIT })
    : server.connectionMessage && sourceText(server.connectionMessage);
  const remainingSeconds = reconnecting ? recoveryCountdown(recovery) : null;
  // The status line shows the attempt while it reconnects, so the failure that caused it goes below.
  // Otherwise the detail of the status line already holds the failure.
  const failure = server.connectionFailure;
  const failureText = reconnecting && failure ? sourceText(failure.message) : null;
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
        failureText,
        reference ? t("error.reference.label", { code: reference }) : null,
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
      {failureText ? (
        <Typography.Paragraph
          type="body-xs"
          align="center"
          className="text-text-secondary"
          numberOfLines={2}
          maxFontSizeMultiplier={1.2}
        >
          {failureText}
        </Typography.Paragraph>
      ) : null}
      <ErrorReference reference={reference} align="center" numberOfLines={1} />
    </View>
  );
}

export function ConnectionStatus({ server }: { server: MobileServer | undefined }) {
  return (
    <ConnectionStatusReveal
      value={server && !server.initialConnectionPending && server.state !== "online" ? server : null}
      collapseOnHide
    >
      {(displayed) => <ConnectionStatusText server={displayed} />}
    </ConnectionStatusReveal>
  );
}
