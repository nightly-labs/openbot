import type { ChannelAudienceTarget, ChannelTask } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Button, Typography } from "heroui-native";
import { ScrollView, View } from "react-native";
import { useText } from "@/shared/lib/text";
import { mentionDraft } from "../../chat/model/chat-mentions";
import type { NativeAudienceState } from "../model/channel-audience-send";

export interface NativeAudienceControls {
  state: NativeAudienceState;
  check: () => Promise<void>;
  retry: () => Promise<void>;
  close: () => Promise<void>;
  cancelPreparation: () => void;
  stop: (targets: readonly ChannelAudienceTarget[]) => Promise<void>;
}
const STATES = {
  queued: "mobile.channel.audience.queued",
  waiting: "mobile.channel.audience.waiting",
  running: "mobile.channel.audience.running",
  paused: "mobile.channel.task.paused",
  completed: "mobile.channel.audience.completed",
  failed: "mobile.channel.task.failed",
  cancelled: "mobile.channel.audience.cancelled",
} as const satisfies Record<ChannelTask["state"], MobileTextKey>;

export function ChannelAudienceStatus({
  controls,
  members,
  tasks,
  online,
}: {
  controls: NativeAudienceControls;
  members: readonly { id: string; name: string }[];
  tasks: readonly ChannelTask[];
  online: boolean;
}) {
  const { t, errorMessage } = useText();
  const { pending, busy, error } = controls.state;
  if (!pending && !error) return null;
  const result = pending?.result;
  const targets = result && !("status" in result) ? result.targets : [];
  const actionable = targets.filter((target) => {
    const state = tasks.find((task) => task.id === target.taskId)?.state;
    const stop = pending?.stops.find((item) => item.taskId === target.taskId);
    return !stop?.done && (stop || (state !== "completed" && state !== "cancelled"));
  });
  const run = (action: () => Promise<void>) => {
    void action().catch(() => undefined);
  };
  return (
    <View className="bg-background gap-2 px-4 py-2">
      {pending ? (
        <>
          <Typography.Paragraph>
            {t(
              controls.state.localConfirmationPending
                ? "mobile.channel.audience.localConfirmation"
                : result
                  ? "status" in result
                    ? "mobile.channel.audience.refused"
                    : "mobile.channel.audience.accepted"
                  : pending.uploadingId
                    ? "mobile.channel.audience.uploadUnknown"
                    : pending.submitted
                      ? "mobile.channel.audience.unknown"
                      : pending.files.length !== pending.sources.length
                        ? "mobile.channel.audience.filesIncomplete"
                        : "mobile.channel.audience.preparing",
            )}
          </Typography.Paragraph>
          <Typography.Paragraph numberOfLines={2} className="text-muted">
            {mentionDraft(pending.input.text).text}
          </Typography.Paragraph>
          {pending.sources.length ? (
            <Typography.Paragraph className="text-muted">
              {t("mobile.channel.audience.files", { count: pending.sources.length })}
              {" · "}
              {pending.sources.map((file) => file.name).join(", ")}
            </Typography.Paragraph>
          ) : null}
          {pending.input.replyToMessageId ? (
            <Typography.Paragraph className="text-muted">
              {t("mobile.channel.audience.savedReply")}
            </Typography.Paragraph>
          ) : null}
          <ScrollView style={{ maxHeight: 240 }} keyboardShouldPersistTaps="handled">
            {targets.map((target) => {
              const task = tasks.find((item) => item.id === target.taskId);
              const stop = pending.stops.find((item) => item.taskId === target.taskId);
              const name = members.find((member) => member.id === target.agentId)?.name ?? target.agentId;
              return (
                <View key={target.taskId} className="flex-row items-center gap-2">
                  <Typography.Paragraph className="flex-1">
                    {members.find((member) => member.id === target.agentId)?.name ?? target.agentId}
                    {" · "}
                    {stop && !stop.done
                      ? t("mobile.channel.audience.stopUnknown")
                      : task
                        ? t(STATES[task.state])
                        : t("mobile.channel.audience.statusUnavailable")}
                  </Typography.Paragraph>
                  {!stop?.done &&
                  ((stop && !stop.done) || (task?.state !== "completed" && task?.state !== "cancelled")) ? (
                    <Button
                      size="sm"
                      variant="tertiary"
                      isDisabled={busy || !online}
                      onPress={() => run(() => controls.stop([target]))}
                    >
                      <Button.Label>
                        {t(
                          stop && !stop.done
                            ? "mobile.channel.audience.retryStopFor"
                            : "mobile.channel.audience.stopFor",
                          { name },
                        )}
                      </Button.Label>
                    </Button>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
          <View className="flex-row flex-wrap gap-2">
            {busy && !pending.submitted ? (
              <Button
                size="sm"
                variant="tertiary"
                isDisabled={controls.state.cancelRequested}
                onPress={controls.cancelPreparation}
              >
                <Button.Label>
                  {t(
                    controls.state.cancelRequested
                      ? "mobile.channel.audience.cancelRequested"
                      : "mobile.channel.audience.cancelPreparation",
                  )}
                </Button.Label>
              </Button>
            ) : null}
            {!result && pending.submitted ? (
              <Button size="sm" variant="tertiary" isDisabled={busy || !online} onPress={() => run(controls.check)}>
                <Button.Label>
                  {t(
                    controls.state.localConfirmationPending
                      ? "mobile.channel.audience.saveConfirmation"
                      : "mobile.channel.audience.check",
                  )}
                </Button.Label>
              </Button>
            ) : null}
            {!result &&
            !controls.state.localConfirmationPending &&
            !pending.uploadingId &&
            pending.files.length === pending.sources.length ? (
              <Button size="sm" variant="tertiary" isDisabled={busy || !online} onPress={() => run(controls.retry)}>
                <Button.Label>
                  {t(pending.submitted ? "mobile.channel.audience.retry" : "mobile.channel.audience.continue")}
                </Button.Label>
              </Button>
            ) : null}
            {actionable.length > 1 ? (
              <Button
                size="sm"
                variant="tertiary"
                isDisabled={busy || !online}
                onPress={() => run(() => controls.stop(actionable))}
              >
                <Button.Label>{t("mobile.channel.audience.stopGroup")}</Button.Label>
              </Button>
            ) : null}
            {(!pending.submitted || result) && !pending.stops.some((stop) => !stop.done) ? (
              <Button size="sm" variant="tertiary" isDisabled={busy} onPress={() => run(controls.close)}>
                <Button.Label>
                  {t(result ? "mobile.channel.audience.close" : "mobile.channel.audience.discardUnsent")}
                </Button.Label>
              </Button>
            ) : null}
          </View>
        </>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {errorMessage(error, t("mobile.channel.audience.failed"))}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}
