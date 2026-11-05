/**
 * The Slack settings of a trigger and of an output card. A Slack trigger starts a run when a person
 * mentions OpenBot in a workspace and a channel that match it. A Slack output replies in that message's
 * thread, adds a reaction to it, or posts in a channel. The labels that name no service are the Discord
 * ones.
 */

import {
  WORKFLOW_SLACK_ACTIONS,
  WORKFLOW_SLACK_EMOJI,
  WORKFLOW_SLACK_EVENTS,
  WORKFLOW_SLACK_TEXT_LIMIT,
  WORKFLOW_SLACK_TRIGGER_WORKSPACE,
  type WorkflowSlackAction,
  type WorkflowSlackEmoji,
  type WorkflowSlackEvent,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { AtSign, CirclePlus, Hash, Megaphone, MessageSquare, MessageSquareReply, Zap } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { useText } from "../../text";
import { SlackMark } from "../settings/brand-marks";
import { useBoard } from "./workflow-board";
import { asString, type Choice, oneOf, useField, useTextField } from "./workflow-node-parts";
import { InputRow, SettingRow, StaticRow } from "./workflow-setting-rows";

export function SlackIcon() {
  return <SlackMark class="wfn-github-mark" />;
}

const EVENT_LABEL = {
  mention: "workflow.discord.event.mention",
} as const satisfies Record<WorkflowSlackEvent, AppTextKey>;

const ACTION_LABEL = {
  reply: "workflow.slack.action.reply",
  post: "workflow.discord.action.post",
  react: "workflow.discord.action.react",
} as const satisfies Record<WorkflowSlackAction, AppTextKey>;

const ACTION_ICONS: Record<WorkflowSlackAction, () => JSX.Element> = {
  reply: () => <MessageSquareReply aria-hidden="true" />,
  post: () => <Megaphone aria-hidden="true" />,
  react: () => <CirclePlus aria-hidden="true" />,
};

const EMOJI_LABEL = {
  "✅": "workflow.discord.emoji.check",
  "👀": "workflow.discord.emoji.eyes",
  "🎉": "workflow.discord.emoji.party",
  "❌": "workflow.discord.emoji.cross",
} as const satisfies Record<WorkflowSlackEmoji, AppTextKey>;

/** The Slack workspaces of the host, with their channels. */
function useWorkspaces() {
  const board = useBoard();
  const workspaces = () => board.catalogs().slack ?? [];
  const choices = (): Choice<string>[] =>
    workspaces().map((entry) => ({ value: entry.connectionId, label: entry.name, icon: () => <SlackIcon /> }));
  const channels = (connectionId: string): Choice<string>[] =>
    (workspaces().find((entry) => entry.connectionId === connectionId)?.channels ?? []).map((channel) => ({
      value: channel.id,
      label: channel.name,
      icon: () => <Hash aria-hidden="true" />,
    }));
  return { choices, channels };
}

/* ------------------------------------------------------------- Trigger */

/** The fields that a Slack trigger stores when the user chooses it. The host reads the same names. */
export const SLACK_TRIGGER_DEFAULTS = { event: "mention", connectionId: "", placeId: "" } as const;

export function SlackTriggerRows(props: { id: string; locked: boolean }) {
  const { t } = useText();
  const board = useBoard();
  const workspaces = useWorkspaces();
  const id = () => props.id;
  const [connectionId] = useField<string>(id, "connectionId", "", asString);
  const [event, setEvent] = useField<WorkflowSlackEvent>(
    id,
    "event",
    SLACK_TRIGGER_DEFAULTS.event,
    oneOf(WORKFLOW_SLACK_EVENTS),
  );
  const [placeId, setPlaceId] = useField<string>(id, "placeId", SLACK_TRIGGER_DEFAULTS.placeId, asString);
  const [text, setText] = useTextField(id, "text", "");
  /** Channels belong to one workspace, so a new workspace starts with none, in one change. */
  const setWorkspace = (value: string) => board.setFields(props.id, { connectionId: value, placeId: "" });
  const channels = (): Choice<string>[] => [
    { value: "", label: t("workflow.discord.anyChannel"), icon: () => <Hash aria-hidden="true" /> },
    ...workspaces.channels(connectionId()),
  ];
  return (
    <>
      <SettingRow
        name={t("workflow.slack.workspace")}
        value={connectionId()}
        placeholder={t("workflow.slack.chooseWorkspace")}
        choices={workspaces.choices()}
        disabled={props.locked}
        onChange={setWorkspace}
      />
      <SettingRow
        name={t("workflow.discord.event")}
        value={event()}
        choices={WORKFLOW_SLACK_EVENTS.map((value) => ({
          value,
          label: t(EVENT_LABEL[value]),
          icon: () => <AtSign aria-hidden="true" />,
        }))}
        disabled={props.locked}
        onChange={setEvent}
      />
      <SettingRow
        name={t("workflow.node.place.channel")}
        value={placeId()}
        choices={channels()}
        disabled={props.locked}
        onChange={setPlaceId}
      />
      <InputRow
        name={t("workflow.discord.text")}
        value={text()}
        placeholder={t("workflow.discord.anyText")}
        disabled={props.locked}
        onChange={(value) => setText(value.slice(0, WORKFLOW_SLACK_TEXT_LIMIT))}
      />
    </>
  );
}

/* -------------------------------------------------------------- Output */

/** The fields that a Slack output stores when the user chooses it. The host reads the same names. */
export const SLACK_OUTPUT_DEFAULTS = {
  connectionId: WORKFLOW_SLACK_TRIGGER_WORKSPACE,
  action: "reply",
  placeId: "",
} as const;

export function SlackOutputRows(props: { id: string; locked: boolean }) {
  const { t } = useText();
  const board = useBoard();
  const workspaces = useWorkspaces();
  const id = () => props.id;
  const [connectionId] = useField<string>(id, "connectionId", SLACK_OUTPUT_DEFAULTS.connectionId, asString);
  const [action, setAction] = useField<WorkflowSlackAction>(
    id,
    "action",
    SLACK_OUTPUT_DEFAULTS.action,
    oneOf(WORKFLOW_SLACK_ACTIONS),
  );
  const [placeId, setPlaceId] = useField<string>(id, "placeId", "", asString);
  const [emoji, setEmoji] = useField<WorkflowSlackEmoji>(
    id,
    "emoji",
    WORKFLOW_SLACK_EMOJI[0],
    oneOf(WORKFLOW_SLACK_EMOJI),
  );
  const posts = () => action() === "post";
  /** A channel belongs to one workspace, so a new workspace starts with none, in one change. */
  const setWorkspace = (value: string) => board.setFields(props.id, { connectionId: value, placeId: "" });
  /** A post needs a channel of a known workspace. A reply and a reaction act on the trigger's message. */
  const workspaceChoices = (): Choice<string>[] =>
    posts()
      ? workspaces.choices()
      : [
          {
            value: WORKFLOW_SLACK_TRIGGER_WORKSPACE,
            label: t("workflow.discord.sameServer"),
            icon: () => <Zap aria-hidden="true" />,
          },
          ...workspaces.choices(),
        ];
  return (
    <>
      <SettingRow
        name={t("workflow.slack.workspace")}
        value={connectionId()}
        placeholder={t("workflow.slack.chooseWorkspace")}
        choices={workspaceChoices()}
        disabled={props.locked}
        onChange={setWorkspace}
      />
      <Show
        when={posts()}
        fallback={
          <StaticRow name={t("workflow.discord.on")}>
            <MessageSquare aria-hidden="true" />
            <span class="wfn-row-text">{t("workflow.discord.sameMessage")}</span>
          </StaticRow>
        }
      >
        <SettingRow
          name={t("workflow.node.place.channel")}
          value={placeId()}
          placeholder={t("workflow.node.place.choose")}
          choices={workspaces.channels(connectionId())}
          disabled={props.locked}
          onChange={setPlaceId}
        />
      </Show>
      <SettingRow
        name={t("workflow.discord.action")}
        value={action()}
        choices={WORKFLOW_SLACK_ACTIONS.map((value) => ({
          value,
          label: t(ACTION_LABEL[value]),
          icon: ACTION_ICONS[value],
        }))}
        disabled={props.locked}
        onChange={setAction}
      />
      <Show when={action() === "react"}>
        <SettingRow
          name={t("workflow.discord.emoji")}
          value={emoji()}
          choices={WORKFLOW_SLACK_EMOJI.map((value) => ({
            value,
            label: t(EMOJI_LABEL[value]),
            icon: () => (
              <span class="wfn-emoji" aria-hidden="true">
                {value}
              </span>
            ),
          }))}
          disabled={props.locked}
          onChange={setEmoji}
        />
      </Show>
    </>
  );
}
