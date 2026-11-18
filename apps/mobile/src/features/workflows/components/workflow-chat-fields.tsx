import {
  canAdministerServer,
  type RoutineResultConnectionOption,
  WORKFLOW_SLACK_ACTIONS,
  WORKFLOW_SLACK_EMOJI,
  WORKFLOW_SLACK_TEXT_LIMIT,
  WORKFLOW_SLACK_TRIGGER_WORKSPACE,
  WORKFLOW_TELEGRAM_ACTIONS,
  WORKFLOW_TELEGRAM_EMOJI,
  WORKFLOW_TELEGRAM_TEXT_LIMIT,
  WORKFLOW_TELEGRAM_TRIGGER_CHAT,
  type WorkflowNode,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { Typography } from "heroui-native";
import { useUniwind } from "uniwind";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { useWorkflowChats, useWorkflowChatsSupported } from "@/features/workflows/model/use-workflows";
import { channelName, slackWorkspaces, telegramChats } from "@/features/workflows/model/workflow-chats";
import { useWorkflowDraft, type WorkflowDraft } from "@/features/workflows/model/workflow-draft";
import {
  SLACK_ACTION_LABEL,
  slackAction,
  TELEGRAM_ACTION_LABEL,
  telegramAction,
} from "@/features/workflows/model/workflow-steps";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { useText } from "@/shared/lib/text";

const text = (node: WorkflowNode, name: string) => {
  const value = node.fields[name];
  return typeof value === "string" ? value : "";
};

interface Choice {
  value: string;
  label: string;
}

/**
 * Who may change a Telegram or Slack step on this server, and the host's chats. The host takes a change
 * of one only from an owner or admin, and gives the routine-results options only to them
 * (`workflows-chats-v1`). Without the options, the step shows what it keeps, read-only.
 */
export function useChatAccess(draft: Pick<WorkflowDraft, "serverId" | "mode"> | null) {
  const serverId = draft?.serverId ?? "";
  const admin = useMobileWorkspaceSelector((current) =>
    canAdministerServer(current.servers.find((server) => server.id === serverId)?.role),
  );
  const supported = useWorkflowChatsSupported(serverId);
  const chats = useWorkflowChats(serverId, admin);
  const options = admin && supported ? chats.data : undefined;
  return {
    admin,
    supported,
    options,
    failed: admin && supported && chats.isError,
    editable: options !== undefined && draft !== null && draft.mode !== "read-only",
  };
}

/** Why the step is read-only: the host cannot change it from a phone, the person is a member, or no chats came. */
function ChatNote({ access, hostOnly }: { access: ReturnType<typeof useChatAccess>; hostOnly: string }) {
  const { t } = useText();
  if (!access.supported) return <SettingsNote>{hostOnly}</SettingsNote>;
  if (!access.admin) return <SettingsNote>{t("mobile.workflow.chats.adminOnly")}</SettingsNote>;
  if (access.failed) return <SettingsNote>{t("mobile.workflow.chats.loadFailed")}</SettingsNote>;
  return null;
}

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

/** A row with a native picker. A stored value that the host does not offer now stays a choice. */
function PickerRow({
  label,
  value,
  choices,
  missing,
  onChange,
}: {
  label: string;
  value: string;
  choices: Choice[];
  /** The label of a stored value that is not in `choices`. */
  missing: string;
  onChange: (value: string) => void;
}) {
  const { theme } = useUniwind();
  const known = choices.some((choice) => choice.value === value);
  return (
    <SettingsRow
      trailing={
        <SettingsPicker<string>
          value={value}
          enabled
          dark={theme === "dark"}
          label={label}
          options={known ? choices : [{ value, label: missing }, ...choices]}
          onChange={onChange}
        />
      }
    >
      <Typography.Paragraph>{label}</Typography.Paragraph>
    </SettingsRow>
  );
}

/** The text filter of a trigger: a run starts only when the message has this text. */
function TextFilter({ node, limit, editable }: { node: WorkflowNode; limit: number; editable: boolean }) {
  const { t } = useText();
  const setFields = useWorkflowDraft((state) => state.setFields);
  return (
    <SheetFormField
      label={t("mobile.workflow.telegram.text")}
      placeholder={t("mobile.workflow.telegram.anyText")}
      value={text(node, "text")}
      maxLength={limit}
      editable={editable}
      onChangeText={(value) => setFields(node.id, { text: value.slice(0, limit) })}
    />
  );
}

const connectionChoices = (connections: readonly RoutineResultConnectionOption[]): Choice[] =>
  connections.map((connection) => ({ value: connection.connectionId, label: connection.connectionName }));

const placeChoices = (connections: readonly RoutineResultConnectionOption[], connectionId: string): Choice[] =>
  (connections.find((connection) => connection.connectionId === connectionId)?.places ?? []).map((place) => ({
    value: place.id,
    label: channelName(place.name),
  }));

/* ------------------------------------------------------------ Telegram */

/** The settings of a Telegram trigger: the chat, the event, and the text that a message must have. */
export function TelegramTriggerFields({ node, draft }: { node: WorkflowNode; draft: WorkflowDraft }) {
  const { t } = useText();
  const setFields = useWorkflowDraft((state) => state.setFields);
  const access = useChatAccess(draft);
  const connectionId = text(node, "connectionId");
  const chats = access.options ? telegramChats(access.options) : null;
  return (
    <>
      <SettingsSection title={t("mobile.workflow.trigger.telegram")}>
        {chats && access.editable ? (
          <PickerRow
            label={t("mobile.workflow.telegram.chat")}
            value={connectionId}
            choices={[{ value: "", label: t("mobile.workflow.telegram.anyChat") }, ...connectionChoices(chats)]}
            missing={t("mobile.workflow.telegram.oneChat")}
            onChange={(next) => setFields(node.id, { connectionId: next })}
          />
        ) : (
          <ValueRow
            label={t("mobile.workflow.telegram.chat")}
            value={connectionId ? t("mobile.workflow.telegram.oneChat") : t("mobile.workflow.telegram.anyChat")}
          />
        )}
        <ValueRow label={t("mobile.workflow.telegram.event")} value={t("mobile.workflow.telegram.event.mention")} />
      </SettingsSection>
      <TextFilter node={node} limit={WORKFLOW_TELEGRAM_TEXT_LIMIT} editable={access.editable} />
      <ChatNote access={access} hostOnly={t("mobile.workflow.telegram.hostOnly")} />
    </>
  );
}

/** The settings of a Telegram output: the chat, the action, and the emoji of a reaction. */
export function TelegramOutputFields({ node, draft }: { node: WorkflowNode; draft: WorkflowDraft }) {
  const { t } = useText();
  const setFields = useWorkflowDraft((state) => state.setFields);
  const access = useChatAccess(draft);
  const action = telegramAction(node);
  const connectionId = text(node, "connectionId") || WORKFLOW_TELEGRAM_TRIGGER_CHAT;
  const stored = text(node, "emoji");
  const emoji = isOneOf(WORKFLOW_TELEGRAM_EMOJI, stored) ? stored : WORKFLOW_TELEGRAM_EMOJI[0];
  const chats = access.options ? telegramChats(access.options) : null;
  const sameChat = t("mobile.workflow.telegram.sameChat");
  return (
    <>
      <SettingsSection title={t("mobile.workflow.output.telegram")}>
        {chats && access.editable ? (
          <PickerRow
            label={t("mobile.workflow.telegram.chat")}
            value={connectionId}
            choices={[{ value: WORKFLOW_TELEGRAM_TRIGGER_CHAT, label: sameChat }, ...connectionChoices(chats)]}
            missing={t("mobile.workflow.telegram.oneChat")}
            onChange={(next) => setFields(node.id, { connectionId: next })}
          />
        ) : (
          <ValueRow
            label={t("mobile.workflow.telegram.chat")}
            value={connectionId === WORKFLOW_TELEGRAM_TRIGGER_CHAT ? sameChat : t("mobile.workflow.telegram.oneChat")}
          />
        )}
        {action === "post" ? null : (
          <ValueRow label={t("mobile.workflow.telegram.on")} value={t("mobile.workflow.telegram.sameMessage")} />
        )}
        {access.editable ? (
          <PickerRow
            label={t("mobile.workflow.telegram.action")}
            value={action}
            choices={WORKFLOW_TELEGRAM_ACTIONS.map((value) => ({ value, label: t(TELEGRAM_ACTION_LABEL[value]) }))}
            missing=""
            onChange={(next) => setFields(node.id, { action: next })}
          />
        ) : (
          <ValueRow label={t("mobile.workflow.telegram.action")} value={t(TELEGRAM_ACTION_LABEL[action])} />
        )}
        {action !== "react" ? null : access.editable ? (
          <PickerRow
            label={t("mobile.workflow.telegram.emoji")}
            value={emoji}
            choices={WORKFLOW_TELEGRAM_EMOJI.map((value) => ({ value, label: value }))}
            missing=""
            onChange={(next) => setFields(node.id, { emoji: next })}
          />
        ) : (
          <ValueRow label={t("mobile.workflow.telegram.emoji")} value={emoji} />
        )}
      </SettingsSection>
      <ChatNote access={access} hostOnly={t("mobile.workflow.telegram.hostOnly")} />
    </>
  );
}

/* --------------------------------------------------------------- Slack */

/** The settings of a Slack trigger: the workspace, the event, the channel, and the text that a message must have. */
export function SlackTriggerFields({ node, draft }: { node: WorkflowNode; draft: WorkflowDraft }) {
  const { t } = useText();
  const setFields = useWorkflowDraft((state) => state.setFields);
  const access = useChatAccess(draft);
  const connectionId = text(node, "connectionId");
  const placeId = text(node, "placeId");
  const workspaces = access.options ? slackWorkspaces(access.options) : null;
  const choose = t("mobile.workflow.slack.chooseWorkspace");
  return (
    <>
      <SettingsSection title={t("mobile.workflow.trigger.slack")}>
        {workspaces && access.editable ? (
          <>
            <PickerRow
              label={t("mobile.workflow.slack.workspace")}
              value={connectionId}
              choices={[...(connectionId ? [] : [{ value: "", label: choose }]), ...connectionChoices(workspaces)]}
              missing={t("mobile.workflow.slack.oneWorkspace")}
              // Channels belong to one workspace, so a new workspace starts with none, in one change.
              onChange={(next) => setFields(node.id, { connectionId: next, placeId: "" })}
            />
            <ValueRow label={t("mobile.workflow.discord.event")} value={t("mobile.workflow.discord.event.mention")} />
            <PickerRow
              label={t("mobile.workflow.discord.channel")}
              value={placeId}
              choices={[
                { value: "", label: t("mobile.workflow.discord.anyChannel") },
                ...placeChoices(workspaces, connectionId),
              ]}
              missing={t("mobile.workflow.discord.oneChannel")}
              onChange={(next) => setFields(node.id, { placeId: next })}
            />
          </>
        ) : (
          <>
            <ValueRow
              label={t("mobile.workflow.slack.workspace")}
              value={connectionId ? t("mobile.workflow.slack.oneWorkspace") : choose}
            />
            <ValueRow label={t("mobile.workflow.discord.event")} value={t("mobile.workflow.discord.event.mention")} />
            <ValueRow
              label={t("mobile.workflow.discord.channel")}
              value={placeId ? t("mobile.workflow.discord.oneChannel") : t("mobile.workflow.discord.anyChannel")}
            />
          </>
        )}
      </SettingsSection>
      <TextFilter node={node} limit={WORKFLOW_SLACK_TEXT_LIMIT} editable={access.editable} />
      {!connectionId && access.editable ? (
        <SettingsNote>{t("mobile.workflow.slack.needsWorkspace")}</SettingsNote>
      ) : null}
      <ChatNote access={access} hostOnly={t("mobile.workflow.slack.hostOnly")} />
    </>
  );
}

/** The settings of a Slack output: the workspace, the channel of a post, the action, and the emoji of a reaction. */
export function SlackOutputFields({ node, draft }: { node: WorkflowNode; draft: WorkflowDraft }) {
  const { t } = useText();
  const setFields = useWorkflowDraft((state) => state.setFields);
  const access = useChatAccess(draft);
  const action = slackAction(node);
  const posts = action === "post";
  const connectionId = text(node, "connectionId") || WORKFLOW_SLACK_TRIGGER_WORKSPACE;
  const placeId = text(node, "placeId");
  const stored = text(node, "emoji");
  const emoji = isOneOf(WORKFLOW_SLACK_EMOJI, stored) ? stored : WORKFLOW_SLACK_EMOJI[0];
  const workspaces = access.options ? slackWorkspaces(access.options) : null;
  const sameWorkspace = t("mobile.workflow.discord.sameServer");
  const workspaceValue =
    connectionId === WORKFLOW_SLACK_TRIGGER_WORKSPACE ? sameWorkspace : t("mobile.workflow.slack.oneWorkspace");
  // A post needs a channel of a known workspace. A reply and a reaction act on the trigger's message.
  const needsPlace = posts && (connectionId === WORKFLOW_SLACK_TRIGGER_WORKSPACE || !placeId);
  return (
    <>
      <SettingsSection title={t("mobile.workflow.output.slack")}>
        {workspaces && access.editable ? (
          <PickerRow
            label={t("mobile.workflow.slack.workspace")}
            value={connectionId}
            choices={[
              ...(posts && connectionId !== WORKFLOW_SLACK_TRIGGER_WORKSPACE
                ? []
                : [{ value: WORKFLOW_SLACK_TRIGGER_WORKSPACE, label: sameWorkspace }]),
              ...connectionChoices(workspaces),
            ]}
            missing={t("mobile.workflow.slack.oneWorkspace")}
            onChange={(next) => setFields(node.id, { connectionId: next, placeId: "" })}
          />
        ) : (
          <ValueRow label={t("mobile.workflow.slack.workspace")} value={workspaceValue} />
        )}
        {!posts ? (
          <ValueRow label={t("mobile.workflow.discord.on")} value={t("mobile.workflow.discord.sameMessage")} />
        ) : workspaces && access.editable ? (
          <PickerRow
            label={t("mobile.workflow.discord.channel")}
            value={placeId}
            choices={[
              ...(placeId ? [] : [{ value: "", label: t("mobile.workflow.slack.chooseChannel") }]),
              ...placeChoices(workspaces, connectionId),
            ]}
            missing={t("mobile.workflow.discord.oneChannel")}
            onChange={(next) => setFields(node.id, { placeId: next })}
          />
        ) : (
          <ValueRow
            label={t("mobile.workflow.discord.channel")}
            value={placeId ? t("mobile.workflow.discord.oneChannel") : t("mobile.workflow.discord.noChannel")}
          />
        )}
        {access.editable ? (
          <PickerRow
            label={t("mobile.workflow.discord.action")}
            value={action}
            choices={WORKFLOW_SLACK_ACTIONS.map((value) => ({ value, label: t(SLACK_ACTION_LABEL[value]) }))}
            missing=""
            onChange={(next) => setFields(node.id, { action: next })}
          />
        ) : (
          <ValueRow label={t("mobile.workflow.discord.action")} value={t(SLACK_ACTION_LABEL[action])} />
        )}
        {action !== "react" ? null : access.editable ? (
          <PickerRow
            label={t("mobile.workflow.discord.emoji")}
            value={emoji}
            choices={WORKFLOW_SLACK_EMOJI.map((value) => ({ value, label: value }))}
            missing=""
            onChange={(next) => setFields(node.id, { emoji: next })}
          />
        ) : (
          <ValueRow label={t("mobile.workflow.discord.emoji")} value={emoji} />
        )}
      </SettingsSection>
      {needsPlace && access.editable ? <SettingsNote>{t("mobile.workflow.slack.needsChannel")}</SettingsNote> : null}
      <ChatNote access={access} hostOnly={t("mobile.workflow.slack.hostOnly")} />
    </>
  );
}
