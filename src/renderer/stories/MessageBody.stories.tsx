import { Bubble, BubbleContent, type BubbleVariant } from "@openbot/ui";
import type { AgentMessage } from "@openbot/ui/data";
import { MessageBody } from "@openbot/ui/features/conversation/MessageRendering";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS, STORY_ATTACHMENTS } from "./fixtures";

const message: AgentMessage = {
  id: "message-body-1",
  author: "agent",
  body: "Here is the latest brief. You can also review https://openbot.run/docs or ask @Research.",
  time: "10:00",
  status: "Ready to review",
  attachments: STORY_ATTACHMENTS,
};

const args: Parameters<typeof MessageBody>[0] = {
  message,
  referencedMessage: undefined,
  agents: STORY_AGENTS,
  onSelectAgent: fn(),
  onOpenLink: fn(),
  onPreview: fn(),
  onAttachmentAction: fn(),
};

const meta = {
  title: "Conversation/MessageBody",
  component: MessageBody,
  args,
  parameters: { layout: "centered" },
} satisfies Meta<typeof MessageBody>;

export default meta;
type Story = StoryObj<typeof meta>;

function MessageBodySurface(props: {
  args: Parameters<typeof MessageBody>[0];
  author?: "assistant" | "user";
  variant?: BubbleVariant;
  width: string;
}) {
  const author = () => props.author ?? "assistant";
  return (
    <Bubble
      align={author() === "user" ? "end" : "start"}
      variant={props.variant ?? (author() === "user" ? "default" : "muted")}
      data-author={author()}
      style={{ width: props.width, "max-width": "calc(100vw - 32px)" }}
    >
      <BubbleContent>
        <MessageBody {...props.args} />
      </BubbleContent>
    </Bubble>
  );
}

export const RichMessage: Story = {};

/**
 * A signed-out provider. The bubble names the state and nothing else: the raw 401 exchange the
 * provider returned is replaced upstream, and the Sign in action lives on the composer notice, so
 * one stale bubble cannot offer a second, competing way in.
 */
export const AuthError: Story = {
  args: {
    message: {
      ...message,
      id: "message-auth-error",
      kind: "error",
      status: "Sign in required",
      body: "Authentication failed. Check your account or server connection, then try again.",
      attachments: [],
    },
  },
  render: (storyArgs) => <MessageBodySurface args={storyArgs} width="420px" />,
};

export const WithReplyContext: Story = {
  args: {
    referencedMessage: {
      id: "message-reference",
      author: "you",
      body: "Can you make this more concise?",
      time: "09:55",
    },
  },
};

export const WithSelectedTextInstruction: Story = {
  args: {
    message: {
      ...message,
      id: "message-selected-text-instruction",
      author: "you",
      body: "Make this more concise.\n\n> The selected sentence keeps all of the original context.",
      replyToMessageId: "message-reference",
      status: undefined,
      attachments: [],
    },
    referencedMessage: {
      id: "message-reference",
      author: "agent",
      body: "A longer agent response containing the selected sentence and supporting context.",
      time: "09:55",
    },
  },
  render: (storyArgs) => <MessageBodySurface args={storyArgs} author="user" width="360px" />,
};

export const AttachmentOnly: Story = {
  args: {
    message: { ...message, body: "", status: undefined },
  },
};

export const Markdown: Story = {
  args: {
    message: {
      ...message,
      id: "message-markdown",
      body: [
        "## Recommendation",
        "",
        "Use **Kobalte** with *Solid UI* and `@kobalte/core`.",
        "",
        "- Accessible controls",
        "  - Keyboard support",
        "- [x] Tested",
        "",
        "> Keep the public API small.",
      ].join("\n"),
      status: undefined,
      attachments: [],
    },
  },
  render: (storyArgs) => <MessageBodySurface args={storyArgs} width="460px" />,
};

export const WorkspaceFileLinks: Story = {
  args: {
    message: {
      ...message,
      id: "message-workspace-file-links",
      body: [
        "Pliki:",
        "",
        "- [page.tsx](/Users/test/OpenBot/Agents/builder/app/page.tsx)",
        "- [globals.css](/Users/test/OpenBot/Agents/builder/app/globals.css)",
        "",
        "Gotowe: [otwórz tablicę Lutra w HTML](< lutra-brand-board.html >)",
      ].join("\n"),
      status: undefined,
      attachments: [],
    },
    onOpenWorkspaceFile: fn(),
  },
  render: (storyArgs) => <MessageBodySurface args={storyArgs} width="620px" />,
};

