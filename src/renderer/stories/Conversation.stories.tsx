import { serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import type { AgentEvent, AttachmentSummary, DraftAttachment, QueueSnapshot } from "@openbot/contracts/ipc";
import type { AgentMessage as RendererAgentMessage, RoutineRunMarkerModel } from "@openbot/ui/data";
import { BrowserTakeoverCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import { currentText } from "@openbot/ui/text";
import { Portal } from "@solidjs/web";
import { createEffect, createSignal, onCleanup, onSettled, Show } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { clipboardFiles } from "../../preload/clipboard-files";
import { Conversation, createConversationController } from "../src/features/conversation/Conversation";
import { ConversationView } from "../src/features/conversation/ConversationView";
import { ConversationControllerProvider } from "../src/features/conversation/conversation-controller-context";
import { composerDraftKey } from "../src/features/conversation/conversation-keys";
import type { VoicePhase } from "../src/features/conversation/voice-status";
import browserTakeoverPreviewUrl from "./assets/browser-takeover-preview.svg";
import {
  CONVERSATION_STORY_ARGS,
  CONVERSATION_STORY_ATTACHMENT,
  CONVERSATION_STORY_MESSAGES,
  StoryAppProviders,
} from "./conversation-story-support";
import { STORY_AGENT_STATUS, STORY_AGENTS, STORY_ATTACHMENTS, STORY_PRESENCE, STORY_QUEUES } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

const storyAttachment = CONVERSATION_STORY_ATTACHMENT;
const messages = CONVERSATION_STORY_MESSAGES;
const args = CONVERSATION_STORY_ARGS;

const unreadStoryMessages: RendererAgentMessage[] = [
  ...Array.from(
    { length: 12 },
    (_, index): RendererAgentMessage => ({
      id: `unread-history-${index + 1}`,
      author: index % 2 === 0 ? "you" : "agent",
      body:
        index % 2 === 0
          ? `Historical project update ${index + 1}: please check the owner and due date.`
          : `Reviewed historical update ${index + 1}. The owner and due date are confirmed.`,
      time: `09:${String(20 + index).padStart(2, "0")}`,
      kind: "text",
    }),
  ),
  ...Array.from(
    { length: 8 },
    (_, index): RendererAgentMessage => ({
      id: `unread-story-new-${index + 1}`,
      author: "agent",
      body: `New update ${index + 1}: I reviewed the launch plan, verified the supporting notes, and added a concrete next action for the team. This message intentionally has enough detail to keep the unread boundary above the visible viewport when the conversation opens at the bottom.`,
      time: `09:${String(40 + index).padStart(2, "0")}`,
      kind: "text",
    }),
  ),
];

const imageGenerationMessages: RendererAgentMessage[] = [
  ...messages,
  {
    id: "image-generation-user",
    author: "you",
    body: "Create a quiet observatory above the clouds at blue hour.",
    time: "10:02",
    kind: "text",
  },
  {
    id: "image-generation-in-chat",
    author: "agent",
    body: "",
    time: "10:02",
    turnId: "turn-image-generation",
    itemType: "image_generation",
    status: "streaming",
    streaming: true,
    kind: "text",
    imageGeneration: {
      prompt: "A quiet observatory above the clouds at blue hour",
      resolution: "1024 × 1024",
      aspectRatio: "square",
    },
  },
];

const generatedImagePreview = new URL("../src/assets/openbot-logo-production.png", import.meta.url).href;
const generatedImagePreviewAlternate = new URL("../src/assets/openbot-logo-dev.png", import.meta.url).href;
const generatedImageAttachment: AttachmentSummary = {
  id: "generated-image-in-chat",
  name: "generated-image.png",
  size: 184_320,
  kind: "image",
  mimeType: "image/png",
  previewKind: "image",
  previewUrl: generatedImagePreview,
};
const queuePrimaryAttachment: AttachmentSummary = {
  ...generatedImageAttachment,
  id: "queue-preview-primary",
  name: "command-search.png",
};
const queueAlternateAttachment: AttachmentSummary = {
  ...generatedImageAttachment,
  id: "queue-preview-alternate",
  name: "message-search.png",
  previewUrl: generatedImagePreviewAlternate,
};
const queuePreviewAttachments: AttachmentSummary[] = [queuePrimaryAttachment, queueAlternateAttachment];
const supportedContextAttachments: AttachmentSummary[] = [
  {
    id: "composer-context-pdf",
    name: "product-brief.pdf",
    size: 842_752,
    kind: "file",
    mimeType: "application/pdf",
    previewKind: "pdf",
    previewUrl: null,
  },
  {
    id: "composer-context-markdown",
    name: "README.md",
    size: 12_288,
    kind: "file",
    mimeType: "text/markdown",
    previewKind: "text",
    previewUrl: null,
  },
  {
    id: "composer-context-text",
    name: "meeting-notes.txt",
    size: 4_096,
    kind: "file",
    mimeType: "text/plain",
    previewKind: "text",
    previewUrl: null,
  },
  {
    id: "composer-context-json",
    name: "sample-data.json",
    size: 24_576,
    kind: "file",
    mimeType: "application/json",
    previewKind: "text",
    previewUrl: null,
  },
  {
    id: "composer-context-docx",
    name: "requirements.docx",
    size: 126_976,
    kind: "file",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    previewKind: "none",
    previewUrl: null,
  },
];
const sentContextFileMessages: RendererAgentMessage[] = [
  {
    id: "sent-context-request",
    author: "agent",
    body: "Podeślij materiały, na których mam oprzeć podsumowanie.",
    time: "10:04",
    kind: "text",
  },
  {
    id: "sent-context-files",
    author: "you",
    body: "Jasne — załączam brief, notatki, dane i wymagania. Przygotuj z nich krótkie podsumowanie.",
    time: "10:05",
    kind: "text",
    attachments: supportedContextAttachments,
  },
];

const completedImageGenerationMessages: RendererAgentMessage[] = imageGenerationMessages.map((message) =>
  message.id === "image-generation-in-chat"
    ? {
        ...message,
        status: "completed",
        streaming: false,
        attachments: [generatedImageAttachment],
      }
    : message,
);
const completedImageGenerationPresence = {
  ...STORY_PRESENCE,
  members: STORY_PRESENCE.members.map((member) =>
    member.typingAgentId === "chief" ? { ...member, typingAgentId: null } : member,
  ),
};

const agentMessageGalleryMessages: RendererAgentMessage[] = [
  {
    id: "agent-gallery-error",
    author: "agent",
    body: "Authentication failed. Check your account or server connection, then try again.",
    time: "09:59",
    kind: "error",
    status: "Sign in required",
  },
  {
    id: "agent-gallery-user",
    author: "you",
    body: "Show every message surface and interaction in one thread.",
    time: "10:00",
    kind: "text",
  },
  {
    id: "agent-gallery-plain",
    author: "agent",
    body: "Plain assistant text uses the muted Bubble surface and keeps its actions aligned with the bottom edge.",
    time: "10:01",
    kind: "text",
    reaction: "👍",
    reactionSummary: { emojis: ["👍", "🚀"], overflowCount: 2 },
  },
  {
    id: "agent-gallery-links",
    author: "agent",
    body: [
      "## Links and references",
      "",
      "Review [OpenBot documentation](https://openbot.run/docs), the [Kobalte guide](https://kobalte.dev/docs/core/overview/introduction), and https://zaidan.carere.dev/docs/components/kobalte/bubble.",
      "",
      "You can also open [ConversationView.tsx](/Users/test/OpenBot/src/renderer/src/features/conversation/ConversationView.tsx), ask @Research, or inspect the attached source file below.",
      "",
      `Attachment reference: ${serializeAttachmentReference(storyAttachment.name, storyAttachment.id)}.`,
      "",
      "The implementation follows the component source [1] and the accessibility guidance [2].",
    ].join("\n"),
    time: "10:02",
    kind: "text",
    attachments: [storyAttachment],
    citations: [
      {
        number: 1,
        label: "Zaidan Bubble",
        url: "https://zaidan.carere.dev/docs/components/kobalte/bubble",
        host: "zaidan.carere.dev",
      },
      {
        number: 2,
        label: "Kobalte accessibility",
        url: "https://kobalte.dev/docs/core/overview/accessibility",
        host: "kobalte.dev",
      },
    ],
    reaction: "👀",
    reactionSummary: { emojis: ["👀", "🔥", "✅"], overflowCount: 1 },
  },
  {
    id: "agent-gallery-reply",
    author: "agent",
    body: "This Bubble includes a reply context without changing how reactions or message actions are positioned.",
    time: "10:03",
    kind: "text",
    replyToMessageId: "agent-gallery-user",
    reaction: "❤️",
  },
  {
    id: "agent-gallery-markdown",
    author: "agent",
    body: [
      "## Markdown response",
      "",
      "- **Bold**, *emphasis*, and `inline code`",
      "- [x] Completed task",
      "- [ ] Pending task",
      "",
      "> Rich text remains inside one assistant Bubble.",
    ].join("\n"),
    time: "10:04",
    kind: "text",
    reaction: "🎉",
  },
  {
    id: "agent-gallery-code",
    author: "agent",
    body: [
      "Run the focused verification:",
      "",
      "```bash verify-chat.sh",
      "bun run typecheck:renderer",
      "bunx vitest run src/renderer/src/features/conversation/MessageRendering.test.tsx",
      "```",
    ].join("\n"),
    time: "10:05",
    kind: "text",
    reaction: "✅",
    reactionSummary: { emojis: ["✅", "🚀"] },
  },
  {
    id: "agent-gallery-data-table",
    author: "agent",
    body: [
      "Current message surfaces:",
      "",
      "| Content | Surface | Actions |",
      "| --- | --- | --- |",
      "| Plain text | Muted | Reply + react |",
      "| Code | Ghost | Reply + react |",
      "| Image | Ghost | Reply + react |",
    ].join("\n"),
    time: "10:06",
    kind: "text",
    reaction: "🚀",
  },
  {
    id: "agent-gallery-comparison-table",
    author: "agent",
    body: [
      "Feature matrix:",
      "",
      "| Capability | Text | Rich content |",
      "| --- | --- | --- |",
      "| Reactions | ✓ | ✓ |",
      "| Reply | ✓ | ✓ |",
      "| Keyboard actions | ✓ | ✓ |",
      "| Nested frame | — | — |",
    ].join("\n"),
    time: "10:07",
    kind: "text",
    reaction: "💯",
  },
  {
    id: "agent-gallery-attachment-with-text",
    author: "agent",
    body: "The supporting files are ready. This example keeps an attachment inside a regular text Bubble.",
    time: "10:08",
    kind: "text",
    attachments: STORY_ATTACHMENTS.slice(0, 2),
    reaction: "👏",
  },
  {
    id: "agent-gallery-attachment-only",
    author: "agent",
    body: "",
    time: "10:09",
    kind: "text",
    attachments: [storyAttachment],
    reaction: "🔥",
  },
  {
    id: "agent-gallery-image",
    author: "agent",
    body: "",
    time: "10:10",
    kind: "text",
    status: "completed",
    attachments: [generatedImageAttachment],
    imageGeneration: {
      prompt: "A quiet observatory above the clouds at blue hour",
      resolution: "1024 × 1024",
      aspectRatio: "square",
    },
    reaction: "😮",
    reactionSummary: { emojis: ["😮", "🎉"], overflowCount: 3 },
  },
  {
    id: "agent-gallery-failed",
    author: "agent",
    body: "I could not finish the remote verification. The message still exposes reply, copy, and reaction actions.",
    time: "10:11",
    kind: "text",
    status: "Failed",
    reaction: "🤔",
  },
  {
    id: "agent-gallery-streaming",
    author: "agent",
    body: [
      "Streaming response with an open code fence:",
      "",
      "```ts stream.ts",
      "const message = await renderNextChunk();",
    ].join("\n"),
    time: "10:12",
    kind: "text",
    turnId: "agent-gallery-stream",
    status: "streaming",
    streaming: true,
  },
];

const dataTableMessages: RendererAgentMessage[] = [
  {
    id: "data-table-user",
    author: "you",
    body: "Compare the upcoming Premier League fixtures.",
    time: "10:02",
    kind: "text",
  },
  {
    id: "data-table-agent",
    author: "agent",
    body: [
      "Here’s a compact comparison based on the current market:",
      "",
      "| Fixture | Market odds H/D/A | Implied H/D/A | Scenario | Pick |",
      "| --- | ---: | ---: | ---: | --- |",
      "| Ipswich–Liverpool | 5.25 / 4.60 / 1.57 | 18% / 21% / 61% | 20% / 22% / 58% | Liverpool win |",
      "| Newcastle–Bournemouth | 2.20 / 3.70 / 3.00 | 43% / 26% / 32% | 45% / 27% / 28% | Newcastle, cautiously |",
      "| Brighton–Leeds | 1.90 / 3.60 / 4.00 | 50% / 26% / 24% | 48% / 27% / 25% | Brighton win |",
      "",
      "Long values should remain readable by scrolling the table, and the message actions should stay aligned with the bottom of the response.",
    ].join("\n"),
    time: "10:03",
    kind: "text",
  },
];

const codeBlockMessages: RendererAgentMessage[] = [
  {
    id: "code-block-user",
    author: "you",
    body: "Show me the launch check command.",
    time: "10:02",
    kind: "text",
  },
  {
    id: "code-block-agent",
    author: "agent",
    body: [
      "Run this from the repository root:",
      "",
      "```bash",
      "bun run check",
      "bun run test",
      "bun run build",
      "```",
    ].join("\n"),
    time: "10:03",
    kind: "text",
  },
  {
    id: "code-block-follow-up",
    author: "agent",
    body: "The checks should complete before release.",
    time: "10:04",
    kind: "text",
  },
];

const diagramMessages: RendererAgentMessage[] = [
  {
    id: "diagram-user",
    author: "you",
    body: "Draw how a message gets to the agent.",
    time: "10:02",
    kind: "text",
  },
  {
    id: "diagram-agent",
    author: "agent",
    body: [
      "```mermaid",
      "flowchart LR",
      "  Composer --> Queue --> Agent --> Reply",
      "```",
      "",
      "The second diagram has an error, so it stays code with the reason above it:",
      "",
      "```mermaid",
      "flowchart LR",
      "  Composer --> --> Agent",
      "```",
    ].join("\n"),
    time: "10:03",
    kind: "text",
  },
];

const markdownImageMessages: RendererAgentMessage[] = [
  {
    id: "markdown-images-user",
    author: "you",
    body: "Show me the logo options.",
    time: "10:02",
    kind: "text",
  },
  {
    id: "markdown-images-agent",
    author: "agent",
    body: [
      "These are the three options. Select an image to open it larger.",
      "",
      `![Production logo](${generatedImagePreview})`,
      "",
      `![Development logo](${generatedImagePreviewAlternate})`,
      "",
      `![](${new URL("../src/assets/openbot-logo-preview.png", import.meta.url).href})`,
    ].join("\n"),
    time: "10:03",
    kind: "text",
  },
];

const markdownMessages: RendererAgentMessage[] = [
  {
    id: "markdown-user",
    author: "you",
    body: "Which component library should we use for Solid JS?",
    time: "10:02",
    kind: "text",
  },
  {
    id: "markdown-agent",
    author: "agent",
    body: [
      "## Recommendation",
      "",
      "The best fit is **Kobalte**. Use *Solid UI* when you need ready-made components.",
      "",
      "### Why",
      "",
      "- Mature and actively maintained",
      "- Strong accessibility support",
      "  - Keyboard navigation",
      "  - Focus management",
      "- [x] Works with our design system",
      "- [ ] Add the remaining primitives",
      "",
      "1. Install `@kobalte/core`.",
      "2. Replace ~~custom controls~~ with shared primitives.",
      "",
      "> Keep the public UI API small and stable.",
      "",
      "Read [the Kobalte guide](https://kobalte.dev/docs/core/overview/introduction).",
    ].join("\n"),
    time: "10:03",
    kind: "text",
  },
  {
    id: "markdown-follow-up",
    author: "agent",
    body: "I can prepare the migration checklist next.",
    time: "10:04",
    kind: "text",
  },
];

const streamingMarkdownChunks = [
  "## Live response\n\nI am checking the",
  "## Live response\n\nI am checking the **Markdown renderer**.",
  [
    "## Live response",
    "",
    "I am checking the **Markdown renderer**.",
    "",
    "- Parse emphasis",
    "- Resize the message row",
  ].join("\n"),
  [
    "## Live response",
    "",
    "I am checking the **Markdown renderer**.",
    "",
    "- Parse emphasis",
    "- Resize the message row",
    "",
    "```ts",
    "const ready = true;",
  ].join("\n"),
  [
    "## Live response",
    "",
    "I am checking the **Markdown renderer**.",
    "",
    "- Parse emphasis",
    "- Resize the message row",
    "",
    "```ts",
    "const ready = true;",
    "```",
    "",
    "The streamed response is complete.",
  ].join("\n"),
] as const;

function streamingMarkdownMessages(chunkIndex: number): RendererAgentMessage[] {
  const body = streamingMarkdownChunks[chunkIndex];
  if (body === undefined) throw new Error(`Streaming Markdown chunk ${chunkIndex} is missing.`);
  return [
    {
      id: "streaming-markdown-user",
      author: "you",
      body: "Check Markdown while the model response streams.",
      time: "10:02",
      kind: "text",
    },
    {
      id: "streaming-markdown-agent",
      author: "agent",
      body,
      time: "10:03",
      kind: "text",
      streaming: chunkIndex < streamingMarkdownChunks.length - 1,
    },
    {
      id: "streaming-markdown-follow-up",
      author: "agent",
      body: "This message must stay below the growing response.",
      time: "10:04",
      kind: "text",
    },
  ];
}

function StreamingMarkdownConversation(props: { args: Parameters<typeof Conversation>[0] }) {
  const [chunkIndex, setChunkIndex] = createSignal(0);
  const stableMessages = streamingMarkdownMessages(0);
  const streamingMessage = stableMessages[1];
  if (streamingMessage) {
    Object.defineProperties(streamingMessage, {
      body: { configurable: true, enumerable: true, get: () => streamingMarkdownChunks[chunkIndex()] },
      streaming: {
        configurable: true,
        enumerable: true,
        get: () => chunkIndex() < streamingMarkdownChunks.length - 1,
      },
    });
  }
  let interval: number | undefined;
  const start = window.setTimeout(() => {
    interval = window.setInterval(() => {
      setChunkIndex((current) => {
        if (current < streamingMarkdownChunks.length - 1) return current + 1;
        if (interval) window.clearInterval(interval);
        return current;
      });
    }, 180);
  }, 450);
  onCleanup(() => {
    window.clearTimeout(start);
    if (interval) window.clearInterval(interval);
  });

  return <MockedConversation args={{ ...props.args, activeTurnId: "streaming-markdown" }} messages={stableMessages} />;
}

const comparisonTableMessages: RendererAgentMessage[] = [
  {
    id: "comparison-table-user",
    author: "you",
    body: "Compare the Personal and Enterprise plans feature by feature.",
    time: "10:02",
    kind: "text",
  },
  {
    id: "comparison-table-agent",
    author: "agent",
    body: [
      "Here’s the feature breakdown:",
      "",
      "| Feature | Personal | Enterprise |",
      "| --- | --- | --- |",
      "| Unlimited projects | ✓ | ✓ |",
      "| All components | ✓ | ✓ |",
      "| Team-wide usage | — | ✓ |",
      "| Priority support | — | ✓ |",
    ].join("\n"),
    time: "10:03",
    kind: "text",
  },
];

const prompt: Extract<AgentEvent, { type: "prompt" }> = {
  type: "prompt",
  requestId: "prompt-1",
  agentId: "chief",
  threadId: "thread-chief",
  turnId: "turn-prompt",
  questions: [
    {
      id: "scope",
      header: "Scope",
      question: "What should the next update focus on?",
      isSecret: false,
      options: [
        { label: "Launch", description: "Focus on launch readiness." },
        { label: "Research", description: "Focus on source quality." },
      ],
    },
  ],
};

const browserTakeover: Extract<AgentEvent, { type: "browser-takeover-requested" }>["request"] = {
  requestId: "takeover-1",
  agentId: "chief",
  threadId: "thread-chief",
  turnId: "turn-takeover",
  tabId: "tab-login",
};

const promptQuestions: Extract<AgentEvent, { type: "prompt" }> = {
  type: "prompt",
  requestId: "prompt-questions",
  agentId: "chief",
  threadId: "thread-chief",
  turnId: "turn-prompt-questions",
  questions: [
    {
      id: "approach",
      header: "Approach",
      question: "Which auth approach should we use?",
      isSecret: false,
      options: [
        { label: "Session cookies", description: "" },
        { label: "JWT bearer", description: "" },
        { label: "OAuth only", description: "" },
      ],
    },
    {
      id: "secrets",
      header: "Secrets",
      question: "Where should secrets live?",
      isSecret: false,
      options: [
        { label: ".env.local", description: "" },
        { label: "Vault / secrets manager", description: "" },
        { label: "CI only", description: "" },
      ],
    },
    {
      id: "rollout",
      header: "Rollout",
      question: "Ship behind a feature flag?",
      isSecret: false,
      options: [
        { label: "Yes — gradual rollout", description: "" },
        { label: "No — full release", description: "" },
      ],
    },
  ],
};

const promptChatMessages: RendererAgentMessage[] = [
  {
    id: "prompt-chat-user",
    author: "you",
    body: "Help me choose the safest auth setup for the launch.",
    time: "10:00",
    kind: "text",
  },
  {
    id: "prompt-chat-agent",
    author: "agent",
    body: "I have a few decisions to confirm before I finish the setup.",
    time: "10:01",
    kind: "text",
  },
];

type QueueDeliveryFixture = QueueSnapshot["deliveries"][number];

const queuedDelivery: QueueDeliveryFixture = {
  id: "queued-1",
  messageId: "queued-message-1",
  recipientAgentId: "chief",
  sender: { kind: "user" },
  text: "Add a final checklist.",
  attachments: [],
  replyToMessageId: null,
  status: "queued",
  position: 1,
  turnId: null,
  error: null,
  createdAt: "2026-08-19T10:00:00.000Z",
};

/**
 * The panel shows what waits behind the work that runs now, so `presentQueueDeliveries` returns
 * nothing for a queue with no running delivery. Every queue fixture carries this one.
 */
const runningDelivery: QueueDeliveryFixture = {
  ...queuedDelivery,
  id: "queued-running",
  messageId: "queued-message-running",
  text: "Draft the rollout notes.",
  status: "running",
  position: 0,
  turnId: "turn-active",
  createdAt: "2026-08-19T09:59:00.000Z",
};

const queue: QueueSnapshot = {
  agentId: "chief",
  deliveries: [queuedDelivery, runningDelivery],
};

function queueWithItems(count: number, text = "Add the final checklist and verify the rollout notes"): QueueSnapshot {
  return {
    ...queue,
    deliveries: [
      ...Array.from({ length: count }, (_, index) => ({
        ...queuedDelivery,
        id: `queued-${index + 1}`,
        messageId: `queued-message-${index + 1}`,
        text: index === 0 ? text : `${text} — item ${index + 1}`,
        position: index + 1,
        createdAt: `2026-08-19T10:0${index}:00.000Z`,
      })),
      runningDelivery,
    ],
  };
}

const queueReferenceMessages = [
  "Improve how right-clicking an agent works in the sidebar. It should match the app…",
  "The inputs are still not right. Check exactly how they work in the application…",
  "Add Command+F to chat, and keep message reordering consistent…",
  "Add one search modal for messages and agents…",
  "The latest chat message is too low. Move it up so it stays visible…",
  "Run all checks and fix every failure",
  "Push the final changes to main",
] as const;

const referenceQueue: QueueSnapshot = {
  ...queue,
  deliveries: [
    ...queueWithItems(queueReferenceMessages.length)
      .deliveries.filter((delivery) => delivery.status === "queued")
      .map((delivery, index) => {
        const text = queueReferenceMessages[index];
        if (text === undefined) throw new Error(`Queue reference message ${index} is missing.`);
        return {
          ...delivery,
          text,
          attachments: index === 2 ? [queuePrimaryAttachment] : index === 3 ? [queueAlternateAttachment] : [],
        };
      }),
    runningDelivery,
  ],
};

const LIVE_DICTATION =
  "Can you check the release notes for 2.18 and tell me which fixes still need a changelog entry before Friday?";

/**
 * Live dictation as the app shows it: a partial pass about once a second, a few words longer each
 * time, then the final pass (darker text) and the transcript in the draft. The animated story loops.
 */
function playLiveDictation(
  controller: ReturnType<typeof createConversationController>,
  target: { agentId: string; serverId: string },
  options: { draft: string; animate: boolean },
): () => void {
  const setDraft = (text: string) =>
    controller.setDrafts({ [target.agentId]: { text, attachments: [], replyToMessageId: null } });
  setDraft(options.draft);
  controller.setVoicePhase("recording");
  if (!options.animate) {
    controller.setVoiceElapsedSeconds(7);
    controller.setVoiceLiveTranscript({ ...target, text: LIVE_DICTATION });
    return () => undefined;
  }
  const words = LIVE_DICTATION.split(" ");
  const recordingTicks = Math.ceil(words.length / 3);
  let tick = 0;
  const timer = window.setInterval(() => {
    tick = tick >= recordingTicks + 3 ? 0 : tick + 1;
    if (tick === 0) {
      setDraft(options.draft);
      controller.setVoiceLiveTranscript(null);
      controller.setVoicePhase("recording");
    } else if (tick <= recordingTicks) {
      controller.setVoiceLiveTranscript({ ...target, text: words.slice(0, tick * 3).join(" ") });
    } else if (tick === recordingTicks + 1) {
      controller.setVoicePhase("transcribing");
    } else if (tick === recordingTicks + 2) {
      controller.setVoiceLiveTranscript(null);
      controller.setVoicePhase("idle");
      setDraft(options.draft ? `${options.draft} ${LIVE_DICTATION}` : LIVE_DICTATION);
    }
    controller.setVoiceElapsedSeconds(Math.min(tick, recordingTicks));
  }, 1_000);
  return () => window.clearInterval(timer);
}

function MockedConversation(props: {
  args: Parameters<typeof Conversation>[0];
  messages?: RendererAgentMessage[];
  initialAttachments?: DraftAttachment[];
  voiceModelProgress?: number;
  voiceLive?: { draft: string; animate: boolean };
  voicePhase?: VoicePhase;
  takeoverStateGallery?: boolean;
  conversationError?: string;
}) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot();
  const controller = createConversationController({ onTypingChange: props.args.onTypingChange });
  const previewUrls = new Set<string>();
  let storyFrameElement: HTMLDivElement | undefined;
  let takeoverGalleryScrollTimer: number | undefined;
  const initialAgentId = props.args.agent?.id;
  if (initialAgentId && props.initialAttachments?.length) {
    onSettled(() => {
      controller.setDrafts({
        [initialAgentId]: { text: "", attachments: props.initialAttachments ?? [], replyToMessageId: null },
      });
    });
  }
  if (props.voiceModelProgress !== undefined) {
    onSettled(() => {
      controller.setVoicePhase("preparing");
      controller.setVoiceModelProgress(props.voiceModelProgress ?? null);
    });
  }
  const voiceLive = props.voiceLive;
  if (initialAgentId && voiceLive) {
    onSettled(() =>
      playLiveDictation(controller, { agentId: initialAgentId, serverId: props.args.server?.id ?? "local" }, voiceLive),
    );
  }
  const voicePhase = props.voicePhase;
  if (voicePhase) {
    onSettled(() => {
      controller.setVoicePhase(voicePhase);
    });
  }
  // The same keyed entry `agent-event-bridge` writes when a provider reports an error, so the
  // story shows the banner where the chat it belongs to actually renders it.
  if (initialAgentId && props.conversationError) {
    onSettled(() => {
      controller.setConversationErrors({
        [composerDraftKey({ agentId: initialAgentId, serverId: props.args.server?.id ?? "local" })]:
          props.conversationError ?? "",
      });
    });
  }
  const [unreadCount, setUnreadCount] = createSignal(0);
  const [firstUnreadMessageId, setFirstUnreadMessageId] = createSignal<string | null>(null);
  const [takeoverGalleryMount, setTakeoverGalleryMount] = createSignal<HTMLElement | null>(null);
  createEffect(
    () => [props.args.unreadCount, props.args.firstUnreadMessageId] as const,
    ([count, messageId]) => {
      setUnreadCount(count);
      setFirstUnreadMessageId(messageId);
    },
  );
  window.openbot = mock.api;
  if (props.takeoverStateGallery) {
    onSettled(() => {
      const mount = storyFrameElement?.querySelector<HTMLElement>(".conversation-scroll") ?? null;
      setTakeoverGalleryMount(mount);
      takeoverGalleryScrollTimer = window.setTimeout(() => {
        if (mount) mount.scrollTop = 0;
      }, 200);
    });
  }
  const handlePastedImages = (event: ClipboardEvent) => {
    const files = clipboardFiles(event.clipboardData).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;

    const agentId = props.args.agent?.id;
    if (!agentId) return;
    event.preventDefault();
    const requestId = crypto.randomUUID();
    const currentDraft = controller.drafts()[agentId] ?? { text: "", attachments: [], replyToMessageId: null };
    const attachments: DraftAttachment[] = files
      .slice(0, Math.max(0, 10 - currentDraft.attachments.length))
      .map((file, index) => {
        const previewUrl = URL.createObjectURL(file);
        previewUrls.add(previewUrl);
        return {
          id: `${requestId}-${index}`,
          name: file.name || `pasted-${index + 1}.png`,
          size: file.size,
          kind: "image",
          mimeType: file.type || "image/png",
          previewKind: "image",
          previewUrl,
        };
      });
    controller.setDrafts((current) => ({
      ...current,
      [agentId]: { ...currentDraft, attachments: [...currentDraft.attachments, ...attachments] },
    }));
  };
  const setStoryFrameElement = (element: HTMLDivElement) => {
    storyFrameElement = element;
    element.addEventListener("paste", handlePastedImages, true);
  };
  onCleanup(() => {
    storyFrameElement?.removeEventListener("paste", handlePastedImages, true);
    if (takeoverGalleryScrollTimer !== undefined) window.clearTimeout(takeoverGalleryScrollTimer);
    for (const previewUrl of previewUrls) URL.revokeObjectURL(previewUrl);
    mock.dispose();
    window.openbot = previousApi;
  });
  return (
    <div ref={setStoryFrameElement} class="conversation-story-frame">
      <StoryAppProviders>
        <ConversationControllerProvider controller={controller}>
          <ConversationView
            {...props.args}
            messages={props.messages ?? props.args.messages}
            unreadCount={unreadCount()}
            firstUnreadMessageId={firstUnreadMessageId()}
            onMarkRead={async () => {
              await props.args.onMarkRead();
              setUnreadCount(0);
              setFirstUnreadMessageId(null);
            }}
          />
        </ConversationControllerProvider>
      </StoryAppProviders>
      <Show when={props.takeoverStateGallery && takeoverGalleryMount()}>
        <Portal mount={takeoverGalleryMount() ?? undefined}>
          <div class="browser-takeover-story-states">
            <BrowserTakeoverCard
              agentName={props.args.agent?.name ?? "the agent"}
              tab={props.args.browserTabs[0]}
              preview={{ dataUrl: browserTakeoverPreviewUrl, width: 960, height: 600 }}
              previewStatus="ready"
              decision="complete"
              onComplete={async () => false}
              onCancel={async () => false}
            />
            <BrowserTakeoverCard
              agentName={props.args.agent?.name ?? "the agent"}
              tab={props.args.browserTabs[0]}
              preview={{ dataUrl: browserTakeoverPreviewUrl, width: 960, height: 600 }}
              previewStatus="ready"
              decision="cancel"
              onComplete={async () => false}
              onCancel={async () => false}
            />
          </div>
        </Portal>
      </Show>
    </div>
  );
}

function RecordingConversation(props: { args: Parameters<typeof Conversation>[0] }) {
  const previousMediaDevices = navigator.mediaDevices;
  const previousMediaRecorder = window.MediaRecorder;
  class StoryMediaRecorder extends EventTarget {
    readonly mimeType = "audio/webm";
    state: RecordingState = "inactive";

    start(): void {
      this.state = "recording";
    }

    stop(): void {
      this.state = "inactive";
    }
  }
  Object.defineProperty(window, "MediaRecorder", { configurable: true, value: StoryMediaRecorder });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] }) },
  });
  onCleanup(() => {
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: previousMediaRecorder });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: previousMediaDevices });
  });
  return <MockedConversation args={props.args} />;
}

