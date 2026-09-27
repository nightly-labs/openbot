import { createSignal, createUniqueId, For, Show, untrack } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { TaskListHeader, TaskMark, type TaskMarkState } from "./TaskList";

export type AwaitingReplyState = "asked" | "working" | "replied" | "failed";

export interface AwaitingReplyItem {
  id: string;
  /** The agent that owes the reply. A remote or removed agent has no profile. */
  agent?: AgentProfile | undefined;
  name: string;
  state: AwaitingReplyState;
  /** A line under the name, such as the start of a reply that waits in the queue. */
  preview?: string;
  /** A short note after the state, such as who reads the reply next. */
  detail?: string | undefined;
}

export interface AwaitingReplyListProps {
  items: readonly AwaitingReplyItem[];
  /** The header text. The default is "Waiting for replies". */
  title?: string;
  /** The list starts collapsed when this is false. */
  defaultOpen?: boolean;
  class?: string;
}

const MARK_STATE: Record<AwaitingReplyState, TaskMarkState> = {
  asked: "pending",
  working: "active",
  replied: "done",
  failed: "failed",
};

const STATE_LABEL = {
  asked: "chat.awaiting.state.asked",
  working: "chat.awaiting.state.working",
  replied: "chat.awaiting.state.replied",
  failed: "chat.awaiting.state.failed",
} as const;

/**
 * The block above the composer while an agent waits for other agents: one row for each agent it
 * asked, with the state of the answer. It has the same card and motion as the task list, and it
 * renders nothing when nothing waits.
 */
export function AwaitingReplies(props: AwaitingReplyListProps) {
  return (
    <Show when={props.items.length > 0}>
      <AwaitingReplyList {...props} />
    </Show>
  );
}

function AwaitingReplyList(props: AwaitingReplyListProps) {
  const { t } = useText();
  const panelId = createUniqueId();
  const [open, setOpen] = createSignal(untrack(() => props.defaultOpen ?? true));
  const total = () => props.items.length;
  const done = () => props.items.filter((item) => item.state === "replied").length;
  const working = () => {
    const item = props.items.find((entry) => entry.state === "working");
    return item && { id: item.id, label: t("chat.awaiting.working", { name: item.name }) };
  };
  return (
    <section class={["task-list", "awaiting-replies", props.class]} data-open={open() ? "" : undefined}>
      <TaskListHeader
        open={open()}
        onToggle={() => setOpen((value) => !value)}
        panelId={panelId}
        done={done()}
        total={total()}
        title={props.title ?? t("chat.awaiting.title")}
        active={working()}
        summary={t("chat.awaiting.summary", { done: done(), total: total() })}
        count={t("chat.awaiting.count", { done: done(), total: total() })}
      />
      <div id={panelId} class="task-list-panel" inert={open() ? undefined : true}>
        <ol class="task-list-items">
          <For each={props.items} keyed={(item) => item.id}>
            {(item, index) => (
              <li
                class="task-list-item awaiting-replies-item"
                data-state={MARK_STATE[item().state]}
                style={{ "--task-list-index": index() }}
              >
                <AgentAvatar
                  agent={item().agent}
                  seed={item().agent ? undefined : item().name}
                  mood={item().state === "working" ? "working" : "idle"}
                  class="awaiting-replies-avatar"
                />
                <span class="awaiting-replies-text">
                  <span class="awaiting-replies-name">{item().name}</span>
                  <Show when={item().preview}>
                    {(preview) => <span class="awaiting-replies-preview">{preview()}</span>}
                  </Show>
                </span>
                <span class="awaiting-replies-state">
                  <Show when={item().detail}>
                    {(detail) => <span class="awaiting-replies-detail">{detail()}</span>}
                  </Show>
                  <span class="awaiting-replies-state-label">{t(STATE_LABEL[item().state])}</span>
                  <span class="task-list-item-mark" aria-hidden="true">
                    <TaskMark state={MARK_STATE[item().state]} />
                  </span>
                </span>
              </li>
            )}
          </For>
        </ol>
      </div>
    </section>
  );
}