export const CodeBlock: Story = {
  args: {
    message: {
      ...message,
      id: "message-code-block",
      body: [
        "The helper is ready:",
        "",
        "```ts churn.ts",
        "export async function churnBatch() {",
        '  const flavor = await getFlavor("pistachio");',
        "  const base = await dairy.fetch({ flavor });",
        '  await freezer.store(base, { temp: "-14C" });',
        "  return base.gallons;",
        "}",
        "```",
      ].join("\n"),
      status: undefined,
      attachments: [],
    },
  },
  render: (storyArgs) => <MessageBodySurface args={storyArgs} variant="ghost" width="460px" />,
};

export const StreamingCodeBlock: Story = {
  args: {
    message: {
      ...message,
      id: "message-streaming-code-block",
      body: [
        "```tsx AgentCard.tsx",
        "export function AgentCard(props: { name: string }) {",
        "  return <strong>{props.name}</strong>;",
      ].join("\n"),
      streaming: true,
      status: undefined,
      attachments: [],
    },
  },
  render: (storyArgs) => <MessageBodySurface args={storyArgs} variant="ghost" width="460px" />,
};

export const DataTable: Story = {
  args: {
    message: {
      ...message,
      id: "message-data-table",
      body: [
        "| Model | Context | $/1M in |",
        "| --- | --- | ---: |",
        "| gpt-4o | 128k | $5.00 |",
        "| claude-3.5 | 200k | $3.00 |",
        "| llama-3.1 | 128k | $0.90 |",
      ].join("\n"),
      status: undefined,
      attachments: [],
    },
  },
  render: (storyArgs) => <MessageBodySurface args={storyArgs} variant="ghost" width="460px" />,
};

export const DataTableNarrow: Story = {
  args: {
    message: {
      ...message,
      id: "message-data-table-narrow",
      body: [
        "| Fixture | Market odds H/D/A | Implied H/D/A | Scenario | Pick |",
        "| --- | ---: | ---: | ---: | --- |",
        "| Ipswich–Liverpool | 5.25 / 4.60 / 1.57 | 18% / 21% / 61% | 20% / 22% / 58% | Liverpool win |",
        "| Newcastle–Bournemouth | 2.20 / 3.70 / 3.00 | 43% / 26% / 32% | 45% / 27% / 28% | Newcastle, cautiously |",
      ].join("\n"),
      status: undefined,
      attachments: [],
    },
  },
  render: (storyArgs) => <MessageBodySurface args={storyArgs} variant="ghost" width="320px" />,
};

export const ComparisonTable: Story = {
  args: {
    message: {
      ...message,
      id: "message-comparison-table",
      body: [
        "| Feature | Personal | Enterprise |",
        "| --- | --- | --- |",
        "| Unlimited projects | ✓ | ✓ |",
        "| All components | ✓ | ✓ |",
        "| Team-wide usage | — | ✓ |",
        "| Priority support | — | ✓ |",
      ].join("\n"),
      status: undefined,
      attachments: [],
    },
  },
  render: (storyArgs) => <MessageBodySurface args={storyArgs} variant="ghost" width="460px" />,
};

export const ComparisonTableNarrow: Story = {
  args: {
    message: {
      ...message,
      id: "message-comparison-table-narrow",
      body: [
        "| Feature | Free | Personal | Business | Enterprise |",
        "| --- | --- | --- | --- | --- |",
        "| Unlimited projects | — | ✓ | ✓ | ✓ |",
        "| Team-wide usage | — | — | ✓ | ✓ |",
        "| Priority support | — | — | — | ✓ |",
      ].join("\n"),
      status: undefined,
      attachments: [],
    },
  },
  render: (storyArgs) => <MessageBodySurface args={storyArgs} variant="ghost" width="320px" />,
};

export const CompletedAnswerReveal: Story = {
  args: {
    message: {
      ...message,
      id: "completed-answer-reveal",
      body: "## Findings\n\nThe final answer is ready with **formatted text**.\n\n- Review the changes\n- Run the checks",
      animate: true,
      streaming: false,
      attachments: [],
    },
  },
  render: (storyArgs) => <MessageBodySurface args={storyArgs} variant="ghost" width="460px" />,
};
