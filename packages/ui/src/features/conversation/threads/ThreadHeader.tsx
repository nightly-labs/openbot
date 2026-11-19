import { Button, Plus } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, onSettled, Show } from "solid-js";
import { ThreadMenu } from "./ThreadMenu";
import { ThreadTabs } from "./ThreadTabs";
import { carriedThreadTab } from "./thread-tab-drag";
import type { ThreadHeaderProps, ThreadRowMode } from "./thread-types";

const COMPACT_BELOW = 200;
const MINIMAL_BELOW = 48;

type RowFold = "name" | "new" | "list" | "all";

function rowFold(
  width: number,
  chevron: number,
  start: number,
  avatarEnd: number,
  button: number,
): RowFold | undefined {
  const pair = 2 * button + 3;
  if (width - start >= pair) return undefined;
  if (width - avatarEnd >= pair) return "name";
  if (width + chevron - avatarEnd >= button) return "new";
  if (width + chevron - avatarEnd >= -1) return "list";
  return "all";
}

function rowMode(free: number): ThreadRowMode {
  if (free < MINIMAL_BELOW) return "minimal";
  if (free < COMPACT_BELOW) return "compact";
  return "tabs";
}

function pickerRoom(header: Element | null): number {
  const trigger = header?.querySelector(".provider-model-trigger");
  if (!trigger) return 0;
  const gap = Number.parseFloat(getComputedStyle(trigger).columnGap) || 0;
  let room = 0;
  for (const part of trigger.querySelectorAll(".provider-model-trigger-name, .provider-model-trigger-effort")) {
    if (part.getClientRects().length === 0) continue;
    room +=
      part.getBoundingClientRect().width + gap + (Number.parseFloat(getComputedStyle(part).marginInlineStart) || 0);
  }
  return Math.max(0, room);
}

function NewThreadButton(props: { disabled: boolean; onNew: () => void }) {
  const { t } = useText();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      class="agent-threads-icon-button no-drag"
      aria-label={t("conversation.threads.new")}
      title={t("conversation.threads.new")}
      disabled={props.disabled}
      onClick={() => props.onNew()}
    >
      <Plus aria-hidden="true" />
    </Button>
  );
}

function ThreadRow(props: ThreadHeaderProps) {
  let row: HTMLDivElement | undefined;
  const [measured, setMode] = createSignal<ThreadRowMode>("tabs");
  const [fold, setFold] = createSignal<RowFold | undefined>();
  const mode = (): ThreadRowMode => (props.tabs.length === 0 && measured() === "compact" ? "tabs" : measured());
  const foldMark = () => (mode() === "minimal" ? fold() : undefined);
  const dropTarget = () => (carriedThreadTab()?.from === "side" ? "" : undefined);
  onSettled(() => {
    const group = row?.parentElement;
    if (!row || !group) return;
    let start = 0;
    let chevronRoom = 0;
    const measure = () => {
      if (!row) return;
      const buttons = row.querySelectorAll(".agent-threads-icon-button");
      const button = buttons[0]?.getBoundingClientRect().width ?? 0;
      const box = group.getBoundingClientRect();
      const rightToLeft = getComputedStyle(group).direction === "rtl";
      const fromStart = (rect: DOMRect) => (rightToLeft ? box.right - rect.right : rect.left - box.left);
      const toEnd = (rect: DOMRect) => (rightToLeft ? box.right - rect.left : rect.right - box.left);
      const titleRoom = group.querySelector(".conversation-agent-title-room")?.getBoundingClientRect().width ?? 0;
      if (measured() !== "minimal") start = fromStart(row.getBoundingClientRect()) - titleRoom;
      const header = row.closest(".conversation-header");
      const chevron = header?.querySelector(".provider-model-trigger > .provider-model-chevron");
      if (chevron && chevron.getClientRects().length > 0) {
        const gap = Number.parseFloat(getComputedStyle(chevron.parentElement ?? chevron).columnGap) || 0;
        chevronRoom = chevron.getBoundingClientRect().width + gap;
      }
      const folded = fold();
      const chevronHidden = mode() === "minimal" && folded !== undefined && folded !== "name";
      const width = box.width - (chevronHidden ? chevronRoom : 0);
      const room = pickerRoom(header);
      const free = width - start - 2 * (button + 3) + room;
      setMode(rowMode(free));
      const title = group.firstElementChild;
      const avatar = title?.querySelector(".agent-avatar")?.getBoundingClientRect();
      const padding = title ? Number.parseFloat(getComputedStyle(title).paddingInlineStart) || 0 : 0;
      const avatarEnd = avatar ? toEnd(avatar) + padding + 1 : start;
      setFold(rowFold(width, chevronRoom, start, avatarEnd, button));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    measure();
    return () => observer.disconnect();
  });
  return (
    <div
      ref={row}
      class="agent-threads-header"
      data-mode={mode()}
      data-fold={foldMark()}
      data-drop-target={dropTarget()}
    >
      <Show when={mode() === "tabs"}>
        <Show when={props.tabs.length > 0}>
          <ThreadTabs {...props} />
        </Show>
        <NewThreadButton disabled={!props.canStartNew} onNew={props.onNew} />
      </Show>
      <ThreadMenu {...props} mode={mode()} />
      <Show when={mode() !== "tabs" && (foldMark() === undefined || foldMark() === "name")}>
        <NewThreadButton disabled={!props.canStartNew} onNew={props.onNew} />
      </Show>
    </div>
  );
}

export function ThreadHeader(props: ThreadHeaderProps) {
  const single = () => props.tabs.length === 0 && props.threads.length === 0 && props.archived.length === 0;
  return (
    <Show when={!single()} fallback={<NewThreadButton disabled={!props.canStartNew} onNew={props.onNew} />}>
      <ThreadRow {...props} />
    </Show>
  );
}
