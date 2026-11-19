import type { JSX } from "@solidjs/web";

export function MarkdownMessageText(props: {
  body: string;
  imagesAsLinks?: boolean;
  linkFavicons?: boolean;
  agents: never[];
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
}): JSX.Element;
