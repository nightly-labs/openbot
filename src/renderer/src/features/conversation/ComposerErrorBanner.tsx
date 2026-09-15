import type { JSX } from "@solidjs/web";
import { Button } from "../../components/ui";
import { CloseIcon } from "./ConversationIcons";

/**
 * Desktop notification pattern: chat-scoped error banner.
 *
 * Placement: in normal flow directly above the composer input, under the
 * queue/reply/notices, same column as `ComposerNotice`. It pushes content
 * rather than overlaying the composer, so it never obscures the input and
 * causes no overlay jump. Max width matches the composer column.
 *
 * Severity: danger tone only. Warning/notice states use `ComposerNotice`;
 * transient global states use `toast.*` top-right with `TOAST_DURATION`.
 *
 * Dismissal: always dismissible via the close button. No auto-dismiss:
 * the error persists for its chat until dismissed or resolved by a
 * successful retry/send. Dismissal clears only the current chat's keyed
 * entries, so it never clears another chat and never reappears on
 * rerender, navigation, or reconnect unless a new error is recorded.
 *
 * Lifecycle: errors are keyed by `composerDraftKey({ agentId, serverId })`
 * in stable state. Switching chats shows only the target chat's error.
 * Global errors stay global only when emitted via `toast.*` (for example
 * provider failures in `agent-event-bridge`); chat failures never emit a
 * global toast.
 *
 * Focus/accessibility: `role="alert"` announces without stealing focus.
 * The dismiss button is a native button (Enter/Space) with
 * `aria-label="Dismiss error"`. Escape dismisses when focus is inside the
 * banner. Focus is not moved on appear; after dismissal the caller may
 * return focus to the composer.
 *
 * Non-dismissible exceptions: `ComposerSignInNotice` and
 * `ComposerUsageLimitNotice` have no dismiss because they name an
 * un-actionable block with its resolution path (sign in, wait/switch
 * model). Every other error banner must use this component.
 */
export function ComposerErrorBanner(props: {
  message: string;
  conversationKey?: string | null;
  onDismiss: () => void;
  action?: JSX.Element;
}): JSX.Element {
  return (
    <div
      class="composer-error"
      role="alert"
      data-conversation-key={props.conversationKey ?? undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          props.onDismiss();
        }
      }}
    >
      <span class="composer-error-message">{props.message}</span>
      {props.action}
      <Button
        variant="ghost"
        type="button"
        size="sm"
        class="composer-error-dismiss"
        aria-label="Dismiss error"
        onClick={() => props.onDismiss()}
      >
        <CloseIcon />
      </Button>
    </div>
  );
}
