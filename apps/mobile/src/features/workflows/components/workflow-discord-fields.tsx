import {
  WORKFLOW_DISCORD_EMOJI,
  WORKFLOW_DISCORD_TRIGGER_SERVER,
  WORKFLOW_UNLINKED_CONNECTION,
  type WorkflowNode,
  workflowListField,
} from "@openbot/contracts/ipc";
import { SettingsSection } from "@/features/settings/components/settings-content";
import { ValueRow } from "@/features/workflows/components/workflow-value-row";
import { fieldOneOf, fieldText } from "@/features/workflows/model/workflow-node-fields";
import { DISCORD_ACTION_LABEL, discordAction } from "@/features/workflows/model/workflow-steps";
import { useText } from "@/shared/lib/text";

export function DiscordTriggerFields({ node }: { node: WorkflowNode }) {
  const { t, format } = useText();
  const roles = workflowListField(node.fields.roles);
  const filter = fieldText(node, "text");
  return (
    <SettingsSection title={t("mobile.workflow.trigger.discord")} footer={t("mobile.workflow.discord.hostOnly")}>
      <ValueRow label={t("mobile.workflow.discord.event")} value={t("mobile.workflow.discord.event.mention")} />
      <ValueRow
        label={t("mobile.workflow.discord.channel")}
        value={
          fieldText(node, "placeId") ? t("mobile.workflow.discord.oneChannel") : t("mobile.workflow.discord.anyChannel")
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

export function DiscordOutputFields({ node }: { node: WorkflowNode }) {
  const { t } = useText();
  const action = discordAction(node);
  const connectionId = fieldText(node, "connectionId") || WORKFLOW_DISCORD_TRIGGER_SERVER;
  return (
    <SettingsSection title={t("mobile.workflow.output.discord")} footer={t("mobile.workflow.discord.hostOnly")}>
      <ValueRow
        label={t("mobile.workflow.discord.server")}
        value={
          connectionId === WORKFLOW_DISCORD_TRIGGER_SERVER
            ? t("mobile.workflow.discord.sameServer")
            : connectionId === WORKFLOW_UNLINKED_CONNECTION
              ? t("mobile.workflow.discord.chooseServer")
              : t("mobile.workflow.discord.oneServer")
        }
      />
      <ValueRow label={t("mobile.workflow.discord.action")} value={t(DISCORD_ACTION_LABEL[action])} />
      {action === "post" ? (
        <ValueRow
          label={t("mobile.workflow.discord.channel")}
          value={
            fieldText(node, "placeId")
              ? t("mobile.workflow.discord.oneChannel")
              : t("mobile.workflow.discord.noChannel")
          }
        />
      ) : (
        <ValueRow label={t("mobile.workflow.discord.on")} value={t("mobile.workflow.discord.sameMessage")} />
      )}
      {action === "react" ? (
        <ValueRow
          label={t("mobile.workflow.discord.emoji")}
          value={fieldOneOf(node, "emoji", WORKFLOW_DISCORD_EMOJI, WORKFLOW_DISCORD_EMOJI[0])}
        />
      ) : null}
    </SettingsSection>
  );
}
