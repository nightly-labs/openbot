import type { AppFormat, AppTranslate } from "@openbot/i18n";
import { createMemo, For } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import {
  AgentActivityBody,
  type AgentActivityLabel,
  agentActivityLabelKey,
  nextAgentActivityLabel,
} from "../conversation/AgentActivity";
import type { AgentStep } from "../conversation/AgentSteps";

/** One agent the channel is waiting on. The profile is missing while the agent list has no such id. */
export interface ChannelWorker {
  id: string;
  name: string;
  agent?: AgentProfile | undefined;
}

/**
 * Who the channel is waiting on, for the announcement only.
 *
 * A channel runs several agents at once, and a row for each would push the transcript off the
 * screen every time work started. The names read as a list, so the listener counts the workers in
 * one line. It takes the subject of the agent chat's announcement - `<name> is working` - so both
 * chats announce work the same way.
 */
export function channelActivitySentence(names: string[], t: AppTranslate): string {
  if (names.length === 0) return "";
  if (names.length === 1) return t("channel.activity.one", { name: names[0] ?? "" });
  const last = names[names.length - 1] ?? "";
  return t("channel.activity.many", { names: names.slice(0, -1).join(", "), last });
}

/** One part of the visible list of names: a worker, or the words between two names. */
type ChannelWorkerNamePart = { worker: ChannelWorker } | { text: string };

const NAME_MARKER = /(\u{E000}\d+\u{E001})/u;

/**
 * The names of the workers as one list in the interface language ("Chief and Research"), cut into
 * parts so that each name can stand out from the words between them. The list is written with a marker for each
 * name, so the words and their order stay those of the locale.
 */
function channelWorkerNameParts(workers: ChannelWorker[], list: AppFormat["list"]): ChannelWorkerNamePart[] {
  const markers = workers.map((_, index) => `\u{E000}${index}\u{E001}`);
  return list(markers)
    .split(NAME_MARKER)
    .flatMap((part): ChannelWorkerNamePart[] => {
      const index = markers.indexOf(part);
      const worker = workers[index];
      if (worker) return [{ worker }];
      return part ? [{ text: part }] : [];
    });
}

/**
 * The activity row of a channel shows the face and the name of each working agent.
 *
 * It uses the `agent-activity-*` rules and the same shifting label as the agent chat, so a reader
 * who moves between a channel and an agent chat meets one indicator. What differs is the number of
 * faces and the names: in a channel the face alone does not say which member works. A channel runs
 * at most `CHANNEL_PARALLEL_LIMIT` agents, which is what keeps the count of animating avatars low -
 * each one costs the renderer a style recalculation and a paint per frame. The steps of the turns
 * that have no answer yet open under the line, as in the agent chat.
 */
export function ChannelActivityIndicator(props: {
  workers: ChannelWorker[];
  steps?: readonly AgentStep[] | undefined;
  /** The "Show agent steps" setting: the steps are open when the work starts. */
  stepsOpenByDefault?: boolean | undefined;
}) {
  const { t, format } = useText();
  const key = createMemo(() =>
    props.workers
      .map((worker) => worker.id)
      .sort()
      .join(","),
  );
  let previous: AgentActivityLabel | undefined;
  // A new set of workers is a new turn of the channel, so it gets a label of its own. The same set
  // keeps what it had, and the row does not flicker as messages arrive.
  const label = createMemo<AgentActivityLabel>(() => {
    key();
    previous = nextAgentActivityLabel(previous);
    return previous;
  });
  const sentence = () =>
    channelActivitySentence(
      props.workers.map((worker) => worker.name),
      t,
    );
  return (
    <div class="agent-activity-entry" data-state="active">
      <span
        class="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={t("channel.activity.status", { sentence: sentence(), label: t(agentActivityLabelKey(label())) })}
      />
      <AgentActivityBody
        class="channel-activity-content"
        steps={props.steps}
        stepsOpenByDefault={props.stepsOpenByDefault}
        live
      >
        <div class="channel-activity-faces">
          <For each={props.workers}>
            {(worker) => (
              <AgentAvatar
                agent={worker.agent}
                seed={worker.agent ? undefined : worker.id}
                mood="working"
                class="agent-activity-avatar"
              />
            )}
          </For>
        </div>
        <span class="channel-activity-names">
          <For each={channelWorkerNameParts(props.workers, format.list)}>
            {(part) => ("worker" in part ? <span class="channel-activity-name">{part.worker.name}</span> : part.text)}
          </For>
        </span>
        <span class="agent-activity-label">{t(agentActivityLabelKey(label()))}</span>
      </AgentActivityBody>
    </div>
  );
}
