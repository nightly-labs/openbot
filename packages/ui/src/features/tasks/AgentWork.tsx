import type { ConversationSubagent } from "@openbot/contracts/ipc";
import { Button, ChevronLeft, ChevronRight } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { SubagentPanel, useDuration } from "@openbot/ui/features/conversation/Subagents";
import { TaskMark, type TaskMarkState } from "@openbot/ui/features/conversation/TaskList";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

export type AgentWorkState = "running" | "waiting" | "queued" | "completed" | "failed" | "stopped";

/**
 * One node of an agent's work. `chat` is the agent's main chat, `task` one of its threads, `teammate`
 * the work that another agent does for it, and `subagent` a provider subagent.
 */
export interface AgentWorkNode {
  id: string;
  kind: "chat" | "task" | "teammate" | "subagent";
  title: string;
  state: AgentWorkState;
  /** What a running node does now, or why it failed. */
  note?: string | undefined;
  /** The agent that does the work: the owner for a chat or task, the teammate for a teammate node. */
  agentId: string;
  /** The agent started the task itself. */
  startedByAgent?: boolean | undefined;
  /** Set when the start is known. The row then shows how long the work took. */
  startedAt?: string | undefined;
  endedAt?: string | null | undefined;
  subagent?: ConversationSubagent | undefined;
  children: AgentWorkNode[];
}

const GENERAL_AGENT_TYPE = "general-purpose";

function markState(state: AgentWorkState): TaskMarkState {
  if (state === "running" || state === "waiting") return "active";
  if (state === "completed") return "done";
  if (state === "failed") return "failed";
  return "pending";
}

function tone(state: AgentWorkState): "danger" | "working" | undefined {
  if (state === "failed") return "danger";
  if (state === "running" || state === "waiting") return "working";
  return undefined;
}

function useStateText() {
  const { t } = useText();
  return (node: AgentWorkNode): string => {
    switch (node.state) {
      case "running":
        return (node.kind === "subagent" ? undefined : node.note) ?? t("conversation.tasks.state.running");
      case "waiting":
        return node.note ?? t("chat.awaiting.title");
      case "queued":
        return t("conversation.tasks.state.queued");
      case "failed":
        return t("conversation.tasks.state.failed");
      case "stopped":
        return t("chat.subagents.state.stopped");
      default:
        if (node.kind === "subagent") return t("chat.subagents.state.completed");
        if (node.kind === "teammate") return t("conversation.tasks.work.replied");
        return t("conversation.tasks.state.completed");
    }
  };
}

function countState(nodes: readonly AgentWorkNode[], state: AgentWorkState): number {
  return nodes.reduce((sum, node) => sum + (node.state === state ? 1 : 0) + countState(node.children, state), 0);
}

function anyRunning(nodes: readonly AgentWorkNode[]): boolean {
  return nodes.some((node) => node.state === "running" || anyRunning(node.children));
}

/** True when the node or one below it runs, waits, or failed. Such a node opens by default. */
function needsLook(node: AgentWorkNode): boolean {
  return (node.state !== "completed" && node.state !== "stopped") || node.children.some(needsLook);
}

function findNode(nodes: readonly AgentWorkNode[], id: string): AgentWorkNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(node.children, id);
    if (child) return child;
  }
  return undefined;
}

/** The current time, each second while some work runs, so the times count up. */
function createNow(running: () => boolean) {
  const [now, setNow] = createSignal(Date.now());
  // A memo, so a change of the nodes does not start the timer again.
  const on = createMemo(running);
  createEffect(on, (active) => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  });
  return now;
}

function elapsed(node: AgentWorkNode, now: number): number | null {
  if (node.startedAt === undefined) return null;
  const start = Date.parse(node.startedAt);
  const end = node.endedAt ? Date.parse(node.endedAt) : now;
  return Number.isFinite(start) && Number.isFinite(end) ? end - start : null;
}

/**
 * The tree lines before a row, as the thread menu draws them for a branch. The branch of a row with
 * no toggle runs on to its mark.
 */
