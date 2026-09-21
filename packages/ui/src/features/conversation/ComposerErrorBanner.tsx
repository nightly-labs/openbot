import type { JSX } from "@solidjs/web";
import { ComposerNotice } from "./ComposerNotice";

/**
 * The chat-scoped error banner. Every error that names an agent belongs here rather than in a
 * `toast.*`, which stays for global failures that name no agent.
 *
 * Errors are keyed by `composerDraftKey({ agentId, serverId })`, so switching chats shows only the
 * target chat's error and dismissing one never clears another. There is no auto-dismiss: the error
 * stands for its chat until the user closes it or a send succeeds.
 *
 * `ComposerSignInNotice` and `ComposerUsageLimitNotice` carry no dismiss because they name a block
 * the user cannot act past. Every other error banner uses this component.
 */
export function ComposerErrorBanner(props: {
  message: string;
  conversationKey?: string | null;
  onDismiss: () => void;
  action?: JSX.Element;
}): JSX.Element {
  return (
    <ComposerNotice
      tone="danger"
      body={props.message}
      conversationKey={props.conversationKey}
      action={props.action}
      onDismiss={() => props.onDismiss()}
    />
  );
}
