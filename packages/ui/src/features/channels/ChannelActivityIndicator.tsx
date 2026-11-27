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

export interface ChannelWorker {
  id: string;
  name: string;
  agent?: AgentProfile | undefined;
}

export function channelActivitySentence(names: string[], t: AppTranslate): string {
  if (names.length === 0) return "";
  if (names.length === 1) return t("channel.activity.one", { name: names[0] ?? "" });
  const last = names[names.length - 1] ?? "";
  return t("channel.activity.many", { names: names.slice(0, -1).join(", "), last });
}

type ChannelWorkerNamePart = { worker: ChannelWorker } | { text: string };

const NAME_MARKER = /(\u{E000}\d+\u{E001})/u;

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

function workerNameStyle(worker: ChannelWorker) {
  return `--channel-activity-name-color: ${avatarHeadColor(
    worker.agent?.avatarSeed ?? worker.id,
    worker.agent?.avatarHue ?? null,
    worker.agent?.avatarColor ?? null,
  )}`;
}

export function ChannelActivityIndicator(props: {
  workers: ChannelWorker[];
  steps?: readonly AgentStep[] | undefined;
  phase?: "active" | "exiting" | undefined;
  stepsOpenByDefault?: boolean | undefined;
}) {
  const { t, format } = useText();
  const label = nextAgentActivityLabel();
  const shownLabel = () => t(agentActivityLabelKey(label));
  const sentence = () =>
    channelActivitySentence(
      props.workers.map((worker) => worker.name),
      t,
    );
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
