import { Button, Plus } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, onSettled, Show } from "solid-js";
import { ThreadMenu } from "./ThreadMenu";
import { ThreadTabs } from "./ThreadTabs";
import { carriedThreadTab } from "./thread-tab-drag";
import type { ThreadHeaderProps, ThreadRowMode } from "./thread-types";

/** Below this free width a full tab does not fit, and the tabs become one menu button. */
const COMPACT_BELOW = 200;
/** Below this free width the menu button has no space for its icon, a short title and the chevron. */
const MINIMAL_BELOW = 48;

/**
 * The parts of the minimal row that fold away, in order: the agent name, so only its avatar shows;
 * "+", which the thread list also has, with the chevron of the model picker; the list button; and
 * last the avatar.
 */
type RowFold = "name" | "new" | "list" | "all";

/**
 * The fold for the width of the heading group. `width` has the picker chevron shown and `chevron` is
 * its room; `start` and `avatarEnd` are where the row starts with the full name and with the avatar.
 */
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

/**
 * The width that the model picker of the header can give to the tabs: its name and effort close
 * before the tabs become one button. Each part gives its width and the gap before it. The width is
 * read as it shows, so it stays correct while a part slides.
 */
function pickerRoom(header: Element | null): number {
  const trigger = header?.querySelector(".provider-model-trigger");
  if (!trigger) return 0;
  const gap = Number.parseFloat(getComputedStyle(trigger).columnGap) || 0;
  let room = 0;
  for (const part of trigger.querySelectorAll(".provider-model-trigger-name, .provider-model-trigger-effort")) {
    if (part.getClientRects().length === 0) continue;
    room += part.getBoundingClientRect().width + gap + (Number.parseFloat(getComputedStyle(part).marginLeft) || 0);
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

/**
 * The tabs, "+" and the thread list. In a narrow header the tabs and the list button become one
 * button with the open thread, and "+" follows it. The heading group takes the free width of the
 * header whatever it holds, so its width decides the mode and the mode does not change it again.
 * The agent's own chat has no tab: the agent's name before the row opens it. With no side thread
 * tab, only "+" and the thread list show.
 */
function ThreadRow(props: ThreadHeaderProps) {
  let row: HTMLDivElement | undefined;
  const [measured, setMode] = createSignal<ThreadRowMode>("tabs");
  /** How much of the minimal row folds away. */
  const [fold, setFold] = createSignal<RowFold | undefined>();
  // With no tab to show, the compact button would only repeat the agent's name.
  const mode = (): ThreadRowMode => (props.tabs.length === 0 && measured() === "compact" ? "tabs" : measured());
  const foldMark = () => (mode() === "minimal" ? fold() : undefined);
  /** A side panel tab over the chat moves its thread to these tabs when the pointer lets it go. */
  const dropTarget = () => (carriedThreadTab()?.from === "side" ? "" : undefined);
  onSettled(() => {
    const group = row?.parentElement;
    if (!row || !group) return;
    // Where the row starts in the group while the agent name shows in full. In the minimal mode only
    // the avatar shows, so the row keeps the last full start and the mode does not change it again.
    let start = 0;
    /** The width of the picker chevron and the gap before it, which a deep fold gives to the row. */
    let chevronRoom = 0;
    const measure = () => {
      if (!row) return;
      const buttons = row.querySelectorAll(".agent-threads-icon-button");
      const button = buttons[0]?.getBoundingClientRect().width ?? 0;
      const box = group.getBoundingClientRect();
      if (measured() !== "minimal") start = row.getBoundingClientRect().left - box.left;
      const header = row.closest(".conversation-header");
      const chevron = header?.querySelector(".provider-model-trigger > .provider-model-chevron");
      if (chevron && chevron.getClientRects().length > 0) {
        const gap = Number.parseFloat(getComputedStyle(chevron.parentElement ?? chevron).columnGap) || 0;
        chevronRoom = chevron.getBoundingClientRect().width + gap;
      }
      // The group width with the chevron shown, so a hidden chevron cannot change the fold again.
      const folded = fold();
      const chevronHidden = mode() === "minimal" && folded !== undefined && folded !== "name";
      const width = box.width - (chevronHidden ? chevronRoom : 0);
      // The free width without "+" and the list button, which the full row has. The model picker gets
      // smaller before the tabs and shows only its icon in the narrow modes, so its room counts as free.
      // The sum stays the same whatever size the picker has, so the mode does not change it again.
      const room = pickerRoom(header);
      const free = width - start - 2 * (button + 3) + room;
      setMode(rowMode(free));
      // The minimal row is the list button and "+", with the gap between them. Without its name, the
      // agent name ends after the avatar and the padding before it.
      const title = group.firstElementChild;
      const avatar = title?.querySelector(".agent-avatar")?.getBoundingClientRect();
      const padding = title ? Number.parseFloat(getComputedStyle(title).paddingLeft) || 0 : 0;
      const avatarEnd = avatar ? avatar.right - box.left + padding + 1 : start;
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

/**
 * The threads of an agent, in the chat header. An agent with only its own chat shows only a "New
 * thread" button, so its header stays almost the same. With a side thread, a menu of the side
 * threads shows, and the side threads with a tab show as tabs.
 */
export function ThreadHeader(props: ThreadHeaderProps) {
  const single = () => props.tabs.length === 0 && props.threads.length === 0 && props.archived.length === 0;
  return (
    <Show when={!single()} fallback={<NewThreadButton disabled={!props.canStartNew} onNew={props.onNew} />}>
      <ThreadRow {...props} />
    </Show>
  );
}
