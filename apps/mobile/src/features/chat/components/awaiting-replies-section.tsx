import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Spinner, Typography } from "heroui-native";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";
import type { AwaitingReply, AwaitingReplyState } from "../model/awaiting-replies";
import { ThinkingTextGradient } from "./thinking-text-gradient";

const AVATAR_SIZE = 28;

const STATE_KEYS = {
  asked: "mobile.chat.queue.replyState.asked",
  working: "mobile.chat.queue.replyState.working",
  replied: "mobile.chat.queue.replyState.replied",
  failed: "mobile.chat.queue.replyState.failed",
} as const satisfies Record<AwaitingReplyState, MobileTextKey>;

/**
 * The teammates this agent asked, and the answers that wait for its next turn. It has no row
 * actions: an answer is not the user's message, so edit, steer and reorder do not apply to it.
 * When no teammate still works, the person can hide the rows, as on desktop.
 */
export function AwaitingRepliesSection({
  rows,
  agents,
  self,
  onHide,
}: {
  rows: readonly AwaitingReply[];
  agents: readonly MobileAgent[];
  self: MobileAgent | undefined;
  onHide: () => void;
}) {
  const { t } = useText();
  const [secondaryColor, primaryColor] = useCSSVariable(["--openbot-text-grouped-secondary", "--openbot-text-primary"]);
  const secondary = String(secondaryColor);
  if (rows.length === 0) return null;
  // The host holds the answers until every teammate of the request is done.
  const pending = rows.some((row) => row.state === "asked" || row.state === "working");
  const name = self?.name ?? t("mobile.chat.queue.replyAgentFallback");
  return (
    <>
      <SettingsSection
        title={t("mobile.chat.queue.repliesTitle")}
        footer={
          pending
            ? t("mobile.chat.queue.repliesWaitForAll", { name })
            : t("mobile.chat.queue.repliesReadNext", { name })
        }
      >
        {rows.map((row) => {
          const agent = agents.find((candidate) => candidate.id === row.agentId);
          return (
            <SettingsRow
              key={row.id}
              leading={
                agent ? (
                  <BloubAvatarThumbnail
                    agentId={agent.id}
                    serverId={agent.serverId}
                    hue={agent.avatarHue}
                    seed={agent.avatarSeed}
                    size={AVATAR_SIZE}
                  />
                ) : (
                  <View className="rounded-full bg-control" style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }} />
                )
              }
              trailing={
                row.state === "working" ? (
                  // Like the desktop block and the chat activity row: a teammate at work moves.
                  <View className="flex-row items-center gap-2" accessible accessibilityLabel={t(STATE_KEYS.working)}>
                    <Spinner size="sm" color={secondary} />
                    <ThinkingTextGradient
                      text={t(STATE_KEYS.working)}
                      foreground={String(primaryColor)}
                      muted={secondary}
                      enabled
                      fill={false}
                    >
                      <Typography.Paragraph type="body-sm" style={{ color: secondary }}>
                        {t(STATE_KEYS.working)}
                      </Typography.Paragraph>
                    </ThinkingTextGradient>
                  </View>
                ) : (
                  <Typography
                    type="body-sm"
                    className={row.state === "failed" ? "text-danger-text" : "text-grouped-secondary"}
                  >
                    {t(STATE_KEYS[row.state])}
                  </Typography>
                )
              }
            >
              <Typography>{agent?.name ?? t("mobile.chat.queue.replyAgentFallback")}</Typography>
              {row.preview ? (
                <Typography.Paragraph type="body-sm" numberOfLines={2} className="text-grouped-secondary">
                  {row.preview}
                </Typography.Paragraph>
              ) : null}
            </SettingsRow>
          );
        })}
      </SettingsSection>
      {pending ? null : (
        <SettingsSection>
          <SettingsRow disclosure={false} onPress={onHide}>
            <Typography>{t("mobile.chat.queue.repliesHide")}</Typography>
          </SettingsRow>
        </SettingsSection>
      )}
    </>
  );
}
