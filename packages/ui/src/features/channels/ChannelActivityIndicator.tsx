import type { AppFormat, AppTranslate } from "@openbot/i18n";
import { createEffect, createSignal, For, onCleanup, untrack } from "solid-js";
import { avatarHeadColor } from "../../bloub-avatar";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ActivityShine } from "../conversation/ActivityShine";
import { AgentActivityBody, agentActivityLabelKey, nextAgentActivityLabel } from "../conversation/AgentActivity";
import type { AgentStep } from "../conversation/AgentSteps";
import { agentActivityExitDuration } from "../conversation/activity-timing";

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
 * parts so that each name can take its agent's colour. The list is written with a marker for each
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

/** The colour of the worker's name on its messages, so the name here matches its face and its replies. */
function workerNameStyle(worker: ChannelWorker) {
  return `--channel-activity-name-color: ${avatarHeadColor(
    worker.agent?.avatarSeed ?? worker.id,
    worker.agent?.avatarHue ?? null,
    worker.agent?.avatarColor ?? null,
  )}`;
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
  /** `exiting` while the line folds away after the last member stops. */
  phase?: "active" | "exiting" | undefined;
  /** The "Show agent steps" setting: the steps are open when the work starts. */
  stepsOpenByDefault?: boolean | undefined;
}) {
  const { t, format } = useText();
  // One label for the life of the line. Members join and stop while it shows, often a second apart,
  // and a label that changed with them read as a flicker. The line mounts again for the next work.
  const label = nextAgentActivityLabel();
  const shownLabel = () => t(agentActivityLabelKey(label));
  const sentence = () =>
    channelActivitySentence(
      props.workers.map((worker) => worker.name),
      t,
    );
  /*
   * The faces in the stack. When a member stops while others work, its face shrinks out and the
   * faces after it close the gap, instead of the stack changing in one frame. The ids keep each
   * face's element, so a face that stays does not pop in again.
   */
  const [faceIds, setFaceIds] = createSignal<string[]>(untrack(() => props.workers.map((worker) => worker.id)));
  const [leavingIds, setLeavingIds] = createSignal<ReadonlySet<string>>(new Set());
  const lastSeen = new Map<string, ChannelWorker>();
  const timers = new Set<number>();
  onCleanup(() => {
    for (const timer of timers) window.clearTimeout(timer);
  });
  createEffect(
    () => props.workers,
    (workers) => {
      for (const worker of workers) lastSeen.set(worker.id, worker);
      const working = new Set(workers.map((worker) => worker.id));
      const shown = untrack(faceIds);
      const gone = shown.filter((id) => !working.has(id) && !untrack(leavingIds).has(id));
      const joined = workers.map((worker) => worker.id).filter((id) => !shown.includes(id));
      if (joined.length > 0) setFaceIds([...shown, ...joined]);
      setLeavingIds((leaving) => new Set([...leaving, ...gone].filter((id) => !working.has(id))));
      if (gone.length === 0) return;
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        const left = gone.filter((id) => untrack(leavingIds).has(id));
        setFaceIds((ids) => ids.filter((id) => !left.includes(id)));
        setLeavingIds((leaving) => new Set([...leaving].filter((id) => !left.includes(id))));
      }, agentActivityExitDuration());
      timers.add(timer);
    },
  );
  const faceWorker = (id: string): ChannelWorker =>
    props.workers.find((worker) => worker.id === id) ?? lastSeen.get(id) ?? { id, name: "" };
  const faceClass = (id: string) =>
    leavingIds().has(id) ? "agent-activity-avatar channel-activity-face-leaving" : "agent-activity-avatar";
  return (
    <div class="agent-activity-entry" data-state={props.phase ?? "active"}>
      <span
        class="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={t("channel.activity.status", { sentence: sentence(), label: shownLabel() })}
      />
      <AgentActivityBody
        class="channel-activity-content"
        steps={props.steps}
        stepsOpenByDefault={props.stepsOpenByDefault}
        live={props.phase !== "exiting"}
      >
        <div class="channel-activity-faces">
          <For each={faceIds()}>
            {(id) => (
              <AgentAvatar
                agent={faceWorker(id).agent}
                seed={faceWorker(id).agent ? undefined : id}
                mood="working"
                class={faceClass(id)}
              />
            )}
          </For>
        </div>
        <span class="channel-activity-names">
          <For each={channelWorkerNameParts(props.workers, format.list)}>
            {(part) =>
              "worker" in part ? (
                <span class="channel-activity-name" style={workerNameStyle(part.worker)}>
                  {part.worker.name}
                </span>
              ) : (
                part.text
              )
            }
          </For>
        </span>
        <span class="agent-activity-label">
          {shownLabel()}
          <ActivityShine text={shownLabel()} />
        </span>
      </AgentActivityBody>
    </div>
  );
}