const meta = {
  title: "Conversation/Conversation",
  component: Conversation,
  args,
  parameters: { layout: "fullscreen" },
  render: (storyArgs) => <MockedConversation args={storyArgs} />,
} satisfies Meta<typeof Conversation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RichConversation: Story = {};

/** The real composer with a signed-out provider: the notice takes the queue's place above the input. */
export const ProviderSignInRequired: Story = {
  name: "Provider sign in required",
  args: {
    agentStatus: {
      ...STORY_AGENT_STATUS,
      providers: STORY_AGENT_STATUS.providers?.map((provider) =>
        provider.id === "codex" ? { ...provider, state: "sign-in-required" as const, email: null } : provider,
      ),
    },
    onSignInProvider: fn(),
  },
};

/** The real composer with the plan window spent: the card states the reset and offers no button. */
export const UsageLimitReached: Story = {
  name: "Usage limit reached",
  args: {
    accountUsage: {
      limits: [
        {
          id: "codex-primary",
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: Date.UTC(2026, 8, 21, 9, 0) / 1_000 },
          secondary: { usedPercent: 62, windowDurationMins: 10_080, resetsAt: Date.UTC(2026, 8, 26, 9, 0) / 1_000 },
        },
      ],
    },
  },
};

/**
 * The real composer after a provider reported an error. The report stands above the input, in the
 * same column as the usage-limit and sign-in notices, rather than as a bubble in the transcript:
 * a provider that retries a dropped transport reports the same failure once per attempt, and one
 * banner stands for the whole run. One press clears it.
 */
