import type { JSX } from "@solidjs/web";

/**
 * The props of `@openbot/ui/features/conversation/MarkdownMessageText` that the site uses. Its source
 * reaches DOM code that the Worker types reject, so the site checks this declaration instead, as it
 * does for `@openbot/renderer-web`. The page names no agents, so `agents` is always empty.
 */
export function MarkdownMessageText(props: {
  body: string;
  imagesAsLinks?: boolean;
  linkFavicons?: boolean;
  agents: never[];
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
}): JSX.Element;
