import { createEffect, createSignal, For, Show } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Bubble, BubbleContent } from "../src/components/ui";
import type { AgentMessage } from "../src/data";
import FilePreviewPanel from "../src/features/conversation/FilePreviewPanel";
import { MessageBody } from "../src/features/conversation/MessageRendering";
import { filePreviewForPath, WORKSPACE_FILE_PREVIEWS } from "./file-previews";
import { STORY_AGENTS } from "./fixtures";

// The chat opens the file preview as a conversation does: a file link in the text of a
// message calls `onOpenWorkspaceFile`, and the panel shows the file on the right side.
// An attachment card is a different flow: it opens the media lightbox, not this panel.
const WORKSPACE = "/Users/test/OpenBot/Agents/agent-4f2c";

const MESSAGES: AgentMessage[] = [
  {
    id: "file-preview-chat-1",
    author: "you",
    body: "Show me what you changed for the release.",
    time: "10:02",
  },
  {
    id: "file-preview-chat-2",
    author: "agent",
    body: [
      "The release notes are ready:",
      "",
      `- [RELEASE-NOTES.md](${WORKSPACE}/RELEASE-NOTES.md)`,
      "",
      "Click the file to read it in the preview panel.",
    ].join("\n"),
    time: "10:03",
    status: "Ready to review",
  },
  {
    id: "file-preview-chat-3",
    author: "you",
    body: "Why did the first run fail?",
    time: "10:05",
  },
  {
    id: "file-preview-chat-4",
    author: "agent",
    body: [
      "The Codex binary was missing. The log keeps the three retries:",
      "",
      `- [provider-session.log](${WORKSPACE}/provider-session.log)`,
      `- [current-agent-keys.ts](${WORKSPACE}/current-agent-keys.ts)`,
      `- [evidence-map.json](${WORKSPACE}/evidence-map.json)`,
    ].join("\n"),
    time: "10:06",
  },
  {
    id: "file-preview-chat-5",
    author: "you",
    body: "Good. Send me the diagram and the invoice too.",
    time: "10:08",
  },
  {
    id: "file-preview-chat-6",
    author: "agent",
    body: [
      "Here they are:",
      "",
      `- [trust-boundary.svg](${WORKSPACE}/trust-boundary.svg)`,
      `- [invoice-2026-09.pdf](${WORKSPACE}/invoice-2026-09.pdf)`,
      `- [standup-recap.mp3](${WORKSPACE}/standup-recap.mp3)`,
      `- [operating-plan.xlsx](${WORKSPACE}/operating-plan.xlsx) — the panel cannot show this kind.`,
    ].join("\n"),
    time: "10:09",
    status: "Done",
  },
];

const CONVERSATION_MIN = 320;
const PANEL_MIN = 220;
const PANEL_MAX = 900;
const PANEL_DEFAULT = 480;

function FilePreviewChat(props: {
  openFile?: string;
  onOpenLink: (url: string) => void;
  onOpenExternally: () => void;
  onWidthChange: (width: number) => void;
}) {
  const [openName, setOpenName] = createSignal<string | null>(props.openFile ?? null);
  const [width, setWidth] = createSignal(PANEL_DEFAULT);
  let stage: HTMLDivElement | undefined;
  const stageWidth = () => stage?.clientWidth || window.innerWidth;
  const preview = () => WORKSPACE_FILE_PREVIEWS.find((file) => file.name === openName()) ?? null;
  const openPath = (path: string) => {
    const file = filePreviewForPath(path);
    if (file) setOpenName(file.name);
  };

  createEffect(
    () => props.openFile,
    (name) => {
      setOpenName(name ?? null);
    },
  );

  return (
    <div
      ref={stage}
      class={`conversation-panel${preview() ? " browser-panel-active" : ""}`}
      style={`height: 100vh; --browser-panel-width: ${width()}px`}
    >
      <div style="flex: 1; min-height: 0; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 12px">
        <For each={MESSAGES}>
          {(message) => (
            <Bubble
              align={message.author === "you" ? "end" : "start"}
              variant={message.author === "you" ? "default" : "muted"}
              data-author={message.author === "you" ? "user" : "assistant"}
              style={{ "max-width": "min(560px, 100%)" }}
            >
              <BubbleContent>
                <MessageBody
                  message={message}
                  agents={STORY_AGENTS}
                  onSelectAgent={fn()}
                  onOpenLink={props.onOpenLink}
                  onPreview={fn()}
                  onAttachmentAction={fn()}
                  onOpenSharedFile={openPath}
                  onOpenWorkspaceFile={openPath}
                />
              </BubbleContent>
            </Bubble>
          )}
        </For>
      </div>
      <Show when={preview()}>
        {(file) => (
          <FilePreviewPanel
            preview={file()}
            agents={STORY_AGENTS}
            defaultWidth={() => PANEL_DEFAULT}
            maxWidth={() => Math.min(PANEL_MAX, Math.max(PANEL_MIN, stageWidth() - CONVERSATION_MIN))}
            onWidthChange={(next) => {
              setWidth(next);
              props.onWidthChange(next);
            }}
            onOpenLink={props.onOpenLink}
            onOpenSharedFile={openPath}
            onOpenWorkspaceFile={openPath}
            onOpenExternally={props.onOpenExternally}
            onClose={() => setOpenName(null)}
          />
        )}
      </Show>
    </div>
  );
}

const meta = {
  title: "Conversation/FilePreviewChat",
  component: FilePreviewChat,
  args: {
    onOpenLink: fn(),
    onOpenExternally: fn(),
    onWidthChange: fn(),
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof FilePreviewChat>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A chat with Markdown, CSV, JSON, plain text, SVG, PDF, audio, image, and unsupported files. */
export const Chat: Story = {};

/** The same chat with the markdown file already open, as after a click. */
export const ChatWithOpenFile: Story = {
  name: "Chat (file open)",
  args: { openFile: "RELEASE-NOTES.md" },
};
