import type { ClientAgentSummary } from "@openbot/contracts/ipc";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { channelActivitySentence } from "@openbot/ui/features/channels/ChannelActivityIndicator";
import { useText } from "@openbot/ui/text";
import { For, onSettled, Show } from "solid-js";
import { quitShortcutHintAgents, watchQuitShortcutHint } from "../../quit-shortcut-hint";

/** More faces than this make the pill wide, and the names already list every agent. */
const MAX_AVATARS = 3;

/** How to quit, with the agents that the quit stops. With no agent at work, only how to quit. */
export function QuitShortcutHintView(props: { agents: ClientAgentSummary[] }) {
  const { t } = useText();
  return (
    <div class="quit-shortcut-backdrop">
      <div class="quit-shortcut-hint" role="status">
        <Show when={props.agents.length > 0}>
          <span class="quit-shortcut-avatars" aria-hidden="true">
            <For each={props.agents.slice(0, MAX_AVATARS)}>
              {(agent) => <AgentAvatar agent={agent} motion="idle" mood="working" workingFaces />}
            </For>
          </span>
        </Show>
        <span class="quit-shortcut-copy">
          <Show when={props.agents.length > 0}>
            <span class="quit-shortcut-agents">
              {channelActivitySentence(
                props.agents.map((agent) => agent.name),
                t,
              )}
            </span>
          </Show>
          <span class="quit-shortcut-instruction">{t("menu.quitHint")}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * On a Mac, while an agent works, one press of `Cmd + Q` does not quit. Main reads the key before the
 * page does and tells this window when to show which agents work and how to quit: hold the keys, or
 * press them twice. With no agent at work, one press quits and no hint shows, unless the user guards
 * every quit. The user can also turn the guard off.
 */
export function QuitShortcutHint() {
  onSettled(watchQuitShortcutHint);
  return <Show when={quitShortcutHintAgents()}>{(agents) => <QuitShortcutHintView agents={agents()} />}</Show>;
}
