import type { AppTextKey } from "@openbot/i18n";
import { Clock3, Hourglass, Split, X } from "@openbot/ui";
import { TypingDots } from "@openbot/ui/components/TypingDots";
import { SidebarWaitIcon } from "@openbot/ui/features/sidebar/SidebarAgentIndicator";
import type { SidebarWaitReason } from "@openbot/ui/features/sidebar/sidebar-types";
import { type TextValue, useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import type { ThreadStatus } from "./thread-types";

const WAIT_TEXT = {
  question: "sidebar.state.waitingQuestion",
  approval: "sidebar.state.waitingApproval",
  takeover: "sidebar.state.waitingTakeover",
} as const satisfies Record<SidebarWaitReason, AppTextKey>;

function threadStatusLabel(status: ThreadStatus, t: TextValue["t"]): string {
  switch (status.kind) {
    case "working":
      return t("sidebar.state.working");
    case "queued":
      return t("conversation.threads.state.queued");
    case "waiting":
      return t(WAIT_TEXT[status.reason]);
    case "failed":
      return t("conversation.threads.state.failed");
    case "awaiting":
      return t("chat.awaiting.title");
    default:
      return "";
  }
}

type ThreadMark = ThreadStatus | { kind: "unread" };

function threadMark(status: ThreadStatus, unread: number | undefined): ThreadMark {
  return (status.kind === "idle" || status.kind === "awaiting") && (unread ?? 0) > 0 ? { kind: "unread" } : status;
}

export function threadAttention(status: ThreadStatus): "waiting" | "failed" | undefined {
  if (status.kind === "waiting" || status.kind === "failed") return status.kind;
  return undefined;
}

function waitReason(status: ThreadMark): SidebarWaitReason | undefined {
  return status.kind === "waiting" ? status.reason : undefined;
}

function StatusBadge(props: { status: ThreadMark }) {
  return (
    <span class="agent-threads-tab-mark" data-kind={props.status.kind}>
      <Show when={props.status.kind === "working"}>
        <span class="agent-threads-state agent-threads-state-working">
          <TypingDots class="agent-row-thinking-dots" />
        </span>
      </Show>
      <Show when={waitReason(props.status)}>
        {(reason) => (
          <span class="agent-threads-state agent-threads-state-icon">
            <SidebarWaitIcon reason={reason()} />
          </span>
        )}
      </Show>
      <Show when={props.status.kind === "queued"}>
        <span class="agent-threads-state agent-threads-state-icon">
          <Clock3 />
        </span>
      </Show>
      <Show when={props.status.kind === "awaiting"}>
        <span class="agent-threads-state agent-threads-state-icon">
          <Hourglass />
        </span>
      </Show>
      <Show when={props.status.kind === "failed"}>
        <span class="agent-threads-state agent-threads-state-icon">
          <X />
        </span>
      </Show>
      <Show when={props.status.kind === "unread"}>
        <span class="agent-threads-state agent-threads-unread" />
      </Show>
    </span>
  );
}

function StatusIcon(props: { status: ThreadMark }) {
  let last: ThreadMark = { kind: "idle" };
  const shown = () => {
    if (props.status.kind !== "idle") last = props.status;
    return last;
  };
  const open = () => (props.status.kind === "idle" ? undefined : "");
  return (
    <span class="agent-threads-tab-mark-slot" data-open={open()} aria-hidden="true">
      <StatusBadge status={shown()} />
    </span>
  );
}

export function ThreadTabIcon(props: { status: ThreadStatus; unread?: number | undefined }) {
  const mark = () => threadMark(props.status, props.unread);
  return (
    <Show when={mark().kind !== "idle"} fallback={<Split aria-hidden="true" />}>
      <StatusBadge status={mark()} />
    </Show>
  );
}

export function ThreadStatusText(props: { status: ThreadStatus; unread?: number | undefined }) {
  const { t } = useText();
  const unread = () => props.unread ?? 0;
  return (
    <>
      <Show when={threadStatusLabel(props.status, t)}>{(label) => <span class="sr-only">{label()}</span>}</Show>
      <Show when={unread() > 0}>
        <span class="sr-only">{t("sidebar.state.unread", { count: unread() })}</span>
      </Show>
    </>
  );
}

export function ThreadStatusMark(props: { status: ThreadStatus; unread?: number | undefined }) {
  return (
    <>
      <StatusIcon status={threadMark(props.status, props.unread)} />
      <ThreadStatusText status={props.status} unread={props.unread} />
    </>
  );
}
