import { Button, IconButton, X } from "@openbot/ui";
import { createSignal, createUniqueId, For, Show, untrack } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { SidebarAgentWait } from "../sidebar/sidebar-agent-states";
import { SIDEBAR_WAIT_ACTION, SIDEBAR_WAIT_TITLE, sidebarUsageResetTime } from "../sidebar/sidebar-filtering";
import { createTaskListPlayState, TaskListHeader, TaskMark, type TaskMarkState } from "./TaskList";

export type AwaitingReplyState = "asked" | "working" | "replied" | "failed" | "stopped";

export function awaitingReplyEnded(state: AwaitingReplyState): boolean {
  return state === "replied" || state === "failed" || state === "stopped";
}

export interface AwaitingReplyItem {
  id: string;
  agent?: AgentProfile | undefined;
  name: string;
  state: AwaitingReplyState;
  preview?: string;
  detail?: string | undefined;
  deliveryId?: string | undefined;
  wait?: SidebarAgentWait | undefined;
  stoppable?: boolean | undefined;
}

export interface AwaitingReplyListProps {
  items: readonly AwaitingReplyItem[];
  title?: string | undefined;
  defaultOpen?: boolean;
  onDismiss?: () => void;
  onOpenAgent?: ((agentId: string) => void) | undefined;
  onSteer?: ((deliveryId: string) => void) | undefined;
  onStop?: ((id: string) => void) | undefined;
  stopDisplay?: "button" | "icon" | undefined;
  class?: string;
}

const MARK_STATE: Record<AwaitingReplyState, TaskMarkState> = {
  asked: "pending",
  working: "active",
  replied: "done",
  failed: "failed",
  stopped: "failed",
};

const STATE_LABEL = {
  asked: "chat.awaiting.state.asked",
  working: "chat.awaiting.state.working",
  replied: "chat.awaiting.state.replied",
  failed: "chat.awaiting.state.failed",
  stopped: "chat.awaiting.state.stopped",
} as const;

export function AwaitingReplies(props: AwaitingReplyListProps) {
  return (
    <Show when={props.items.length > 0}>
      <AwaitingReplyList {...props} />
    </Show>
  );
}