function Stem(props: { through: readonly boolean[]; last: boolean; leaf: boolean }) {
  return (
    <span class="agent-work-stem agent-threads-menu-stem" data-leaf={props.leaf ? "" : undefined} aria-hidden="true">
      <For each={props.through}>
        {(line) => <span class={["agent-threads-stem-rail", line && "agent-threads-stem-line"]} />}
      </For>
      <span class={["agent-threads-stem-elbow", props.last && "agent-threads-stem-last"]} />
    </span>
  );
}

interface RowsProps {
  nodes: readonly AgentWorkNode[];
  /** One entry for each outer level: true where that level's line runs on. Empty at the top. */
  through: readonly boolean[];
  agents: readonly AgentProfile[];
  owner: string;
  now: number;
  open: (node: AgentWorkNode) => boolean;
  onToggle: (node: AgentWorkNode) => void;
  selectedId: string | null;
  onSelect: (node: AgentWorkNode) => void;
}

function Rows(props: RowsProps): JSX.Element {
  const { t } = useText();
  const stateText = useStateText();
  const duration = useDuration();
  const agentOf = (id: string) => props.agents.find((agent) => agent.id === id);
  return (
    <ul class="agent-work-list">
      <For each={props.nodes} keyed={(node) => node.id}>
        {(node, index) => {
          const last = () => index() === props.nodes.length - 1;
          const count = () => node().children.length;
          const isOpen = () => count() > 0 && props.open(node());
          const toggleLabel = () =>
            isOpen()
              ? t("conversation.tasks.work.hide", { count: count(), title: rowTitle() })
              : t("conversation.tasks.work.show", { count: count(), title: rowTitle() });
          const rowTitle = () => (node().kind === "chat" ? t("conversation.tasks.work.mainChat") : node().title);
          const time = () => elapsed(node(), props.now);
          const agentType = () => {
            const type = node().subagent?.agentType;
            return type && type !== GENERAL_AGENT_TYPE ? type : null;
          };
          return (
            <li class="agent-work-item">
              <div
                class="agent-work-row"
                data-kind={node().kind}
                data-state={node().state}
                data-top={props.through.length === 0 ? "" : undefined}
                data-selected={props.selectedId === node().id ? "" : undefined}
              >
                <Show when={props.through.length > 0}>
                  <Stem through={props.through.slice(1)} last={last()} leaf={count() === 0} />
                </Show>
                <Show when={count() > 0} fallback={<span class="agent-work-toggle-space" aria-hidden="true" />}>
                  {/* The line of an open branch starts under its toggle. */}
                  <span class="agent-work-branch" data-open={isOpen() ? "" : undefined}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      class="agent-work-toggle"
                      aria-expanded={isOpen() ? "true" : "false"}
                      aria-label={toggleLabel()}
                      onClick={() => props.onToggle(node())}
                    >
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  </span>
                </Show>
                <Button type="button" variant="ghost" class="agent-work-open" onClick={() => props.onSelect(node())}>
                  <span class="agent-tasks-mark agent-work-mark" aria-hidden="true">
                    <TaskMark state={markState(node().state)} />
                  </span>
                  <span class="agent-work-title" dir="auto" title={rowTitle()}>
                    {rowTitle()}
                  </span>
                  <Show when={time()}>{(ms) => <span class="agent-work-time">{duration(ms())}</span>}</Show>
                  {/* The state, then who does the work. The title keeps the first line. */}
                  <span class="agent-work-meta">
                    <span
                      class="agent-work-status tasks-page-status"
                      data-tone={tone(node().state)}
                      title={node().state === "failed" ? node().note : undefined}
                    >
                      {stateText(node())}
                    </span>
                    <Show when={node().kind === "teammate"}>
                      <span class="agent-work-tag agent-work-teammate">
                        <AgentAvatar agent={agentOf(node().agentId)} class="agent-work-avatar" />
                        <span>{agentOf(node().agentId)?.name ?? t("chat.activity.agentFallback")}</span>
                      </span>
                    </Show>
                    <Show when={agentType()}>{(type) => <span class="agent-work-tag">{type()}</span>}</Show>
                    <Show when={node().startedByAgent}>
                      <span class="agent-work-tag">
                        {t("conversation.tasks.work.startedBy", {
                          name: agentOf(props.owner)?.name ?? t("chat.activity.agentFallback"),
                        })}
                      </span>
                    </Show>
                  </span>
                </Button>
              </div>
              <Show when={isOpen()}>
                <Rows {...props} nodes={node().children} through={[...props.through, !last()]} />
              </Show>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

export interface AgentWorkPaneProps {
  agentId: string;
  agents: readonly AgentProfile[];
  nodes: readonly AgentWorkNode[];
  /** Opens a chat or task node in the agent's chat. */
  onOpen: (node: AgentWorkNode) => void;
}

/**
 * An agent's work as a tree, in the Work pane of the side panel: its main chat and its open tasks, with
 * the subagents and the teammates that each one started. A subagent opens its steps in place of the tree.
 */
export function AgentWorkPane(props: AgentWorkPaneProps) {
  const { t } = useText();
  const agent = () => props.agents.find((candidate) => candidate.id === props.agentId);
  const title = () => t("conversation.tasks.work.title", { name: agent()?.name ?? t("chat.activity.agentFallback") });
  const now = createNow(() => anyRunning(props.nodes));
  /** The nodes that the user opened or closed. Each other node is open when it needs a look. */
  const [toggled, setToggled] = createSignal<ReadonlySet<string>>(new Set());
  const isOpen = (node: AgentWorkNode) => needsLook(node) !== toggled().has(node.id);
  const toggle = (node: AgentWorkNode) =>
    setToggled((current) => {
      const next = new Set(current);
      if (!next.delete(node.id)) next.add(node.id);
      return next;
    });
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const selected = createMemo(() => {
    const id = selectedId();
    return id === null ? undefined : findNode(props.nodes, id);
  });
  const working = () => countState(props.nodes, "running");
  const failed = () => countState(props.nodes, "failed");
  const summary = () => {
    const parts = [
      working() > 0 ? t("conversation.tasks.work.working", { count: working() }) : "",
      failed() > 0 ? t("conversation.tasks.work.failed", { count: failed() }) : "",
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : t("conversation.tasks.work.idle");
  };
  let scroll: HTMLDivElement | undefined;
  let scrollTop = 0;

  return (
    <section class="agent-work-pane" aria-label={title()}>
      <Show
        when={selected()?.subagent}
        fallback={
          <>
            <header class="agent-work-head">{summary()}</header>
            <div
              class="agent-work-scroll"
              ref={(element) => {
                scroll = element;
                element.scrollTop = scrollTop;
              }}
            >
              <Rows
                nodes={props.nodes}
                through={[]}
                agents={props.agents}
                owner={props.agentId}
                now={now()}
                open={isOpen}
                onToggle={toggle}
                selectedId={selectedId()}
                onSelect={(node) => {
                  if (node.kind === "teammate") return toggle(node);
                  if (node.kind === "subagent") {
                    scrollTop = scroll?.scrollTop ?? 0;
                    return setSelectedId(node.id);
                  }
                  setSelectedId(node.id);
                  props.onOpen(node);
                }}
              />
            </div>
          </>
        }
      >
        {(subagent) => (
          <div class="agent-work-detail">
            {/* In place of the header of the subagent pane: Back is the only way out, so one row holds it. */}
            <header class="file-preview-header agent-work-detail-head">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="agent-work-back"
                onClick={() => setSelectedId(null)}
              >
                <ChevronLeft aria-hidden="true" />
                {title()}
              </Button>
            </header>
            <SubagentPanel
              subagent={subagent()}
              agentName={
                props.agents.find((candidate) => candidate.id === selected()?.agentId)?.name ??
                t("chat.activity.agentFallback")
              }
              onClosePanel={() => setSelectedId(null)}
            />
          </div>
        )}
      </Show>
    </section>
  );
}
