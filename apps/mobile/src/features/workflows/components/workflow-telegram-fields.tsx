import { WORKFLOW_TELEGRAM_EMOJI, WORKFLOW_TELEGRAM_TRIGGER_CHAT, type WorkflowNode } from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { Typography } from "heroui-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { TELEGRAM_ACTION_LABEL, telegramAction } from "@/features/workflows/model/workflow-steps";
import { useText } from "@/shared/lib/text";

const text = (node: WorkflowNode, name: string) => {
  const value = node.fields[name];
  return typeof value === "string" ? value : "";
};

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <SettingsRow
      trailing={
        <Typography.Paragraph className="text-grouped-secondary" numberOfLines={1}>
          {value}
        </Typography.Paragraph>
      }
    >
      <Typography.Paragraph>{label}</Typography.Paragraph>
    </SettingsRow>
  );
}

/**
 * The settings of a Telegram trigger, read-only. The linked Telegram chats are on the computer that runs
 * OpenBot only, so a joined device shows what the trigger keeps.
 */
export function TelegramTriggerFields({ node }: { node: WorkflowNode }) {
  const { t } = useText();
  const filter = text(node, "text");
  return (
    <SettingsSection title={t("mobile.workflow.trigger.telegram")} footer={t("mobile.workflow.telegram.hostOnly")}>
      <ValueRow
        label={t("mobile.workflow.telegram.chat")}
        value={
          text(node, "connectionId") ? t("mobile.workflow.telegram.oneChat") : t("mobile.workflow.telegram.anyChat")
        }
      />
      <ValueRow label={t("mobile.workflow.telegram.event")} value={t("mobile.workflow.telegram.event.mention")} />
      <ValueRow label={t("mobile.workflow.telegram.text")} value={filter || t("mobile.workflow.telegram.anyText")} />
    </SettingsSection>
  );
}

/** The settings of a Telegram output, read-only, for the same reason as the trigger's. */
export function TelegramOutputFields({ node }: { node: WorkflowNode }) {
  const { t } = useText();
  const action = telegramAction(node);
  const connectionId = text(node, "connectionId") || WORKFLOW_TELEGRAM_TRIGGER_CHAT;
  const emoji = text(node, "emoji");
  return (
    <SettingsSection title={t("mobile.workflow.output.telegram")} footer={t("mobile.workflow.telegram.hostOnly")}>
      <ValueRow
        label={t("mobile.workflow.telegram.chat")}
        value={
          connectionId === WORKFLOW_TELEGRAM_TRIGGER_CHAT
            ? t("mobile.workflow.telegram.sameChat")
            : t("mobile.workflow.telegram.oneChat")
        }
      />
      {action === "post" ? null : (
        <ValueRow label={t("mobile.workflow.telegram.on")} value={t("mobile.workflow.telegram.sameMessage")} />
      )}
      <ValueRow label={t("mobile.workflow.telegram.action")} value={t(TELEGRAM_ACTION_LABEL[action])} />
      {action === "react" ? (
        <ValueRow
          label={t("mobile.workflow.telegram.emoji")}
          value={isOneOf(WORKFLOW_TELEGRAM_EMOJI, emoji) ? emoji : WORKFLOW_TELEGRAM_EMOJI[0]}
        />
      ) : null}
    </SettingsSection>
  );
}
