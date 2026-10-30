import { Button } from "@openbot/ui";
import { untrack } from "solid-js";
import { useText } from "../../text";
import { newMessagesLabel, preferredMessageScrollBehavior } from "./MessageNavigation";

export function UnreadMessagesBanner(props: {
  count: number;
  busy?: boolean;
  onJumpToUnread: () => void;
  onMarkRead: () => void;
}) {
  const { t } = useText();
  const label = () => newMessagesLabel(props.count, t);
  return (
    <div class="unread-messages-banner" role="status" aria-label={label()}>
      <Button
        variant="ghost"
        class="unread-messages-jump"
        type="button"
        aria-label={t("chat.newMessages.jump", { count: props.count })}
        data-cuelume-tap="navigate"
        onClick={props.onJumpToUnread}
      >
        {label()}
      </Button>
      <Button
        variant="ghost"
        class="unread-messages-mark-read"
        type="button"
        disabled={props.busy}
        onClick={props.onMarkRead}
      >
        <span class="unread-messages-mark-read-label">
          {props.busy ? t("chat.unread.marking") : t("chat.unread.markRead")}
        </span>
      </Button>
    </div>
  );
}

export function UnreadMessagesDivider(props: {
  elementRef?: (element: HTMLDivElement) => void;
  /** Asked once, when the line shows: true when it marks a new place, and then it animates in. */
  animateIn?: (() => boolean) | undefined;
}) {
  const { t } = useText();
  const arrives = untrack(() => props.animateIn?.() === true);
  return (
    <div class="unread-messages-divider" data-arrive={arrives ? "" : undefined} ref={props.elementRef}>
      <hr aria-label={t("chat.unread.dividerLabel")} />
      <span>{t("chat.unread.dividerBadge")}</span>
      <hr />
    </div>
  );
}

export function scrollToUnreadBoundary(
  scrollElement: HTMLElement,
  boundary: HTMLElement,
  behavior: ScrollBehavior = preferredMessageScrollBehavior(),
): void {
  const top =
    boundary.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop;
  scrollElement.scrollTo({ top: Math.max(0, top), behavior });
}

export function unreadMessagesDividerIsVisible(scrollElement: HTMLElement, divider: HTMLElement): boolean {
  if (!divider.isConnected) return false;
  const scrollBounds = scrollElement.getBoundingClientRect();
  const dividerBounds = divider.getBoundingClientRect();
  return dividerBounds.bottom > scrollBounds.top && dividerBounds.top < scrollBounds.bottom;
}
