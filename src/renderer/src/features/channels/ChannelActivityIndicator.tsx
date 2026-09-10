import { createMemo, For } from "solid-js";
import type { AgentProfile } from "../../data";
import { AgentAvatar } from "../agents/AgentAvatar";
import { type AgentActivityPresentation, nextAgentActivityPresentation } from "../conversation/AgentActivity";

/** One agent the channel is waiting on. The profile is missing while the agent list has no such id. */
export interface ChannelWorker {
  id: string;
  name: string;
  agent?: AgentProfile;
}

/**
 * Who the channel is waiting on, for the announcement only.
 *
 * A channel runs several agents at once, and a row for each would push the transcript off the
 * screen every time work started. The names read as a list, so the listener counts the workers in
 * one line. It takes the subject of the agent chat's announcement - `<name> is working` - so both
 * chats announce work the same way.
 */
export function channelActivitySentence(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is working`;
  const last = names[names.length - 1];
  return `${names.slice(0, -1).join(", ")} and ${last} are working`;
}

/**
 * The activity row of a channel shows the face of each working agent.
 *
 * It uses the `agent-activity-*` rules and the same shifting label as the agent chat, so a reader
 * who moves between a channel and an agent chat meets one indicator. What differs is the number of
 * faces: a channel runs at most `CHANNEL_PARALLEL_LIMIT` agents, which is what keeps the count of
 * animating avatars low - each one costs the renderer a style recalculation and a paint per frame.
 */
export function ChannelActivityIndicator(props: { workers: ChannelWorker[] }) {
  const key = createMemo(() =>
    props.workers
      .map((worker) => worker.id)
      .sort()
      .join(","),
  );
  let previous: AgentActivityPresentation | undefined;
  // A new set of workers is a new turn of the channel, so it gets an animation and a label of its
  // own. The same set keeps what it had, and the row does not flicker as messages arrive.
  const presentation = createMemo<AgentActivityPresentation>(() => {
    key();
    previous = nextAgentActivityPresentation(previous);
    return previous;
  });
  const sentence = () => channelActivitySentence(props.workers.map((worker) => worker.name));
  return (
    <div class="agent-activity-entry" data-state="active">
      <span
        class="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={`${sentence()}: ${presentation().label}`}
      />
      <section class="agent-activity-content channel-activity-content" aria-label="Current activity">
        <div class="channel-activity-faces">
          <For each={props.workers}>
            {(worker) => (
              <AgentAvatar
                agent={worker.agent}
                seed={worker.agent ? undefined : worker.id}
                url={null}
                motion="working"
                animationState={presentation().animation}
                class="agent-activity-avatar"
              />
            )}
          </For>
        </div>
        <span class="agent-activity-label">{presentation().label}</span>
      </section>
    </div>
  );
}
