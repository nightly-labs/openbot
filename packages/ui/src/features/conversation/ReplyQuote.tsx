import { createSignal, onSettled } from "solid-js";
import { MarkdownMessageText } from "./MarkdownMessageText";
import type { RichMessageTextProps } from "./RichMessageText";

type ReplyQuoteProps = Pick<RichMessageTextProps, "body" | "agents" | "skills" | "attachments" | "citations"> & {
  id?: string | undefined;
};

export function ReplyQuote(props: ReplyQuoteProps) {
  let quote: HTMLDivElement | undefined;
  let content: HTMLDivElement | undefined;
  const [clipped, setClipped] = createSignal(false);
  onSettled(() => {
    const measure = () => setClipped(quote !== undefined && quote.scrollHeight > quote.clientHeight);
    const observer = new ResizeObserver(measure);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  });
  return (
    <div
      ref={(element) => (quote = element)}
      id={props.id}
      class="message-reply-quote"
      data-clipped={clipped() ? "" : undefined}
      inert
    >
      <div ref={(element) => (content = element)} class="message-markdown">
        <MarkdownMessageText
          body={props.body}
          agents={props.agents}
          skills={props.skills}
          attachments={props.attachments}
          citations={props.citations}
          onSelectAgent={() => undefined}
          onOpenLink={() => undefined}
          showCitationFooter={false}
          imagesAsLinks
          excerpt
        />
      </div>
    </div>
  );
}
