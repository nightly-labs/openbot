import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import FilePreviewPanel from "../src/features/conversation/FilePreviewPanel";
import { INLINE_SVG_CHART, publishChatVisualPage } from "./chat-visual-fixtures";
import {
  AUDIO_PREVIEW,
  IMAGE_PREVIEW,
  MARKDOWN_PREVIEW,
  MARKDOWN_SHORT_PREVIEW,
  PDF_PREVIEW,
  SOURCE_PREVIEW,
  TEXT_PREVIEW,
  UNSUPPORTED_PREVIEW,
  XLSX_LITERAL_PREFIXES_PREVIEW,
  XLSX_PREVIEW,
} from "./file-previews";
import { STORY_AGENTS } from "./fixtures";

const CONVERSATION_MIN = 320;
const PANEL_MIN = 220;
const PANEL_MAX = 900;
const PANEL_DEFAULT = 480;

const meta = {
  title: "Conversation/FilePreviewPanel",
  component: FilePreviewPanel,
  args: {
    preview: MARKDOWN_PREVIEW,
    agents: STORY_AGENTS,
    maxWidth: () => PANEL_MAX,
    onWidthChange: fn(),
    onOpenLink: fn(),
    onOpenSharedFile: fn(),
    onOpenWorkspaceFile: fn(),
    onOpenExternally: fn(),
    onClose: fn(),
  },
  render: (args) => {
    const [width, setWidth] = createSignal(PANEL_DEFAULT);
    let stage: HTMLDivElement | undefined;
    const stageWidth = () => stage?.clientWidth || window.innerWidth;
    return (
      <div ref={stage} class="conversation-panel" style={`height: 100vh; --browser-panel-width: ${width()}px`}>
        <FilePreviewPanel
          {...args}
          maxWidth={() => Math.min(PANEL_MAX, Math.max(PANEL_MIN, stageWidth() - CONVERSATION_MIN))}
          onWidthChange={(next) => {
            setWidth(next);
            args.onWidthChange(next);
          }}
        />
      </div>
    );
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof FilePreviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Markdown: Story = {};

export const MarkdownShort: Story = {
  name: "Markdown (short)",
  args: { preview: MARKDOWN_SHORT_PREVIEW },
};

export const Text: Story = {
  args: { preview: TEXT_PREVIEW },
};

export const TextSource: Story = {
  name: "Text (source)",
  args: { preview: SOURCE_PREVIEW },
};

export const Image: Story = {
  args: { preview: IMAGE_PREVIEW },
};

export const Pdf: Story = {
  name: "PDF",
  args: { preview: PDF_PREVIEW },
};

export const Audio: Story = {
  args: { preview: AUDIO_PREVIEW },
};

export const Spreadsheet: Story = {
  args: { preview: XLSX_PREVIEW },
};

export const SpreadsheetLiteralPrefixes: Story = {
  args: { preview: XLSX_LITERAL_PREFIXES_PREVIEW },
};

const HTML_BYTES = new TextEncoder().encode(INLINE_SVG_CHART);

export const HtmlPage: Story = {
  name: "HTML page",
  args: {
    preview: {
      name: "weekly-signups.html",
      size: HTML_BYTES.length,
      mimeType: "text/html",
      previewKind: "text",
      bytes: HTML_BYTES,
    },
  },
  render: (args) => {
    const [pageUrl, setPageUrl] = createSignal<string | null>(null);
    void publishChatVisualPage(INLINE_SVG_CHART).then(setPageUrl);
    return meta.render({
      ...args,
      get pageUrl() {
        return pageUrl();
      },
    });
  },
};

export const Unsupported: Story = {
  args: { preview: UNSUPPORTED_PREVIEW },
};

export const Folder: Story = {
  args: {
    preview: null,
    directory: {
      name: "eyeliner",
      path: "research/eyeliner",
      root: "/Users/demo/OpenBot/Agents/research",
      parentPath: "research",
      entries: [
        {
          name: "sources",
          path: "research/eyeliner/sources",
          kind: "directory",
          size: 0,
          modifiedAt: 1_790_000_000_000,
        },
        {
          name: "brief.md",
          path: "research/eyeliner/brief.md",
          kind: "file",
          size: 4_812,
          modifiedAt: 1_790_000_000_000,
        },
        {
          name: "notes.txt",
          path: "research/eyeliner/notes.txt",
          kind: "file",
          size: 1_204,
          modifiedAt: 1_789_000_000_000,
        },
      ],
      truncated: false,
    },
    onOpenWorkspaceFolder: fn(),
    onBack: fn(),
  },
};