export const ProviderErrorBanner: Story = {
  name: "Provider error banner",
  render: (storyArgs) => (
    <MockedConversation
      args={storyArgs}
      conversationError="Falling back from WebSockets to HTTPS transport. stream disconnected before completion: Connection refused (os error 61)"
    />
  ),
};

export const AllAgentMessageTypes: Story = {
  name: "All agent message types",
  args: {
    messages: agentMessageGalleryMessages,
    activeTurnId: "agent-gallery-stream",
    presence: completedImageGenerationPresence,
  },
};

export const VoiceRecording: Story = {
  name: "Voice recording",
  render: (storyArgs) => <RecordingConversation args={storyArgs} />,
};

export const VoiceLiveTranscription: Story = {
  name: "Voice live transcription",
  render: (storyArgs) => <MockedConversation args={storyArgs} voiceLive={{ draft: "", animate: true }} />,
};

export const VoiceLiveTranscriptionAfterDraft: Story = {
  name: "Voice live transcription after a draft",
  render: (storyArgs) => (
    <MockedConversation args={storyArgs} voiceLive={{ draft: "Quick question about the release.", animate: false }} />
  ),
};

export const VoiceRequestingMicrophone: Story = {
  name: "Voice requesting microphone",
  render: (storyArgs) => <MockedConversation args={storyArgs} voicePhase="requesting" />,
};

