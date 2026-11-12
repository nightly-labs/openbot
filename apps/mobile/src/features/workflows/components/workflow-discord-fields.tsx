import {
  WORKFLOW_DISCORD_EMOJI,
  WORKFLOW_DISCORD_TRIGGER_SERVER,
  type WorkflowNode,
  workflowListField,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { Typography } from "heroui-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { DISCORD_ACTION_LABEL, discordAction } from "@/features/workflows/model/workflow-steps";
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
 * The settings of a Discord trigger, read-only. The Discord servers, their channels and their roles
 * are on the computer that runs OpenBot only, so a joined device shows what the trigger keeps.
 */
export function DiscordTriggerFields({ node }: { node: WorkflowNode }) {
  const { t, format } = useText();
  const roles = workflowListField(node.fields.roles);
  const filter = text(node, "text");
  return (
    <SettingsSection title={t("mobile.workflow.trigger.discord")} footer={t("mobile.workflow.discord.hostOnly")}>
      <ValueRow label={t("mobile.workflow.discord.event")} value={t("mobile.workflow.discord.event.mention")} />
      <ValueRow
        label={t("mobile.workflow.discord.channel")}
        value={
          text(node, "placeId") ? t("mobile.workflow.discord.oneChannel") : t("mobile.workflow.discord.anyChannel")
        }
      />
      <ValueRow
        label={t("mobile.workflow.discord.roles")}
        value={
          roles.length > 0
            ? t("mobile.workflow.discord.roleCount", { count: roles.length, number: format.number(roles.length) })
            : t("mobile.workflow.discord.anyRole")
        }
      />
      <ValueRow label={t("mobile.workflow.discord.text")} value={filter || t("mobile.workflow.discord.anyText")} />
    </SettingsSection>
  );
}

/** The settings of a Discord output, read-only, for the same reason as the trigger's. */
export function DiscordOutputFields({ node }: { node: WorkflowNode }) {
  const { t } = useText();
  const action = discordAction(node);
  const connectionId = text(node, "connectionId") || WORKFLOW_DISCORD_TRIGGER_SERVER;
  const emoji = text(node, "emoji");
  return (
    <SettingsSection title={t("mobile.workflow.output.discord")} footer={t("mobile.workflow.discord.hostOnly")}>
      <ValueRow
        label={t("mobile.workflow.discord.server")}
        value={
          connectionId === WORKFLOW_DISCORD_TRIGGER_SERVER
            ? t("mobile.workflow.discord.sameServer")
            : t("mobile.workflow.discord.oneServer")
        }
      />
      <ValueRow label={t("mobile.workflow.discord.action")} value={t(DISCORD_ACTION_LABEL[action])} />
      {action === "post" ? (
        <ValueRow
          label={t("mobile.workflow.discord.channel")}
          value={
            text(node, "placeId") ? t("mobile.workflow.discord.oneChannel") : t("mobile.workflow.discord.noChannel")
          }
        />
      ) : (
        <ValueRow label={t("mobile.workflow.discord.on")} value={t("mobile.workflow.discord.sameMessage")} />
      )}
      {action === "react" ? (
        <ValueRow
          label={t("mobile.workflow.discord.emoji")}
          value={isOneOf(WORKFLOW_DISCORD_EMOJI, emoji) ? emoji : WORKFLOW_DISCORD_EMOJI[0]}
        />
      ) : null}
    </SettingsSection>
  );
}
