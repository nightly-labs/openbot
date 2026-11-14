import { fileQuoteId } from "@openbot/contracts/chat-tag-references";
import { chatVisualReply } from "@openbot/contracts/chat-visual";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { ChatVisual } from "@openbot/ui/features/conversation/ChatVisual";
import { createSignal, onCleanup, untrack } from "solid-js";
import { deviceQuoteShortcut } from "../../send-shortcut-preference";
import { isChatVisualAppShortcut } from "./chat-visual-shortcuts";
import { chatVisualPageUrl } from "./chat-visual-url";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";
import { draftWithPageContext, draftWithPageText } from "./stores/message-actions";

export interface ChatVisualPage {
  attachment: AttachmentSummary;
  height?: number;
}

/**
 * The page of a visual reply that this client can show, or null. The desktop loads the page from its
 * own scheme. The web client has no page URL: it reads the HTML and shows it as `srcdoc`. Another
 * client shows the title and the file.
 */
export function shownVisualReply(
  message: AgentMessage,
  loadPage: ((attachment: AttachmentSummary) => Promise<string>) | undefined,
): ChatVisualPage | null {
  const visual = chatVisualReply(message);
  return visual && (chatVisualPageUrl(visual.attachment.previewUrl) || loadPage) ? visual : null;
}

/** A visual reply: the agent's page above its final reply, with no bubble. */
export function ChatVisualReply(props: {
  message: AgentMessage;
  /** The page when the row was made. The row keeps it while the message changes. */
  initial: ChatVisualPage;
  onMessage: (text: string) => void;
  onContext: (text: string) => void;
  onQuote: (quoteId: string, text: string) => void;
}) {
  const { props: view, openExternalMessageUrl, previewAttachment } = useConversationViewScope();
  const visual = () => chatVisualReply(props.message) ?? props.initial;
  const pageUrl = () => chatVisualPageUrl(visual().attachment.previewUrl);
  // The page quotes as its file, as in the side panel, so the quote chip opens the page.
  const pageQuoteId = () =>
    fileQuoteId({ source: "attachment", attachmentId: visual().attachment.id, name: visual().attachment.name });
  const loadPage = untrack(() => conversationRuntime(view).visualPage);
  const [page, setPage] = createSignal<{ html?: string; failed?: boolean }>({});
  if (loadPage && !untrack(pageUrl)) {
    let mounted = true;
    onCleanup(() => {
      mounted = false;
    });
    void loadPage(untrack(() => props.initial.attachment)).then(
      (html) => {
        if (mounted) setPage({ html });
      },
      () => {
        if (mounted) setPage({ failed: true });
      },
    );
  }
  return (
    <ChatVisual
      src={pageUrl()}
      html={page().html}
      failed={pageUrl() === undefined && (!loadPage || page().failed === true)}
      title={props.message.body}
      height={visual().height}
      onOpenLink={(url) => void openExternalMessageUrl(url)}
      onMessage={props.onMessage}
      onContext={props.onContext}
      onQuote={(text) => props.onQuote(pageQuoteId(), text)}
      quoteShortcut={deviceQuoteShortcut(view.platform)}
      onOpenInSidePanel={() => void previewAttachment(visual().attachment)}
      isAppShortcut={isChatVisualAppShortcut}
      macWindowControls={view.platform === "darwin"}
    />
  );
}

/**
 * The visual reply pages of a side thread, as `messageCard` of its view. A page writes in the thread's
 * message box, and quotes there, as a page in the agent's chat does in the chat's message box.
 */
export function useThreadVisualReplyCard(draftKey: () => string | undefined, focusDraft?: () => void) {
  const { props: view, threadComposer } = useConversationViewScope();
  const setDraft = (next: (draft: string) => string | undefined) => {
    const key = draftKey();
    if (!key) return;
    const text = next(threadComposer.draft(key).text);
    if (text !== undefined) threadComposer.setText(key, text);
  };
  return (message: AgentMessage, quote: (messageId: string, text: string) => void) => {
    const visual = shownVisualReply(
      message,
      untrack(() => conversationRuntime(view).visualPage),
    );
    if (!visual) return undefined;
    return (
      <article data-chat-search-message={message.id} aria-label={message.body}>
        <ChatVisualReply
          message={message}
          initial={visual}
          onMessage={(text) => {
            setDraft((draft) => draftWithPageText(draft, text));
            focusDraft?.();
          }}
          onContext={(text) => setDraft((draft) => draftWithPageContext(draft, message.id, text))}
          onQuote={quote}
        />
      </article>
    );
  };
}