/** After Stop: the last live text shows in full colour until the final pass replaces the draft. */
export const VoiceTranscribing: Story = {
  name: "Voice transcribing",
  render: (storyArgs) => (
    <MockedConversation args={storyArgs} voiceLive={{ draft: "", animate: false }} voicePhase="transcribing" />
  ),
};

export const VoiceWhileAgentStarts: Story = {
  name: "Voice while the agent starts",
  args: { agentStatus: { ...STORY_AGENT_STATUS, phase: "starting" } },
};

export const VoiceMicrophoneBlocked: Story = {
  name: "Voice microphone blocked",
  render: (storyArgs) => (
    <MockedConversation args={storyArgs} conversationError={currentText().t("composer.voice.blocked")} />
  ),
};

export const VoiceModelDownload: Story = {
  name: "Voice model download",
  render: (storyArgs) => <MockedConversation args={storyArgs} voiceModelProgress={47} />,
};

export const PastedImageInComposer: Story = {
  name: "Pasted image in composer",
  render: (storyArgs) => <MockedConversation args={storyArgs} initialAttachments={queuePreviewAttachments} />,
};

export const MixedAttachmentsInNarrowComposer: Story = {
  name: "Mixed attachments in narrow composer",
  render: (storyArgs) => (
    <section style={{ width: "360px", height: "820px", overflow: "hidden" }}>
      <MockedConversation args={storyArgs} initialAttachments={[...queuePreviewAttachments, storyAttachment]} />
    </section>
  ),
};

