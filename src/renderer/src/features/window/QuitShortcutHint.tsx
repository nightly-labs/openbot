import type { ClientAgentSummary } from "@openbot/contracts/ipc";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { channelActivitySentence } from "@openbot/ui/features/channels/ChannelActivityIndicator";
import { useText } from "@openbot/ui/text";
import { For, onSettled, Show } from "solid-js";
import { quitShortcutHintAgents, watchQuitShortcutHint } from "../../quit-shortcut-hint";

const MAX_AVATARS = 3;

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

export function QuitShortcutHint() {
  onSettled(watchQuitShortcutHint);
  return <Show when={quitShortcutHintAgents()}>{(agents) => <QuitShortcutHintView agents={agents()} />}</Show>;
}
