import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import { createMemo } from "solid-js";
import { useI18n } from "../../i18n-context";
import { setStartupAgentChat, useStartupAgentChat } from "../agents/startup-agent-chat-preference";
import type { AgentDockSettingsModel } from "./SettingsAgentDockTab";

/** The option that keeps the chat that the app restores. */
const LAST_CHAT = "last";
/** The saved agent when the list does not show it: it is on another server, hidden or deleted. */
const SAVED_ELSEWHERE = "saved";
const AGENT_PREFIX = "agent:";

function sameKeys(before: string[], after: string[]): boolean {
  return before.length === after.length && before.every((key, index) => key === after[index]);
}

interface StartupAgentChatSelectProps {
  /** The agents of the active server. A choice saves the active server with the agent. */
  model: AgentDockSettingsModel;
  /** The dialog element the list portals into. */
  mount: HTMLElement | undefined;
}

/** One list: the last chat, then each agent of the active server. */
export function StartupAgentChatSelect(props: StartupAgentChatSelectProps) {
  const i18n = useI18n();
  const saved = useStartupAgentChat();
  const savedListed = () => {
    const chat = saved();
    return (
      chat !== null &&
      chat.serverId === props.model.server?.id &&
      props.model.agents.some((agent) => agent.id === chat.agentId)
    );
  };
  const value = (): string => {
    const chat = saved();
    if (!chat) return LAST_CHAT;
    return savedListed() ? `${AGENT_PREFIX}${chat.agentId}` : SAVED_ELSEWHERE;
  };

  // A new array makes Kobalte choose again, so the list changes only when its keys change.
  const options = createMemo(
    (): string[] => [
      LAST_CHAT,
      ...props.model.agents.map((agent) => `${AGENT_PREFIX}${agent.id}`),
      ...(saved() !== null && !savedListed() ? [SAVED_ELSEWHERE] : []),
    ],
    { equals: sameKeys },
  );

  const label = (key: string): string => {
    if (key === LAST_CHAT) return i18n.t("settings.startupChat.lastChat");
    if (key === SAVED_ELSEWHERE) {
      return saved()?.serverId === props.model.server?.id
        ? i18n.t("settings.startupChat.unlistedAgent")
        : i18n.t("settings.startupChat.otherServer");
    }
    const agentId = key.slice(AGENT_PREFIX.length);
    return props.model.agents.find((agent) => agent.id === agentId)?.name ?? "";
  };

  function choose(key: string): void {
    if (key === value() || key === SAVED_ELSEWHERE) return;
    const serverId = props.model.server?.id;
    if (key === LAST_CHAT || !serverId) {
      setStartupAgentChat(null);
      return;
    }
    setStartupAgentChat({ serverId, agentId: key.slice(AGENT_PREFIX.length) });
  }

  return (
    <Select<string>
      class="settings-modal-select"
      options={options()}
      value={value()}
      onChange={(key) => key && choose(key)}
      placement="bottom-end"
      sameWidth={false}
      itemComponent={(item) => <SelectItem item={item.item}>{label(item.item.rawValue)}</SelectItem>}
    >
      <SelectTrigger size="sm" aria-label={i18n.t("settings.startupChat.title")}>
        <SelectValue<string>>{(state) => label(state.selectedOption() ?? LAST_CHAT)}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.mount} />
    </Select>
  );
}