export const SupportedContextFilesInComposer: Story = {
  name: "Supported context files in composer",
  render: (storyArgs) => <MockedConversation args={storyArgs} initialAttachments={supportedContextAttachments} />,
};

export const SentMessageWithContextFiles: Story = {
  name: "Sent message with context files",
  render: (storyArgs) => <MockedConversation args={storyArgs} messages={sentContextFileMessages} />,
};

export const NarrowRichConversation: Story = {
  name: "Narrow rich conversation",
  render: (storyArgs) => (
    <section style={{ width: "360px", height: "820px", overflow: "hidden" }}>
      <MockedConversation args={storyArgs} />
    </section>
  ),
};

export const UnreadMessages: Story = {
  args: {
    messages: unreadStoryMessages,
    unreadCount: 8,
    firstUnreadMessageId: "unread-story-new-1",
  },
};

export const ScrollToLatest: Story = {
  args: {
    messages: unreadStoryMessages,
    unreadCount: 0,
    firstUnreadMessageId: null,
  },
};

/** Five days of history, 120 messages: scroll to bring in the day rail on the right edge. */
export const LongHistory: Story = {
  args: {
    messages: Array.from({ length: 120 }, (_, index): RendererAgentMessage => {
      const createdAt = new Date(2026, 8, 1 + Math.floor(index / 24), 9, (index % 24) * 2);
      return {
        id: `long-history-${index + 1}`,
        author: index % 3 === 0 ? "you" : "agent",
        body:
          index % 3 === 0
            ? `Can you check step ${index + 1} of the release plan?`
            : `I checked step ${index + 1}. The owner, the date and the open risk are in the plan now.`,
        time: `${String(createdAt.getHours()).padStart(2, "0")}:${String(createdAt.getMinutes()).padStart(2, "0")}`,
        createdAt: createdAt.toISOString(),
        kind: "text",
      };
    }),
    unreadCount: 0,
    firstUnreadMessageId: null,
  },
};

