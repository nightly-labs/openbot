import { createSignal } from "solid-js";
import { expect, fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import FilePreviewPanel from "../src/features/conversation/FilePreviewPanel";
import {
  AUDIO_PREVIEW,
  IMAGE_PREVIEW,
  MARKDOWN_PREVIEW,
  MARKDOWN_SHORT_PREVIEW,
  PDF_PREVIEW,
  SOURCE_PREVIEW,
  TEXT_PREVIEW,
  UNSUPPORTED_PREVIEW,
  XLSX_PREVIEW,
} from "./file-previews";
import { STORY_AGENTS } from "./fixtures";

// The panel reports its width but does not apply it: in the app `ConversationView`
// puts the reported value on `--browser-panel-width`. The story stage does the same,
// so the resizer moves the panel edge here as it does in a conversation.
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
    defaultWidth: () => PANEL_DEFAULT,
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

/** A markdown file rendered as rich text: headings, lists, code, quote, and a table. */
export const Markdown: Story = {};

/** A short markdown file, to check the panel with little content. */
export const MarkdownShort: Story = {
  name: "Markdown (short)",
  args: { preview: MARKDOWN_SHORT_PREVIEW },
};

/** The rendered Markdown view can be replaced with the original source and restored. */
export const MarkdownSource: Story = {
  name: "Markdown (source view)",
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "View source" }));
    await expect(canvas.getByRole("button", { name: "View rendered Markdown" })).toBeVisible();
  },
};

/** A plain text file in a monospace block that keeps its spacing and scrolls sideways. */
export const Text: Story = {
  args: { preview: TEXT_PREVIEW },
};

/** A source file: the text preview of code, with indentation and long lines. */
export const TextSource: Story = {
  name: "Text (source)",
  args: { preview: SOURCE_PREVIEW },
};

/** An image file, scaled to the width of the panel. */
export const Image: Story = {
  args: { preview: IMAGE_PREVIEW },
};

/** A PDF rendered by the built-in viewer of the browser, in an iframe. */
export const Pdf: Story = {
  name: "PDF",
  args: { preview: PDF_PREVIEW },
};

/** An audio file, played by the built-in controls of the browser. */
export const Audio: Story = {
  args: { preview: AUDIO_PREVIEW },
};

/** An XLSX workbook rendered as a scrollable table with sheet tabs. */
export const Spreadsheet: Story = {
  args: { preview: XLSX_PREVIEW },
};

/** A kind that the panel cannot show. The user opens the file externally. */
export const Unsupported: Story = {
  args: { preview: UNSUPPORTED_PREVIEW },
};