function AwaitingReplyList(props: AwaitingReplyListProps) {
  const { t, format } = useText();
  const panelId = createUniqueId();
  const playState = createTaskListPlayState();
  const [open, setOpen] = createSignal(untrack(() => props.defaultOpen ?? true));
  const total = () => props.items.length;
  const done = () => props.items.filter((item) => item.state === "replied").length;
  const active = () => {
    const waiting = props.items.find((entry) => entry.wait);
    if (waiting?.wait) {
      const key = waiting.wait.kind === "waiting" ? "chat.awaiting.needsYou" : "chat.awaiting.limited";
      return { id: waiting.id, label: t(key, { name: waiting.name }) };
    }
    const item = props.items.find((entry) => entry.state === "working");
    return item && { id: item.id, label: t("chat.awaiting.working", { name: item.name }) };
  };
  const markState = (item: AwaitingReplyItem): TaskMarkState => (item.wait ? "pending" : MARK_STATE[item.state]);
  const stateLabel = (item: AwaitingReplyItem): string => {
    const wait = item.wait;
    if (wait?.kind === "waiting") return t(SIDEBAR_WAIT_TITLE[wait.reason]);
    if (wait?.kind === "limited") {
      const reset = sidebarUsageResetTime(wait.resetsAt, format);
      return reset ? t("sidebar.state.usageLimitResets", { reset }) : t("sidebar.state.usageLimit");
    }
    return t(STATE_LABEL[item.state]);
  };
  const preview = (item: AwaitingReplyItem): string | undefined =>
    (item.wait?.kind === "waiting" ? item.wait.detail : null) ?? item.preview;
  const openAction = (item: AwaitingReplyItem) => {
    const wait = item.wait;
    const agentId = item.agent?.id;
    const open = props.onOpenAgent;
    if (wait?.kind !== "waiting" || !agentId || !open) return undefined;
    return { label: t(SIDEBAR_WAIT_ACTION[wait.reason]), run: () => open(agentId) };
  };
  const steerAction = (item: AwaitingReplyItem) => {
    const deliveryId = item.deliveryId;
    const steer = props.onSteer;
    if (item.state !== "replied" || !deliveryId || !steer) return undefined;
    return () => steer(deliveryId);
  };
  const stopAction = (item: AwaitingReplyItem) => {
    const stop = props.onStop;
    if (item.stoppable === false || (item.state !== "asked" && item.state !== "working") || !stop) return undefined;
    return () => stop(item.id);
  };
  const settled = () => props.items.every((item) => awaitingReplyEnded(item.state));
  const stopIcon = () => props.stopDisplay === "icon";
  return (
    <section
      style={{ "--task-list-play-state": playState() }}
      class={["task-list", "awaiting-replies", props.class]}
      data-open={open() ? "" : undefined}
    >
      <div class="awaiting-replies-bar">
        <TaskListHeader
          open={open()}
          onToggle={() => setOpen((value) => !value)}
          panelId={panelId}
          done={done()}
          total={total()}
          title={props.title ?? t("chat.awaiting.title")}
          active={active()}
          summary={t("chat.awaiting.summary", { done: done(), total: total() })}
          count={t("chat.awaiting.count", { done: done(), total: total() })}
        />
        <Show when={settled() && props.onDismiss}>
          {(dismiss) => (
            <IconButton
              class="awaiting-replies-dismiss"
              label={t("chat.awaiting.dismiss")}
              variant="ghost"
              size="icon-xs"
              data-cuelume-tap="close"
              onClick={() => dismiss()()}
            >
              <X aria-hidden="true" />
            </IconButton>
          )}
        </Show>
      </div>
      <div id={panelId} class="task-list-panel" inert={open() ? undefined : true}>
        <ol class="task-list-items">
          <For each={props.items} keyed={(item) => item.id}>
            {(item, index) => {
              const rowId = createUniqueId();
              return (
                <li
                  class="task-list-item awaiting-replies-item"
                  data-state={markState(item())}
                  data-wait={item().wait ? "" : undefined}
                  data-stopped={item().state === "stopped" ? "" : undefined}
                  style={{ "--task-list-index": index() }}
                >
                  <AgentAvatar
                    agent={item().agent}
                    seed={item().agent ? undefined : item().name}
                    class="awaiting-replies-avatar"
                  />
                  <span class="awaiting-replies-text">
                    <span id={`${rowId}-name`} class="awaiting-replies-name">
                      {item().name}
                    </span>
                    <Show when={preview(item())}>
                      {(text) => <span class="awaiting-replies-preview">{text()}</span>}
                    </Show>
                  </span>
                  <span class="awaiting-replies-state">
                    <Show when={item().detail}>
                      {(detail) => <span class="awaiting-replies-detail">{detail()}</span>}
                    </Show>
                    <span class="awaiting-replies-state-label">{stateLabel(item())}</span>
                    <span class="awaiting-replies-mark">
                      <span class="task-list-item-mark" aria-hidden="true">
                        <TaskMark state={markState(item())} />
                      </span>
                      <Show when={stopIcon() && stopAction(item())}>
                        {(stop) => (
                          <IconButton
                            id={`${rowId}-stop`}
                            class="awaiting-replies-stop-icon"
                            label={t("chat.awaiting.stop")}
                            aria-labelledby={`${rowId}-stop ${rowId}-name`}
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => stop()()}
                          >
                            <X aria-hidden="true" />
                          </IconButton>
                        )}
                      </Show>
                    </span>
                  </span>
                  <Show when={openAction(item())}>
                    {(action) => (
                      <Button
                        id={`${rowId}-open`}
                        size="xs"
                        variant="secondary"
                        class="awaiting-replies-open"
                        aria-labelledby={`${rowId}-open ${rowId}-name`}
                        onClick={() => action().run()}
                      >
                        {action().label}
                      </Button>
                    )}
                  </Show>
                  <Show when={steerAction(item())}>
                    {(steer) => (
                      <Button
                        id={`${rowId}-steer`}
                        size="xs"
                        variant="secondary"
                        class="awaiting-replies-steer"
                        aria-labelledby={`${rowId}-steer ${rowId}-name`}
                        onClick={() => steer()()}
                      >
                        {t("queue.item.steer")}
                      </Button>
                    )}
                  </Show>
                  <Show when={!stopIcon() && stopAction(item())}>
                    {(stop) => (
                      <Button
                        id={`${rowId}-stop`}
                        size="xs"
                        variant="secondary"
                        class="awaiting-replies-stop"
                        aria-labelledby={`${rowId}-stop ${rowId}-name`}
                        onClick={() => stop()()}
                      >
                        {t("chat.awaiting.stop")}
                      </Button>
                    )}
                  </Show>
                </li>
              );
            }}
          </For>
        </ol>
      </div>
    </section>
  );
}