/** One agent chat on a team: two other people write, their runs group, and a reply quotes one. */
export const SeveralPeople: Story = {
  name: "Several people",
  args: {
    messages: [
      {
        id: "people-own",
        author: "you",
        body: "Can we ship the launch notes today?",
        time: "10:00",
        createdAt: "2026-08-20T10:00:00.000Z",
        senderMember: { id: "member-self", name: "Norbert" },
      },
      {
        id: "people-alice-1",
        author: "you",
        body: "I still need the pricing section.",
        time: "10:01",
        createdAt: "2026-08-20T10:01:00.000Z",
        senderMember: { id: "member-alice", name: "Alice Chen" },
      },
      {
        id: "people-alice-2",
        author: "you",
        body: "Also the screenshots.",
        time: "10:01",
        createdAt: "2026-08-20T10:01:30.000Z",
        senderMember: { id: "member-alice", name: "Alice Chen" },
      },
      {
        id: "people-left",
        author: "you",
        body: "A person who left the team keeps the name the host stored.",
        time: "10:02",
        createdAt: "2026-08-20T10:02:00.000Z",
        senderMember: {
          id: "member-former",
          name: "Maximiliana Konstantinopoulou-Wolfeschlegelsteinhausenberger",
        },
      },
      {
        id: "people-agent",
        author: "agent",
        body: "I will draft the pricing section and add the screenshots.",
        time: "10:03",
        createdAt: "2026-08-20T10:03:00.000Z",
        replyToMessageId: "people-alice-1",
      },
    ],
  },
};

export const CitationsInChat: Story = {
  name: "Citations in chat",
};

export const ImageGenerationInChat: Story = {
  name: "Image generation in chat",
  args: {
    messages: imageGenerationMessages,
    activeTurnId: "turn-image-generation",
  },
};

export const ImageGenerationCompletedInChat: Story = {
  name: "Image generation completed in chat",
  args: {
    messages: completedImageGenerationMessages,
    activeTurnId: "turn-image-generation",
    presence: completedImageGenerationPresence,
  },
};

export const DataTableInChat: Story = {
  name: "Data table in chat",
  args: {
    messages: dataTableMessages,
  },
};

export const CodeBlockInChat: Story = {
  name: "Code block in chat",
  args: {
    messages: codeBlockMessages,
  },
};

export const DiagramsInChat: Story = {
  name: "Diagrams in chat",
  args: {
    messages: diagramMessages,
  },
};

export const MarkdownImagesInChat: Story = {
  name: "Markdown images in chat",
  args: {
    messages: markdownImageMessages,
  },
};

export const MarkdownInChat: Story = {
  name: "Markdown in chat",
  args: {
    messages: markdownMessages,
  },
};

export const StreamingMarkdownInChat: Story = {
  name: "Streaming Markdown in chat",
  args: {
    messages: streamingMarkdownMessages(0),
    activeTurnId: "streaming-markdown",
  },
  render: (storyArgs) => <StreamingMarkdownConversation args={storyArgs} />,
};

export const ComparisonTableInChat: Story = {
  name: "Comparison table in chat",
  args: {
    messages: comparisonTableMessages,
  },
};

export const ImageGenerationUnavailableWithClaude: Story = {
  name: "Image generation unavailable with Claude",
  args: {
    agent: { ...STORY_AGENTS[0], model: "claude-sonnet-5" },
    messages: [],
  },
};

export const Thinking: Story = {
  args: {
    activeTurnId: "turn-thinking",
    messages: [
      ...messages,
      {
        id: "thinking-1",
        author: "agent",
        body: "",
        time: "10:01",
        kind: "thinking",
        items: ["Read the project brief", "Compared the milestone owners", "Drafting the next action"],
        streaming: true,
      },
    ],
  },
};

export const ThinkingSettled: Story = {
  args: {
    messages: [
      ...messages,
      {
        id: "thinking-2",
        author: "agent",
        body: "",
        time: "10:01",
        kind: "thinking",
        items: ["Read the project brief", "Compared the milestone owners", "Drafted the next action"],
      },
    ],
  },
};

export const Prompt: Story = {
  args: { prompt },
};

export const BrowserTakeover: Story = {
  name: "Browser authorization takeover",
  args: {
    browserTakeover,
    browserTabs: [
      {
        id: "tab-login",
        title: "Sign in",
        url: "https://example.com/login",
        loading: false,
        ownerThreadId: "thread-chief",
        ownerAgentId: "chief",
      },
    ],
    activeBrowserTabId: "tab-login",
    activeTurnId: "turn-takeover",
    messages: [],
  },
  render: (storyArgs) => <MockedConversation args={storyArgs} takeoverStateGallery />,
};

export const PromptQuestionsInChat: Story = {
  name: "Prompt questions in chat",
  args: {
    messages: promptChatMessages,
    prompt: promptQuestions,
  },
};

export const Queued: Story = {
  args: { queue },
};

/**
 * Chief asked Research and Sales. Research answered while Chief worked, so its answer waits above
 * the composer with the question, not in the queue panel. The person's own message stays queued.
 */
export const WaitingForReplies: Story = {
  args: {
    queue: { agentId: "chief", deliveries: [...(STORY_QUEUES.chief ?? []), queuedDelivery, runningDelivery] },
    activeTurnId: "turn-active",
  },
};

