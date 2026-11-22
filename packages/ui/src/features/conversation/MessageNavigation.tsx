import type { AppTranslate } from "@openbot/i18n";
import { Button, CornerDownLeft, X } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";

export function preferredMessageScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

export function scrollToLatestMessage(scrollElement: HTMLElement): void {
  scrollElement.scrollTo({
    top: scrollElement.scrollHeight,
    behavior: preferredMessageScrollBehavior(),
  });
}

export function newMessagesLabel(count: number, t: AppTranslate): string {
  return t("chat.newMessages.count", { count });
}

export function ScrollToLatestButton(props: { onClick: () => void; newMessageCount?: number; onDismiss?: () => void }) {
  const { t } = useText();
  const count = () => props.newMessageCount ?? 0;
  const showCount = () => count() > 0 && Boolean(props.onDismiss);
  return (
    <div class="scroll-to-latest" data-new-messages={showCount() ? "true" : undefined} aria-live="off">
      <Button
        variant="ghost"
        type="button"
        class="scroll-to-latest-button"
        aria-label={showCount() ? t("chat.newMessages.jump", { count: count() }) : t("chat.newMessages.scrollToLatest")}
        data-cuelume-tap="navigate"
        onClick={props.onClick}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 4v14m-6-6 6 6 6-6" />
        </svg>
        <Show when={showCount()}>
          <span class="scroll-to-latest-count">{newMessagesLabel(count(), t)}</span>
        </Show>
      </Button>
      <Show when={showCount()}>
        <Button
          variant="ghost"
          type="button"
          class="scroll-to-latest-dismiss"
          aria-label={t("chat.newMessages.dismiss")}
          data-cuelume-tap="close"
          onClick={() => props.onDismiss?.()}
        >
          <X aria-hidden="true" />
        </Button>
      </Show>
    </div>
  );
}

export function ReplyReturnButton(props: { onBack: () => void; onStay: () => void }) {
  const { t } = useText();
  return (
    <div class="scroll-to-latest" data-reply-return="true" aria-live="off">
      <Button
        variant="ghost"
        type="button"
        class="scroll-to-latest-button"
        data-cuelume-tap="navigate"
        onClick={props.onBack}
      >
        <CornerDownLeft class="scroll-to-latest-reply-icon" aria-hidden="true" />
        <span class="scroll-to-latest-count">{t("chat.reply.back")}</span>
      </Button>
      <Button
        variant="ghost"
        type="button"
        class="scroll-to-latest-dismiss"
        aria-label={t("chat.reply.stay")}
        data-cuelume-tap="close"
        onClick={props.onStay}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
