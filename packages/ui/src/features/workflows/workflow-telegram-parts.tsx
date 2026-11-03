/**
 * The Telegram settings of a trigger and of an output card. A Telegram trigger starts a run when a person
 * starts a conversation with OpenBot in a linked group chat. A Telegram output replies to that message,
 * adds a reaction to it, or posts in a chat.
 */

import {
  WORKFLOW_TELEGRAM_ACTIONS,
  WORKFLOW_TELEGRAM_EMOJI,
  WORKFLOW_TELEGRAM_EVENTS,
  WORKFLOW_TELEGRAM_TEXT_LIMIT,
  WORKFLOW_TELEGRAM_TRIGGER_CHAT,
  type WorkflowTelegramAction,
  type WorkflowTelegramEmoji,
  type WorkflowTelegramEvent,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { AtSign, CirclePlus, Megaphone, MessageSquare, MessageSquareReply, Zap } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { useText } from "../../text";
import { TelegramMark } from "../settings/brand-marks";
import { useBoard } from "./workflow-board";
import { asString, type Choice, oneOf, useField, useTextField } from "./workflow-node-parts";
import { InputRow, SettingRow, StaticRow } from "./workflow-setting-rows";

export function TelegramIcon() {
  return <TelegramMark class="wfn-github-mark" />;
}

const EVENT_LABEL = {
  mention: "workflow.telegram.event.mention",
} as const satisfies Record<WorkflowTelegramEvent, AppTextKey>;

const ACTION_LABEL = {
  reply: "workflow.telegram.action.reply",
  post: "workflow.telegram.action.post",
  react: "workflow.telegram.action.react",
} as const satisfies Record<WorkflowTelegramAction, AppTextKey>;

const ACTION_ICONS: Record<WorkflowTelegramAction, () => JSX.Element> = {
  reply: () => <MessageSquareReply aria-hidden="true" />,
  post: () => <Megaphone aria-hidden="true" />,
  react: () => <CirclePlus aria-hidden="true" />,
};

const EMOJI_LABEL = {
  "👍": "workflow.telegram.emoji.thumbsUp",
  "👀": "workflow.telegram.emoji.eyes",
  "🎉": "workflow.telegram.emoji.party",
  "👌": "workflow.telegram.emoji.okHand",
} as const satisfies Record<WorkflowTelegramEmoji, AppTextKey>;

/** The Telegram chats linked to the host, as choices. */
function useChats() {
  const board = useBoard();
  return (): Choice<string>[] =>
    (board.catalogs().telegram ?? []).map((chat) => ({
      value: chat.connectionId,
      label: chat.name,
      icon: () => <TelegramIcon />,
    }));
}

/* ------------------------------------------------------------- Trigger */

/** The fields that a Telegram trigger stores when the user chooses it. The host reads the same names. */
export const TELEGRAM_TRIGGER_DEFAULTS = { event: "mention", connectionId: "" } as const;

export function TelegramTriggerRows(props: { id: string; locked: boolean }) {
  const { t } = useText();
  const chats = useChats();
  const id = () => props.id;
  const [connectionId, setConnectionId] = useField<string>(
    id,
    "connectionId",
    TELEGRAM_TRIGGER_DEFAULTS.connectionId,
    asString,
  );
  const [event, setEvent] = useField<WorkflowTelegramEvent>(
    id,
    "event",
    TELEGRAM_TRIGGER_DEFAULTS.event,
    oneOf(WORKFLOW_TELEGRAM_EVENTS),
  );
  const [text, setText] = useTextField(id, "text", "");
  return (
    <>
      <SettingRow
        name={t("workflow.telegram.chat")}
        value={connectionId()}
        choices={[{ value: "", label: t("workflow.telegram.anyChat"), icon: () => <TelegramIcon /> }, ...chats()]}
        disabled={props.locked}
        onChange={setConnectionId}
      />
      <SettingRow
        name={t("workflow.telegram.event")}
        value={event()}
        choices={WORKFLOW_TELEGRAM_EVENTS.map((value) => ({
          value,
          label: t(EVENT_LABEL[value]),
          icon: () => <AtSign aria-hidden="true" />,
        }))}
        disabled={props.locked}
        onChange={setEvent}
      />
      <InputRow
        name={t("workflow.telegram.text")}
        value={text()}
        placeholder={t("workflow.telegram.anyText")}
        disabled={props.locked}
        onChange={(value) => setText(value.slice(0, WORKFLOW_TELEGRAM_TEXT_LIMIT))}
      />
    </>
  );
}

/* -------------------------------------------------------------- Output */

/** The fields that a Telegram output stores when the user chooses it. The host reads the same names. */
export const TELEGRAM_OUTPUT_DEFAULTS = { connectionId: WORKFLOW_TELEGRAM_TRIGGER_CHAT, action: "reply" } as const;

export function TelegramOutputRows(props: { id: string; locked: boolean }) {
  const { t } = useText();
  const chats = useChats();
  const id = () => props.id;
  const [connectionId, setConnectionId] = useField<string>(
    id,
    "connectionId",
    TELEGRAM_OUTPUT_DEFAULTS.connectionId,
    asString,
  );
  const [action, setAction] = useField<WorkflowTelegramAction>(
    id,
    "action",
    TELEGRAM_OUTPUT_DEFAULTS.action,
    oneOf(WORKFLOW_TELEGRAM_ACTIONS),
  );
  const [emoji, setEmoji] = useField<WorkflowTelegramEmoji>(
    id,
    "emoji",
    WORKFLOW_TELEGRAM_EMOJI[0],
    oneOf(WORKFLOW_TELEGRAM_EMOJI),
  );
  /** One connection is one chat, so a post needs no channel. A reply and a reaction act on the trigger's message. */
  return (
    <>
      <SettingRow
        name={t("workflow.telegram.chat")}
        value={connectionId()}
        placeholder={t("workflow.telegram.chooseChat")}
        choices={[
          {
            value: WORKFLOW_TELEGRAM_TRIGGER_CHAT,
            label: t("workflow.telegram.sameChat"),
            icon: () => <Zap aria-hidden="true" />,
          },
          ...chats(),
        ]}
        disabled={props.locked}
        onChange={setConnectionId}
      />
      <Show when={action() !== "post"}>
        <StaticRow name={t("workflow.telegram.on")}>
          <MessageSquare aria-hidden="true" />
          <span class="wfn-row-text">{t("workflow.telegram.sameMessage")}</span>
        </StaticRow>
      </Show>
      <SettingRow
        name={t("workflow.telegram.action")}
        value={action()}
        choices={WORKFLOW_TELEGRAM_ACTIONS.map((value) => ({
          value,
          label: t(ACTION_LABEL[value]),
          icon: ACTION_ICONS[value],
        }))}
        disabled={props.locked}
        onChange={setAction}
      />
      <Show when={action() === "react"}>
        <SettingRow
          name={t("workflow.telegram.emoji")}
          value={emoji()}
          choices={WORKFLOW_TELEGRAM_EMOJI.map((value) => ({
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