/** The plan of the turn that runs: the block is open and the running step shimmers. */
export const PlanInProgress: Story = {
  args: {
    activeTurnId: "turn-plan-live",
    messages: [
      ...messages.filter((message) => message.kind !== "plan"),
      {
        id: "turn-plan-live:plan",
        author: "agent",
        body: "",
        time: "10:05",
        turnId: "turn-plan-live",
        itemType: "plan",
        status: "streaming",
        streaming: true,
        kind: "plan",
        plan: {
          explanation: null,
          stopped: false,
          steps: [
            { id: "0", text: "Read the migration notes", status: "completed" },
            {
              id: "1",
              text: "Add the column for the saved provider",
              activeText: "Adding the column for the saved provider",
              status: "inProgress",
            },
            { id: "2", text: "Run the migration tests", status: "pending" },
          ],
        },
      },
    ],
  },
};

export const ThreeQueuedMessages: Story = {
  args: { queue: queueWithItems(3), activeTurnId: "turn-active" },
};

/** Messages sent to steer that wait in the queue instead, each with the reason on its row. */
export const QueuedAfterSteerFallback: Story = {
  args: {
    activeTurnId: "turn-active",
    queue: {
      ...queue,
      deliveries: [
        { ...queuedDelivery, text: "Use the staging database, not production.", steerFallback: "provider-unsupported" },
        {
          ...queuedDelivery,
          id: "queued-2",
          messageId: "queued-message-2",
          text: "Skip the flaky browser tests.",
          position: 2,
          createdAt: "2026-08-19T10:01:00.000Z",
          steerFallback: "steer-failed",
        },
        runningDelivery,
      ],
    },
  },
};

