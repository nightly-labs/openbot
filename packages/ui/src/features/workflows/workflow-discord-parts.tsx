/**
 * The Discord settings of a trigger and of an output card. A Discord trigger starts a run when a person
 * mentions OpenBot in a server, a channel and with a role that match it. A Discord output replies to that
 * message, adds a reaction to it, or posts in a channel.
 */

import {
  WORKFLOW_DISCORD_ACTIONS,
  WORKFLOW_DISCORD_EMOJI,
  WORKFLOW_DISCORD_EVENTS,
  WORKFLOW_DISCORD_TEXT_LIMIT,
  WORKFLOW_DISCORD_TRIGGER_SERVER,
  type WorkflowDiscordAction,
  type WorkflowDiscordEmoji,
  type WorkflowDiscordEvent,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { AtSign, CirclePlus, Hash, Megaphone, MessageSquare, MessageSquareReply, Zap } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { useText } from "../../text";
import { DiscordMark } from "../settings/brand-marks";
import { useBoard } from "./workflow-board";
import type { WorkflowDiscordServer } from "./workflow-model";
import { asString, type Choice, oneOf, useField, useTextField } from "./workflow-node-parts";
import { InputRow, SettingListRow, SettingRow, StaticRow, useListField } from "./workflow-setting-rows";

export function DiscordIcon() {
  return <DiscordMark class="wfn-github-mark" />;
}

const EVENT_LABEL = {
  mention: "workflow.discord.event.mention",
} as const satisfies Record<WorkflowDiscordEvent, AppTextKey>;

const ACTION_LABEL = {
  reply: "workflow.discord.action.reply",
  post: "workflow.discord.action.post",
  react: "workflow.discord.action.react",
} as const satisfies Record<WorkflowDiscordAction, AppTextKey>;

const ACTION_ICONS: Record<WorkflowDiscordAction, () => JSX.Element> = {
  reply: () => <MessageSquareReply aria-hidden="true" />,
  post: () => <Megaphone aria-hidden="true" />,
  react: () => <CirclePlus aria-hidden="true" />,
};

const EMOJI_LABEL = {
  "✅": "workflow.discord.emoji.check",
  "👀": "workflow.discord.emoji.eyes",
  "🎉": "workflow.discord.emoji.party",
  "❌": "workflow.discord.emoji.cross",
} as const satisfies Record<WorkflowDiscordEmoji, AppTextKey>;

/** The Discord servers of the host, with their channels and roles. */
function useServers() {
  const board = useBoard();
  const servers = () => board.catalogs().discord ?? [];
  const server = (connectionId: string): WorkflowDiscordServer | undefined =>
    servers().find((entry) => entry.connectionId === connectionId);
  const choices = (): Choice<string>[] =>
    servers().map((entry) => ({ value: entry.connectionId, label: entry.name, icon: () => <DiscordIcon /> }));
  const channels = (connectionId: string): Choice<string>[] =>
    (server(connectionId)?.channels ?? []).map((channel) => ({
      value: channel.id,
      label: channel.name,
      icon: () => <Hash aria-hidden="true" />,
    }));
  return { servers, server, choices, channels };
}

/* ------------------------------------------------------------- Trigger */

/** The fields that a Discord trigger stores when the user chooses it. The host reads the same names. */
export const DISCORD_TRIGGER_DEFAULTS = { event: "mention", placeId: "" } as const;

export function DiscordTriggerRows(props: { id: string; locked: boolean }) {
  const { t } = useText();
  const board = useBoard();
  const servers = useServers();
  const id = () => props.id;
  const [connectionId] = useField<string>(id, "connectionId", "", asString);
  const [event, setEvent] = useField<WorkflowDiscordEvent>(
    id,
    "event",
    DISCORD_TRIGGER_DEFAULTS.event,
    oneOf(WORKFLOW_DISCORD_EVENTS),
  );
  const [placeId, setPlaceId] = useField<string>(id, "placeId", DISCORD_TRIGGER_DEFAULTS.placeId, asString);
  const [roles, setRoles] = useListField(id, "roles", []);
  const [text, setText] = useTextField(id, "text", "");
  /** Channels and roles belong to one server, so a new server starts with none, in one change. */
  const setServer = (value: string) => board.setFields(props.id, { connectionId: value, placeId: "", roles: "" });
  const channels = (): Choice<string>[] => [
    { value: "", label: t("workflow.discord.anyChannel"), icon: () => <Hash aria-hidden="true" /> },
    ...servers.channels(connectionId()),
  ];
  const serverRoles = () => servers.server(connectionId())?.roles ?? [];
  /** Keeps a chosen role that the server no longer lists, after the roles of the server. */
  const roleOptions = () => [
    ...serverRoles().map((role) => role.id),
    ...roles().filter((role) => !serverRoles().some((entry) => entry.id === role)),
  ];
  const roleName = (value: string) => serverRoles().find((role) => role.id === value)?.name ?? value;
  return (
    <>
      <SettingRow
        name={t("workflow.discord.server")}
        value={connectionId()}
        placeholder={t("workflow.discord.chooseServer")}
        choices={servers.choices()}
        disabled={props.locked}
        onChange={setServer}
      />
      <SettingRow
        name={t("workflow.discord.event")}
        value={event()}
        choices={WORKFLOW_DISCORD_EVENTS.map((value) => ({
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
      {/* A server without roles, or no server yet, has nothing to choose. */}
      <Show when={roleOptions().length > 0}>
        <SettingListRow
          name={t("workflow.discord.roles")}
          empty={t("workflow.discord.anyRole")}
          options={roleOptions()}
          values={roles()}
          optionLabel={roleName}
          disabled={props.locked}
          onChange={setRoles}
        />
      </Show>
      <InputRow
        name={t("workflow.discord.text")}
        value={text()}
        placeholder={t("workflow.discord.anyText")}
        disabled={props.locked}
        onChange={(value) => setText(value.slice(0, WORKFLOW_DISCORD_TEXT_LIMIT))}
      />
    </>
  );
}

/* -------------------------------------------------------------- Output */

/** The fields that a Discord output stores when the user chooses it. The host reads the same names. */
export const DISCORD_OUTPUT_DEFAULTS = { connectionId: WORKFLOW_DISCORD_TRIGGER_SERVER, action: "reply" } as const;

export function DiscordOutputRows(props: { id: string; locked: boolean }) {
  const { t } = useText();
  const board = useBoard();
  const servers = useServers();
  const id = () => props.id;
  const [connectionId] = useField<string>(id, "connectionId", DISCORD_OUTPUT_DEFAULTS.connectionId, asString);
  const [action, setAction] = useField<WorkflowDiscordAction>(
    id,
    "action",
    DISCORD_OUTPUT_DEFAULTS.action,
    oneOf(WORKFLOW_DISCORD_ACTIONS),
  );
  const [placeId, setPlaceId] = useField<string>(id, "placeId", "", asString);
  const [emoji, setEmoji] = useField<WorkflowDiscordEmoji>(
    id,
    "emoji",
    WORKFLOW_DISCORD_EMOJI[0],
    oneOf(WORKFLOW_DISCORD_EMOJI),
  );
  const posts = () => action() === "post";
  /** A channel belongs to one server, so a new server starts with none, in one change. */
  const setServer = (value: string) => board.setFields(props.id, { connectionId: value, placeId: "" });
  /** A post needs a channel of a known server. A reply and a reaction act on the trigger's message. */
  const serverChoices = (): Choice<string>[] =>
    posts()
      ? servers.choices()
      : [
          {
            value: WORKFLOW_DISCORD_TRIGGER_SERVER,
            label: t("workflow.discord.sameServer"),
            icon: () => <Zap aria-hidden="true" />,
          },
          ...servers.choices(),
        ];
  return (
    <>
      <SettingRow
        name={t("workflow.discord.server")}
        value={connectionId()}
        placeholder={t("workflow.discord.chooseServer")}
        choices={serverChoices()}
        disabled={props.locked}
        onChange={setServer}
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
          choices={servers.channels(connectionId())}
          disabled={props.locked}
          onChange={setPlaceId}
        />
      </Show>
      <SettingRow
        name={t("workflow.discord.action")}
        value={action()}
        choices={WORKFLOW_DISCORD_ACTIONS.map((value) => ({
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
          choices={WORKFLOW_DISCORD_EMOJI.map((value) => ({
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