export const SevenQueuedMessages: Story = {
  args: {
    queue: referenceQueue,
    activeTurnId: "turn-active",
  },
  render: (storyArgs) => {
    const [queueState, setQueueState] = createSignal<QueueSnapshot>(storyArgs.queue ?? referenceQueue);
    let nextStoryDeliveryId = 1;
    const normalizePositions = (deliveries: QueueSnapshot["deliveries"]) =>
      deliveries.map((delivery, index) => ({ ...delivery, position: index + 1 }));
    const reorderQueue = (deliveryIds: string[]) => {
      storyArgs.onReorderQueue(deliveryIds);
      setQueueState((current) => {
        const deliveriesById = new Map(current.deliveries.map((delivery) => [delivery.id, delivery]));
        const reordered = deliveryIds.flatMap((id) => {
          const delivery = deliveriesById.get(id);
          return delivery ? [delivery] : [];
        });
        let queuedIndex = 0;
        return {
          ...current,
          deliveries: current.deliveries.map((delivery) => {
            if (delivery.status !== "queued") return delivery;
            const next = reordered[queuedIndex++];
            return next ? { ...next, position: delivery.position } : delivery;
          }),
        };
      });
    };
    const cancelQueuedMessage = (deliveryId: string) => {
      storyArgs.onCancelQueuedMessage(deliveryId);
      setQueueState((current) => ({
        ...current,
        deliveries: normalizePositions(current.deliveries.filter((delivery) => delivery.id !== deliveryId)),
      }));
    };
    const updateQueuedMessage = async (
      deliveryId: string,
      text: string,
      keepAttachmentIds: string[],
      attachmentDraftIds: string[],
    ) => {
      const saved = await storyArgs.onUpdateQueuedMessage(deliveryId, text, keepAttachmentIds, attachmentDraftIds);
      if (!saved) return false;
      setQueueState((current) => ({
        ...current,
        deliveries: current.deliveries.map((delivery) =>
          delivery.id === deliveryId
            ? {
                ...delivery,
                text,
                attachments: delivery.attachments.filter((attachment) => keepAttachmentIds.includes(attachment.id)),
              }
            : delivery,
        ),
      }));
      return true;
    };
    const sendMessage = async (body: string, attachmentDraftIds: string[], replyToMessageId: string | null) => {
      const sent = await storyArgs.onSendMessage(body, attachmentDraftIds, replyToMessageId);
      if ("error" in sent || !storyArgs.activeTurnId) return sent;
      const id = `storybook-queued-${nextStoryDeliveryId++}`;
      setQueueState((current) => ({
        ...current,
        deliveries: [
          ...current.deliveries,
          {
            id,
            messageId: `${id}-message`,
            recipientAgentId: current.agentId,
            sender: { kind: "user" },
            text: body,
            attachments: [],
            replyToMessageId,
            status: "queued",
            position: current.deliveries.filter((delivery) => delivery.status === "queued").length + 1,
            turnId: null,
            error: null,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
      return { messageId: id };
    };

    return (
      <MockedConversation
        args={{
          ...storyArgs,
          queue: queueState(),
          onSendMessage: sendMessage,
          onCancelQueuedMessage: cancelQueuedMessage,
          onUpdateQueuedMessage: updateQueuedMessage,
          onReorderQueue: reorderQueue,
        }}
      />
    );
  },
};

export const QueueWithItems: Story = {
  args: { queue: queueWithItems(3) },
};

export const EditingQueuedMessage: Story = {
  args: {
    queue: {
      ...queue,
      deliveries: [{ ...queuedDelivery, attachments: STORY_ATTACHMENTS }, runningDelivery],
    },
    activeTurnId: "turn-active",
  },
};

export const Empty: Story = {
  args: { messages: [], loaded: true, queue: undefined },
};

const actionMarkerMessages: RendererAgentMessage[] = [
  {
    id: "spacing-user-1",
    author: "you",
    body: "Check the claims and route the source check to the research agents.",
    time: "22:48",
    kind: "text",
  },
  {
    id: "spacing-agent-1",
    author: "agent",
    body: "Done. One claim still needs a primary source, so I invoked the daily source check.",
    time: "22:48",
    kind: "text",
  },
  {
    id: "spacing-routine-run",
    author: "agent",
    body: "Recheck open launch claims against the tracked sources and report only material changes.",
    time: "22:49",
    kind: "text",
    routine: {
      routineId: "routine-source-check",
      runId: "run-1",
      name: "Daily source check",
      scheduledFor: "2026-08-19T22:49:00.000Z",
    },
    actionMarker: {
      kind: "routine-run",
      sourceAgentId: "chief",
      routineId: "routine-source-check",
      runId: "run-1",
      routineName: "Daily source check",
      status: "queued",
      timestamp: "2026-08-19T22:49:00.000Z",
    },
  },
  {
    id: "spacing-marker-incoming",
    author: "agent",
    body: "",
    time: "22:49",
    kind: "exchange",
    attachments: [storyAttachment],
    exchange: {
      direction: "incoming",
      messageId: "spacing-marker-incoming",
      senderAgentId: "chief",
      recipientAgentIds: ["research"],
      replyToMessageId: null,
      deliveries: [],
    },
    actionMarker: {
      kind: "agent-message",
      direction: "incoming",
      sourceAgentId: "chief",
      targetDeliveries: [{ agentId: "research", status: "completed" }],
      status: "completed",
      timestamp: "2026-08-19T22:49:00.000Z",
      messageId: "spacing-marker-incoming",
      replyToMessageId: null,
      expectsReply: true,
    },
  },
  {
    id: "spacing-marker-outgoing",
    author: "agent",
    body: "",
    time: "22:49",
    kind: "exchange",
    exchange: {
      direction: "outgoing",
      messageId: "spacing-marker-outgoing",
      senderAgentId: "chief",
      recipientAgentIds: ["research", "sales"],
      replyToMessageId: null,
      deliveries: [],
    },
    actionMarker: {
      kind: "agent-message",
      direction: "outgoing",
      sourceAgentId: "chief",
      targetDeliveries: [
        { agentId: "research", status: "completed" },
        { agentId: "sales", status: "running" },
      ],
      status: "in-progress",
      timestamp: "2026-08-19T22:49:00.000Z",
      messageId: "spacing-marker-outgoing",
      replyToMessageId: null,
      expectsReply: true,
    },
  },
  {
    id: "spacing-marker-lifecycle",
    author: "agent",
    body: "",
    time: "22:50",
    kind: "action-marker",
    actionMarker: {
      kind: "routine-lifecycle",
      action: "created",
      sourceAgentId: "chief",
      routineId: "routine-source-check",
      routineName: "Daily source check",
      status: "completed",
      timestamp: "2026-08-19T22:50:00.000Z",
    },
  },
  {
    id: "spacing-marker-site",
    author: "agent",
    body: "",
    time: "22:50",
    kind: "action-marker",
    actionMarker: {
      kind: "hosted-site",
      sourceAgentId: "chief",
      action: "publish",
      status: "succeeded",
      operationId: "op-1",
      siteId: "site-1",
      title: "Launch status page",
      hostname: "launch-status-23456789ab.openbot.site",
      url: "https://launch-status-23456789ab.openbot.site",
      timestamp: "2026-08-19T22:50:00.000Z",
    },
  },
  {
    id: "spacing-marker-unavailable",
    author: "agent",
    body: "",
    time: "22:50",
    kind: "action-marker",
    actionMarker: {
      kind: "unavailable",
      label: "Action unavailable",
      timestamp: "2026-08-19T22:50:00.000Z",
    },
  },
  {
    id: "spacing-agent-error",
    author: "agent",
    body: "I could not reach the tracked source index.",
    time: "22:50",
    kind: "text",
    status: "Failed",
  },
  {
    id: "spacing-agent-stream",
    author: "agent",
    body: "Publishing the summary now, then I will report the remaining open claim.",
    time: "22:51",
    kind: "text",
    streaming: true,
  },
];

const actionMarkerArgs = {
  messages: actionMarkerMessages,
  availableRoutineIds: ["routine-source-check"],
} satisfies Partial<Parameters<typeof Conversation>[0]>;

export const ActionMarkerSpacing: Story = {
  name: "Action marker spacing",
  args: actionMarkerArgs,
};

/* The history opens and closes inside a real timeline, where the messages under
   the marker move with it. The isolated marker story cannot show that. */
export const ActionMarkerHistory: Story = {
  name: "Action marker history",
  args: {
    ...actionMarkerArgs,
    messages: actionMarkerMessages.map((message) =>
      message.id === "spacing-routine-run" && message.actionMarker?.kind === "routine-run"
        ? {
            ...message,
            actionMarker: {
              ...message.actionMarker,
              status: "succeeded",
              previousTransitions: [
                { status: "queued", timestamp: "2026-08-19T22:49:00.000Z" },
                { status: "running", timestamp: "2026-08-19T22:50:00.000Z" },
                { status: "needs-attention", timestamp: "2026-08-19T22:51:00.000Z" },
                { status: "running", timestamp: "2026-08-19T22:52:00.000Z" },
              ],
            },
          }
        : message,
    ),
  },
};

export const NarrowActionMarkerSpacing: Story = {
  name: "Narrow action marker spacing",
  args: actionMarkerArgs,
  render: (storyArgs) => (
    <section style={{ width: "320px", height: "820px", overflow: "hidden" }}>
      <MockedConversation args={storyArgs} />
    </section>
  ),
};

function agentExchangeMessage(
  id: string,
  direction: "incoming" | "outgoing",
  otherAgentId: string,
  time: string,
  expectsReply = true,
): RendererAgentMessage {
  const timestamp = `2026-08-19T${time}:00.000Z`;
  const sourceAgentId = direction === "outgoing" ? "chief" : otherAgentId;
  const targetAgentId = direction === "outgoing" ? otherAgentId : "chief";
  return {
    id,
    author: "agent",
    body: "",
    time,
    createdAt: timestamp,
    kind: "exchange",
    exchange: {
      direction,
      messageId: id,
      senderAgentId: sourceAgentId,
      recipientAgentIds: [targetAgentId],
      replyToMessageId: null,
      deliveries: [],
    },
    actionMarker: {
      kind: "agent-message",
      direction,
      sourceAgentId,
      targetDeliveries: [{ agentId: targetAgentId, status: "completed" }],
      status: "completed",
      timestamp,
      messageId: id,
      replyToMessageId: null,
      expectsReply,
    },
  };
}

/* Consecutive messages with other agents show as one row in the chat. */
export const AgentMessageGroupInChat: Story = {
  name: "Agent message group in chat",
  args: {
    messages: [
      {
        id: "group-user",
        author: "you",
        body: "Ask research and sales where the launch stands, then summarize.",
        time: "09:00",
        createdAt: "2026-08-19T09:00:00.000Z",
        kind: "text",
      },
      agentExchangeMessage("group-1", "outgoing", "research", "09:01"),
      agentExchangeMessage("group-2", "outgoing", "sales", "09:01"),
      agentExchangeMessage("group-3", "incoming", "research", "09:03"),
      agentExchangeMessage("group-4", "incoming", "sales", "09:04"),
      agentExchangeMessage("group-5", "outgoing", "research", "09:05", false),
      {
        id: "group-agent",
        author: "agent",
        body: "Research has two sources left to confirm. Sales has 14 accounts ready for the launch email.",
        time: "09:06",
        createdAt: "2026-08-19T09:06:00.000Z",
        kind: "text",
      },
    ],
  },
};

/** One routine run as the host stores it: a "running" marker, then the final state a minute later. */
function routineRunMessages(
  hour: number,
  minute: number,
  status: RoutineRunMarkerModel["status"] = "succeeded",
): RendererAgentMessage[] {
  const runId = `watch-${hour}-${minute}`;
  return (["running", status] as const).map((markerStatus, offset) => {
    const timestamp = new Date(Date.UTC(2026, 7, 19, hour, minute + offset)).toISOString();
    return {
      id: `${runId}-${markerStatus}`,
      author: "agent",
      body: "Watchdog",
      time: timestamp.slice(11, 16),
      createdAt: timestamp,
      kind: "action-marker",
      actionMarker: {
        kind: "routine-run",
        sourceAgentId: null,
        routineId: "routine-watch",
        runId,
        routineName: "Watchdog",
        status: markerStatus,
        timestamp,
      },
    };
  });
}

/* Consecutive completed runs of one routine show as one row. A failed run keeps its own row. */
export const RoutineRunGroupInChat: Story = {
  name: "Routine run group in chat",
  args: {
    messages: [
      {
        id: "watch-user",
        author: "you",
        body: "Check the site every 15 minutes and tell me only when something breaks.",
        time: "17:00",
        createdAt: "2026-08-19T17:00:00.000Z",
        kind: "text",
      },
      ...routineRunMessages(17, 15),
      ...routineRunMessages(17, 30),
      ...routineRunMessages(17, 45),
      ...routineRunMessages(18, 0),
      ...routineRunMessages(18, 15, "failed"),
      ...routineRunMessages(18, 30),
      ...routineRunMessages(18, 45),
    ],
  },
};
